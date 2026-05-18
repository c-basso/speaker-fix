'use strict';

const {
  getOpenRouterClient,
  formatSdkError,
} = require('./openrouter-client.js');
const {
  clampSlideCount,
  slideCountFromEnv,
  MIN_SLIDES,
  MAX_SLIDES,
} = require('./post-slides.js');
const { sanitizeSlideHtml } = require('./slide-html.js');
const { POST_TYPE_APP_AD, defaultSlideCountForType } = require('./post-types.js');
const {
  buildTopicSystemPrompt,
  buildAppAdSystemPrompt,
  buildUserMessage,
} = require('./openrouter-prompts.js');
const {
  cleanModelResponseText,
  isGarbageResponse,
  repairTruncatedJson,
} = require('./openrouter-response.js');
const { appendWebsiteToCaption } = require('./app-assets.js');

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const MAX_COMPLETION_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS) || 4096;

function extractJson(text, meta = {}) {
  const trimmed = cleanModelResponseText(text);
  let lastErr;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    lastErr = err;
  }
  try {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return JSON.parse(fence[1].trim());
  } catch (err) {
    lastErr = err;
  }
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  } catch (err) {
    lastErr = err;
  }

  if (meta.finishReason === 'length') {
    const repaired = repairTruncatedJson(trimmed);
    if (repaired) return repaired;
  }

  const tail = trimmed.slice(-400);
  const hint =
    meta.finishReason === 'length'
      ? ' Response hit max_tokens — output was cut off.'
      : '';
  const err = new Error(
    `OpenRouter: failed to parse JSON from response.${hint} ${lastErr?.message || ''}`.trim(),
  );
  err.rawText = trimmed;
  err.finishReason = meta.finishReason;
  throw err;
}

function logOpenRouterExchange(chatRequest, result, text) {
  const choice = result?.choices?.[0];
  const msg = choice?.message;

  console.log('\n[openrouter] ========== REQUEST ==========');
  console.log(
    JSON.stringify(
      {
        model: chatRequest.model,
        temperature: chatRequest.temperature,
        maxTokens: chatRequest.maxTokens,
        responseFormat: chatRequest.responseFormat ?? null,
        messages: chatRequest.messages,
      },
      null,
      2,
    ),
  );

  console.log('\n[openrouter] ========== RESPONSE META ==========');
  console.log(
    JSON.stringify(
      {
        model: result?.model,
        id: result?.id,
        finishReason: choice?.finishReason,
        usage: result?.usage,
        hasReasoning: Boolean(msg?.reasoning),
        refusal: msg?.refusal ?? null,
      },
      null,
      2,
    ),
  );

  if (msg?.reasoning) {
    console.log('\n[openrouter] ========== RESPONSE reasoning ==========');
    console.log(String(msg.reasoning));
  }

  console.log('\n[openrouter] ========== RESPONSE text ==========');
  console.log(text || '(empty)');
  console.log('[openrouter] =====================================\n');
}

function buildSystemPrompt(postType, forcedSlideCount, appName, compact = false) {
  if (postType === POST_TYPE_APP_AD) {
    return buildAppAdSystemPrompt(forcedSlideCount, appName, compact);
  }
  return buildTopicSystemPrompt(forcedSlideCount, compact);
}

function buildChatRequest(messages, variant = 'default') {
  const base = {
    model: DEFAULT_MODEL,
    messages,
    stream: false,
    temperature: variant === 'compact' ? 0.25 : variant === 'retry' ? 0.4 : 0.6,
    maxTokens: MAX_COMPLETION_TOKENS,
  };

  if (variant === 'json_mode' || variant === 'compact') {
    return {
      ...base,
      responseFormat: { type: 'json_object' },
    };
  }

  return base;
}

function messageTextFromResult(result) {
  const choice = result?.choices?.[0];
  const msg = choice?.message;
  if (!msg) return '';

  const { content } = msg;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && part.text) return part.text;
        return '';
      })
      .filter(Boolean);
    if (parts.length) return parts.join('\n');
  }

  if (typeof msg.reasoning === 'string' && msg.reasoning.trim()) {
    const reasoning = msg.reasoning.trim();
    if (
      reasoning.includes('{') &&
      reasoning.includes('}') &&
      !isGarbageResponse(reasoning)
    ) {
      return reasoning;
    }
  }

  return '';
}

function describeEmptyResult(result) {
  const choice = result?.choices?.[0];
  const parts = [
    `finish=${choice?.finishReason ?? '?'}`,
    `refusal=${Boolean(choice?.message?.refusal)}`,
    `reasoning=${Boolean(choice?.message?.reasoning)}`,
  ];
  return parts.join(', ');
}

async function chatSend(client, messages, variant) {
  const chatRequest = buildChatRequest(messages, variant);
  console.log(`[openrouter] calling API (variant=${variant})…`);
  const result = await client.chat.send({ chatRequest });
  const choice = result?.choices?.[0];
  const rawText = messageTextFromResult(result);
  const text = cleanModelResponseText(rawText);
  if (rawText !== text) {
    console.warn('[openrouter] cleaned tag spam from response');
  }
  logOpenRouterExchange(chatRequest, result, text);
  return {
    text,
    usage: result?.usage,
    modelUsed: result?.model,
    variant,
    finishReason: choice?.finishReason,
    debug: describeEmptyResult(result),
  };
}

async function chatCompletion(messages, options = {}) {
  const client = await getOpenRouterClient();
  const variants = options.variants ?? ['json_mode', 'compact', 'default'];

  let last = null;
  try {
    for (const variant of variants) {
      last = await chatSend(client, messages, variant);
      if (last.text?.trim() && !isGarbageResponse(last.text)) {
        if (variant !== 'json_mode') {
          console.log(`[openrouter] ok on variant: ${variant}`);
        }
        return last;
      }
      if (last.text?.trim() && isGarbageResponse(last.text)) {
        console.warn(`[openrouter] garbage response (${variant}), retry…`);
      } else {
        console.warn(`[openrouter] empty response (${variant}), ${last.debug}`);
      }
    }
    return last;
  } catch (err) {
    throw formatSdkError(err);
  }
}

function resolveSlideCount(data, forcedSlideCount) {
  if (forcedSlideCount != null) {
    return clampSlideCount(forcedSlideCount, 'slideCount');
  }

  let fromField = null;
  if (data.slideCount != null && data.slideCount !== '') {
    fromField = clampSlideCount(data.slideCount, 'slideCount in JSON');
  }

  const len = Array.isArray(data.slides) ? data.slides.length : 0;
  if (len === 0) {
    throw new Error('OpenRouter: JSON has no slides');
  }

  const fromArray = clampSlideCount(len, 'slides.length');

  if (fromField != null && fromField !== fromArray) {
    console.warn(
      `[openrouter] slideCount=${fromField} but slides.length=${fromArray} — using ${fromArray}`,
    );
    return fromArray;
  }

  return fromField ?? fromArray;
}

function normalizeSlides(data, targetCount, { extended = false } = {}) {
  let slides = Array.isArray(data.slides) ? [...data.slides] : [];
  if (slides.length === 0) {
    throw new Error('OpenRouter: JSON has no slides');
  }

  if (slides.length > targetCount) {
    slides = slides.slice(0, targetCount);
  }
  while (slides.length < targetCount) {
    slides.push({ ...slides[slides.length - 1] });
  }

  return slides.map((s) => {
    const base = {
      title: sanitizeSlideHtmlField(s.title, 'title'),
      description: sanitizeSlideHtmlField(s.description, 'description'),
      unsplashQuery: s.unsplashQuery
        ? sanitizeSlideField(s.unsplashQuery, 'unsplashQuery')
        : undefined,
    };
    if (!extended) return base;
    return {
      ...base,
      role: s.role ? String(s.role).trim() : undefined,
      visualDirection: s.visualDirection
        ? String(s.visualDirection).trim()
        : undefined,
      animation: s.animation ? String(s.animation).trim() : undefined,
      emotionalTrigger: s.emotionalTrigger
        ? String(s.emotionalTrigger).trim()
        : undefined,
    };
  });
}

const PLACEHOLDER_PATTERNS = [
  /\byour\s+(app|brand|name|product|company)\b/i,
  /\b(insert|add)\s+(here|name|brand)\b/i,
  /\b(lorem ipsum|placeholder|TBD|TODO)\b/i,
  /\[.*?\]/,
  /\.{3,}/,
  /^\.+$/,
  /\bclick\s+here\b/i,
  /\blink\s+in\s+bio\b/i,
];

function looksLikePlaceholder(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function sanitizeSlideField(value, field) {
  let t = String(value || '').trim();
  if (looksLikePlaceholder(t)) {
    console.warn(`[openrouter] dropped placeholder in ${field}: ${t.slice(0, 60)}`);
    t = '';
  }
  return t;
}

function sanitizeSlideHtmlField(value, field) {
  let t = sanitizeSlideHtml(value);
  const plain = plainTextFromHtml(t);
  if (!plain) return '';
  if (looksLikePlaceholder(plain)) {
    console.warn(`[openrouter] dropped placeholder in ${field}: ${plain.slice(0, 60)}`);
    return '';
  }
  if (!/<[a-z][\s\S]*>/i.test(t)) {
    t = `<strong>${plain}</strong>`;
  }
  return t;
}

/**
 * @param {string} topic
 * @param {{ slideCount?: number | null, postType?: string, appName?: string, websiteUrl?: string | null }} options
 */
async function generatePostContent(topic, options = {}) {
  const postType = options.postType || 'topic';
  const appName = options.appName || '';
  const websiteUrl = options.websiteUrl || null;
  const slideOverride =
    options.slideCount !== undefined ? options.slideCount : slideCountFromEnv();
  const forcedSlideCount = defaultSlideCountForType(postType, slideOverride);
  const extended = postType === POST_TYPE_APP_AD;

  console.log(`[openrouter] model=${DEFAULT_MODEL}`);
  console.log(`[openrouter] postType=${postType}`);
  if (extended) console.log(`[openrouter] app=${appName}`);
  if (forcedSlideCount != null) {
    console.log(`[openrouter] slides: ${forcedSlideCount}`);
  } else {
    console.log(`[openrouter] slides: auto (${MIN_SLIDES}…${MAX_SLIDES})`);
  }

  const attempts = [
    { compact: false, variants: ['json_mode'] },
    { compact: true, variants: ['json_mode', 'compact'] },
  ];

  let data;
  let usage;
  let modelUsed;
  let finishReason;

  for (const attempt of attempts) {
    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt(
          postType,
          forcedSlideCount,
          appName,
          attempt.compact,
        ),
      },
      {
        role: 'user',
        content: buildUserMessage({
          postType,
          topic,
          appName,
          compact: attempt.compact,
        }),
      },
    ];

    if (attempt.compact) {
      console.log('[openrouter] retry with compact HTML + shorter fields…');
    }

    const result = await chatCompletion(messages, { variants: attempt.variants });
    usage = result?.usage;
    modelUsed = result?.modelUsed;
    finishReason = result?.finishReason;

    if (modelUsed) console.log(`[openrouter] used model: ${modelUsed}`);
    if (usage) {
      console.log(
        `[openrouter] tokens: prompt=${usage.promptTokens ?? '?'} completion=${usage.completionTokens ?? '?'}`,
      );
    }

    const text = result?.text?.trim();
    if (!text) continue;
    if (isGarbageResponse(text)) continue;

    try {
      data = extractJson(text, { finishReason: finishReason ?? undefined });
      break;
    } catch (err) {
      if (err.rawText) {
        console.error(
          `[openrouter] parse failed (finish=${err.finishReason ?? '?'}, ${err.rawText.length} chars). Last 300 chars:\n${err.rawText.slice(-300)}`,
        );
      }
      if (!attempt.compact) continue;
      throw err;
    }
  }

  if (!data) {
    throw new Error(
      'OpenRouter: could not parse JSON (model returned garbage or truncated output). Try again or set OPENROUTER_MODEL to another model.',
    );
  }
  const slideCount = resolveSlideCount(data, forcedSlideCount);
  const slides = normalizeSlides(data, slideCount, { extended });

  console.log(`[openrouter] chose ${slideCount} slide(s)`);

  const fallbackTopic = extended ? appName : topic;

  return {
    postType,
    appName: extended ? appName : undefined,
    slideCount,
    title: String(data.title || fallbackTopic).trim(),
    description: appendWebsiteToCaption(
      String(data.description || '').trim(),
      websiteUrl,
    ),
    unsplashQuery: String(data.unsplashQuery || fallbackTopic).trim(),
    slides,
  };
}

module.exports = {
  generatePostContent,
  extractJson,
  chatCompletion,
  resolveSlideCount,
};

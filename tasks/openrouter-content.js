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

const DEFAULT_MODEL = 'openrouter/free';
const MAX_COMPLETION_TOKENS = 8192;

function extractJson(text, meta = {}) {
  const trimmed = text.trim();
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

function buildSystemPrompt(forcedSlideCount) {
  const countRule = forcedSlideCount
    ? `Use exactly ${forcedSlideCount} slide(s). Set slideCount to ${forcedSlideCount}.`
    : `Pick slideCount (${MIN_SLIDES}–${MAX_SLIDES}): minimum slides that carry the idea — 1 for one killer frame; 3–6 for lists, steps, myths, before/after; never pad.`;

  return `You write viral TikTok PHOTO CAROUSEL copy (1080×1920). Text is huge on screen — every word must earn attention.

TOPIC: Follow the user's topic exactly. Do not swap in a different product, app, or brand unless the topic names it.

${countRule}

VIRAL RULES (non-negotiable):
- Opening slide = scroll-stopping HOOK: tension, surprise, bold claim, or "you're doing X wrong" — not a generic title.
- One sharp idea per slide. Arc: hook → rapid value beats → punchline/CTA on the last slide.
- Write like TikTok, not a blog: concrete, specific, emotional. Use numbers, contrasts, "before/after", myths busted, mini-stories.
- ULTRA SHORT on-slide copy (1–2 second read): title ≈ 2–6 words; description ≈ 3–12 words — count words ignoring HTML tags.
- Top-level "title" and "description" (TikTok post caption) = plain text only, no HTML.
- On-slide "title" and "description" inside each slide = HTML fragments (see HTML FORMATTING).

HTML FORMATTING (slides[].title and slides[].description only):
- MUST be HTML fragments. Wild TikTok energy BUT always readable on photo backgrounds: high contrast only.
- Allowed tags: <b>, <strong>, <i>, <em>, <u>, <s>, <mark>, <br>, <span style="...">.
- Every <span> with color MUST also set background-color:#ffffff or background-color:#ffe203 (light pill behind text).
- Text colors (on light pills only): #ff0050, #280fa0, #0a7c42, #cc4400, #1a1a1a. NEVER #ffffff, #fff, white, #000, or black as text color.
- Prefer <mark> for yellow highlights (black text). font-size on spans: 1.1em-1.4em max.
- GOOD: <span style="color:#ff0050;background-color:#ffffff;font-size:1.2em">WRONG</span> <mark>fix now</mark>
- BAD: <span style="color:#ffffff">...</span> or colored text without background.
- No <a>, <img>, <div>, <p>, <script>, class names, or markdown. Escape double quotes in JSON as \\".
- "description" (caption field): plain text; hook first line; 2–4 hashtags; no HTML.
- unsplashQuery: 2–5 concrete English nouns (real photo search), e.g. "cracked iphone screen closeup" — not "success" or "viral background".

ON-SLIDE COPY (title + description on each slide):
- Never label slides. The carousel order is visible — do NOT prefix with slide numbers or meta labels.
- BANNED anywhere in title or description: "Slide 1", "Slide 2", "SLIDE 3:", "Frame 1", "Part 2", "Card 3", "Screen 4", "1/5", "Step 1:" as a header (content labels like "Mistake #1" or "Tip #2" are OK).
- BAD title: "Slide 2: You're posting wrong" → GOOD: "You're posting WRONG"
- BAD description: "Frame 3 — Use hooks" → GOOD: "Use 15-second hooks only"
- Each title/description must read as standalone viral copy, not as a deck outline.

FORBIDDEN (never output):
- Placeholders: "your app/brand/name", "[...]", "X", "TBD", "lorem", "insert", "click here", "link in bio" on slides, "..."
- Filler: "In this post", "Did you know", "Stay tuned", "Don't miss out", "Game changer", "Revolutionary"
- Vague lines: "Amazing tips", "You need this", "Life hack" without specifics
- Duplicate or near-duplicate slides

Reply with valid JSON only — no markdown, no commentary:
{
  "slideCount": ${forcedSlideCount ?? 'integer'},
  "title": "plain text post title, max 90 chars",
  "description": "plain text TikTok caption, max 400 chars",
  "unsplashQuery": "default background search, 2-5 words",
  "slides": [
    {
      "title": "<strong>...</strong> HTML hook — no Slide 1 labels",
      "description": "<mark>...</mark> HTML subline",
      "unsplashQuery": "optional per-slide background"
    }
  ]
}
slides.length must equal slideCount. All user-facing text in English. No unescaped quotes inside JSON strings.`;
}

function buildChatRequest(messages, variant = 'default') {
  const base = {
    model: DEFAULT_MODEL,
    messages,
    stream: false,
    temperature: variant === 'retry' ? 0.4 : 0.7,
    maxTokens: MAX_COMPLETION_TOKENS,
  };

  if (variant === 'json_mode') {
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
    if (reasoning.includes('{') && reasoning.includes('}')) {
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
  const text = messageTextFromResult(result);
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

async function chatCompletion(messages) {
  const client = await getOpenRouterClient();
  const variants = ['json_mode', 'default', 'retry'];

  let last = null;
  try {
    for (const variant of variants) {
      last = await chatSend(client, messages, variant);
      if (last.text?.trim()) {
        if (variant !== 'default') {
          console.log(`[openrouter] ok on retry mode: ${variant}`);
        }
        return last;
      }
      console.warn(
        `[openrouter] empty response (${variant}), ${last.debug}`,
      );
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

function normalizeSlides(data, targetCount) {
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

  return slides.map((s) => ({
    title: sanitizeSlideHtmlField(s.title, 'title'),
    description: sanitizeSlideHtmlField(s.description, 'description'),
    unsplashQuery: s.unsplashQuery
      ? sanitizeSlideField(s.unsplashQuery, 'unsplashQuery')
      : undefined,
  }));
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
 * @param {{ slideCount?: number | null }} options — if set, forces count; else OpenRouter decides
 */
async function generatePostContent(topic, options = {}) {
  const forcedSlideCount =
    options.slideCount !== undefined
      ? options.slideCount
      : slideCountFromEnv();

  console.log(`[openrouter] model=${DEFAULT_MODEL}`);
  if (forcedSlideCount != null) {
    console.log(`[openrouter] slides: fixed ${forcedSlideCount}`);
  } else {
    console.log(`[openrouter] slides: auto (${MIN_SLIDES}…${MAX_SLIDES})`);
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(forcedSlideCount) },
    {
      role: 'user',
      content: `Make this go viral on TikTok. Do not number slides in title or description (no "Slide 1", "Slide 2", etc.). Topic:\n${topic}`,
    },
  ];

  const { text, usage, modelUsed, finishReason } = await chatCompletion(messages);

  if (modelUsed) console.log(`[openrouter] used model: ${modelUsed}`);
  if (usage) {
    console.log(
      `[openrouter] tokens: prompt=${usage.promptTokens ?? '?'} completion=${usage.completionTokens ?? '?'}`,
    );
  }

  if (!text?.trim()) {
    throw new Error(
      'OpenRouter: empty response from free router (try again or pick another model in openrouter.ai)',
    );
  }

  let data;
  try {
    data = extractJson(text, { finishReason: finishReason ?? undefined });
  } catch (err) {
    if (err.rawText) {
      console.error(
        `[openrouter] parse failed (finish=${err.finishReason ?? '?'}, ${err.rawText.length} chars). Last 500 chars:\n${err.rawText.slice(-500)}`,
      );
    }
    throw err;
  }
  const slideCount = resolveSlideCount(data, forcedSlideCount);
  const slides = normalizeSlides(data, slideCount);

  console.log(`[openrouter] chose ${slideCount} slide(s)`);

  return {
    slideCount,
    title: String(data.title || topic).trim(),
    description: String(data.description || '').trim(),
    unsplashQuery: String(data.unsplashQuery || topic).trim(),
    slides,
  };
}

module.exports = {
  generatePostContent,
  extractJson,
  chatCompletion,
  resolveSlideCount,
};

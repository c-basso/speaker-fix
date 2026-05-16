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

const DEFAULT_MODEL = 'openrouter/free';

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return JSON.parse(fence[1].trim());
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('OpenRouter: failed to parse JSON from response');
  }
}

function buildSystemPrompt(forcedSlideCount) {
  const countRule = forcedSlideCount
    ? `Use exactly ${forcedSlideCount} slide(s). Set slideCount to ${forcedSlideCount}.`
    : `Pick slideCount (${MIN_SLIDES}–${MAX_SLIDES}): minimum slides that carry the idea — 1 for one killer frame; 3–6 for lists, steps, myths, before/after; never pad.`;

  return `You write viral TikTok PHOTO CAROUSEL copy (1080×1920). Text is huge on screen — every word must earn attention.

TOPIC: Follow the user's topic exactly. Do not swap in a different product, app, or brand unless the topic names it.

${countRule}

VIRAL RULES (non-negotiable):
- Slide 1 = scroll-stopping HOOK: tension, surprise, bold claim, or "you're doing X wrong" — not a generic title.
- One sharp idea per slide. Arc: hook → rapid value beats → punchline/CTA on the last slide.
- Write like TikTok, not a blog: concrete, specific, emotional. Use numbers, contrasts, "before/after", myths busted, mini-stories.
- ULTRA SHORT on-slide text (people read in 1–2 seconds):
  - title: 2–6 words (hard max 8). ALL CAPS ok for 1–2 emphasis words, not whole slide.
  - description: 3–12 words, one line only. No second paragraph.
- description (caption field): first line must hook; last line soft CTA; 2–4 relevant hashtags; no hashtag spam.
- unsplashQuery: 2–5 concrete English nouns (real photo search), e.g. "cracked iphone screen closeup" — not "success" or "viral background".

FORBIDDEN (never output):
- Placeholders: "your app/brand/name", "[...]", "X", "TBD", "lorem", "insert", "click here", "link in bio" on slides, "..."
- Filler: "In this post", "Did you know", "Stay tuned", "Don't miss out", "Game changer", "Revolutionary"
- Vague lines: "Amazing tips", "You need this", "Life hack" without specifics
- Duplicate or near-duplicate slides
- logoCaption: only if topic names a brand/product — use exact name; otherwise use "" (empty string)

logoCaption: max 4 words when used.

Reply with valid JSON only — no markdown, no commentary:
{
  "slideCount": ${forcedSlideCount ?? 'integer'},
  "title": "post title, max 90 chars, curiosity-driven",
  "description": "TikTok caption, max 400 chars",
  "unsplashQuery": "default background search, 2-5 words",
  "slides": [
    {
      "title": "on-slide headline",
      "description": "on-slide subline",
      "logoCaption": "",
      "unsplashQuery": "optional; use when this slide needs a different visual"
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
    temperature: variant === 'retry' ? 0.4 : 0.8,
    maxTokens: 4096,
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
  const result = await client.chat.send({
    chatRequest: buildChatRequest(messages, variant),
  });
  return {
    text: messageTextFromResult(result),
    usage: result?.usage,
    modelUsed: result?.model,
    variant,
    debug: describeEmptyResult(result),
  };
}

async function chatCompletion(messages) {
  const client = await getOpenRouterClient();
  const variants = ['default', 'retry', 'json_mode'];

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
    title: sanitizeSlideField(s.title, 'title'),
    description: sanitizeSlideField(s.description, 'description'),
    logoCaption: sanitizeLogoCaption(s.logoCaption),
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

function sanitizeSlideField(value, field) {
  let t = String(value || '').trim();
  if (looksLikePlaceholder(t)) {
    console.warn(`[openrouter] dropped placeholder in ${field}: ${t.slice(0, 60)}`);
    t = '';
  }
  return t;
}

function sanitizeLogoCaption(value) {
  const t = String(value || '').trim();
  if (!t || looksLikePlaceholder(t)) return '';
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
      content: `Make this go viral on TikTok. Topic:\n${topic}`,
    },
  ];

  const { text, usage, modelUsed } = await chatCompletion(messages);

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

  const data = extractJson(text);
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

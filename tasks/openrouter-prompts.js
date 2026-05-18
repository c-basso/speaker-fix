'use strict';

const { MIN_SLIDES, MAX_SLIDES } = require('./post-slides.js');
const { APP_AD_SLIDE_COUNT } = require('./post-types.js');

function buildHtmlFormattingBlock(compact = false) {
  if (compact) {
    return `HTML (slides[].title and slides[].description ONLY):
- Use ONLY <strong> and <mark>. Max 2 tags per field. Example: <strong>WRONG</strong> <mark>fix now</mark>
- No <span>, no inline styles, no <br>. Every tag must be closed. NEVER output stray "</" or repeated closing tags.
- Keep copy ultra short.`;
  }

  return `HTML FORMATTING (slides[].title and slides[].description only):
- HTML fragments only. Readable on photo backgrounds (high contrast).
- Allowed: <b>, <strong>, <i>, <em>, <u>, <s>, <mark>, <span style="...">. Max 4 tags per field total.
- Every opening tag MUST be closed. NEVER output stray "</" sequences or tag spam.
- <span> with color MUST include background-color:#ffffff or #ffe203.
- Text colors on pills: #ff0050, #280fa0, #0a7c42, #cc4400, #1a1a1a — never #fff/#000 alone.
- Prefer <strong> and <mark> over complex spans.
- No <a>, <img>, <div>, <p>, <script>. Escape " as \\" inside JSON strings.

ON-SLIDE COPY:
- No "Slide 1" labels. title = headline (HTML). description = one short line (HTML).`;
}

function buildJsonSchema(forcedSlideCount, { extended = false, compact = false } = {}) {
  const metaCompact = compact
    ? `
      "visualDirection": "max 10 words",
      "animation": "max 6 words",
      "emotionalTrigger": "one word"`
    : `
      "visualDirection": "max 15 words — photo subject/mood",
      "animation": "max 10 words",
      "emotionalTrigger": "curiosity|FOMO|transformation|exclusivity|social proof|convenience"`;

  const slideFields = extended
    ? `{
      "role": "hook|problem|agitate|intro|experience|transformation|cta",
      "title": "HTML headline — minimal tags",
      "description": "HTML supporting text — minimal tags",
      ${metaCompact.trim()},
      "unsplashQuery": "2-5 english words"
    }`
    : `{
      "title": "HTML headline",
      "description": "HTML supporting text",
      "unsplashQuery": "optional"
    }`;

  return `Output ONE valid JSON object only. No markdown. No text before/after JSON. Stop after closing brace.
{
  "slideCount": ${forcedSlideCount ?? 'integer'},
  "title": "plain text, max 90 chars",
  "description": "plain text TikTok caption, max 400 chars",
  "unsplashQuery": "2-5 words",
  "slides": [
    ${slideFields}
  ]
}
slides.length must equal slideCount. English only. Compact copy — do not ramble.`;
}

function buildTopicSystemPrompt(forcedSlideCount, compact = false) {
  const countRule = forcedSlideCount
    ? `Exactly ${forcedSlideCount} slide(s). slideCount=${forcedSlideCount}.`
    : `slideCount ${MIN_SLIDES}–${MAX_SLIDES}, minimum needed.`;

  return `Viral TikTok photo carousel copy (1080×1920).

TOPIC: Follow the user topic. ${countRule}

Rules: hook first slide, one idea per slide, TikTok tone, plain-text title/description fields (no HTML in caption).

${buildHtmlFormattingBlock(compact)}

${buildJsonSchema(forcedSlideCount, { compact })}`;
}

function buildAppAdSystemPrompt(forcedSlideCount, appName, compact = false) {
  const count = forcedSlideCount ?? APP_AD_SLIDE_COUNT;

  return `Viral carousel ad for mobile app "${appName}" (1080×1920). Native TikTok feel — NOT corporate ads.

Goal: attention, shares, installs. Audience: people with the problem "${appName}" solves.

Exactly ${count} slides (slideCount=${count}), roles in order:
hook → problem → agitate → intro (reveal app) → experience (2-3 features) → transformation → cta

Per slide: short HTML title + description; brief visualDirection/animation/emotionalTrigger; unsplashQuery (2-5 words).

Top-level title + description = plain text caption with hashtags. No HTML in caption.

${buildHtmlFormattingBlock(compact)}

FORBIDDEN: [APP NAME] placeholder, Slide N labels, tag spam, unclosed tags, long paragraphs.

${buildJsonSchema(count, { extended: true, compact })}`;
}

function buildUserMessage({ postType, topic, appName, compact = false }) {
  const rules =
    'Valid JSON only. Minimal HTML tags. No repeated </. Do not number slides.';

  if (postType === 'app-ad') {
    const extra = topic ? `\nContext:\n${topic}` : '';
    return `App ad carousel for "${appName}". ${rules}${extra}`;
  }

  return `Viral TikTok carousel. ${rules}\nTopic:\n${topic}`;
}

module.exports = {
  buildTopicSystemPrompt,
  buildAppAdSystemPrompt,
  buildUserMessage,
};

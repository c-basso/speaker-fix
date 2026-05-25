'use strict';

const { MIN_SLIDES, MAX_SLIDES } = require('./post-slides.js');
const { INFOGRAPHIC_SLIDE_COUNT } = require('./post-types.js');
const { getInfographicAspect } = require('./infographic-aspect.js');

function buildInfographicJsonSchema(forcedSlideCount) {
  const countField = forcedSlideCount ?? 'integer';
  return `Output ONE valid JSON object only. No markdown.
{
  "slideCount": ${countField},
  "title": "plain text TikTok caption title, max 90 chars",
  "description": "plain text caption with hashtags, max 400 chars",
  "slides": [
    {
      "imageTitle": "SHORT BOLD HEADLINE for top of infographic (e.g. SPERM HEALTH)",
      "topic": "2-6 words — subject of this slide for prompt (e.g. sperm health)",
      "topSection": "Top half: 2-4 clear icons, red X in center, one short caption (4-8 words). No duplicate text.",
      "bottomSection": "Bottom half: 2-4 clear icons, green check in center, one short caption (4-8 words). No duplicate text."
    }
  ]
}
slides.length must equal slideCount (${MIN_SLIDES}–${MAX_SLIDES}). Each slide must have non-empty imageTitle, topic, topSection, bottomSection. English only.`;
}

function buildInfographicSystemPrompt(forcedSlideCount) {
  const defaultCount = forcedSlideCount ?? INFOGRAPHIC_SLIDE_COUNT;
  const countRule = forcedSlideCount
    ? `Exactly ${forcedSlideCount} infographic slides. slideCount=${forcedSlideCount}.`
    : `Exactly ${defaultCount} slides (or ${defaultCount - 1} if the topic is very narrow). slideCount must match slides.length.`;

  const { width, height, promptLabel } = getInfographicAspect();

  return `You write specs for a TikTok infographic carousel (${width}×${height}, ${promptLabel}). Slides should look clean and readable — less visual noise than a busy poster, but still filled enough to teach one idea.

Each slide = one image on a ${promptLabel} canvas: white background, bold imageTitle at top, TOP band (problem/bad) vs BOTTOM band (solution/good), red X and green check as anchors. Layout must fit in a square-ish frame — compact vertical spacing so TikTok does not crop the headline or captions.

Layout per slide:
- TOP: 2–4 simple objects/icons on the left/right, large red X in the center, ONE short caption under the top half (4–8 words). Do not repeat the same caption elsewhere.
- BOTTOM: 2–4 simple objects/icons, large green check in the center, ONE short caption under the bottom half (4–8 words).
- Avoid cramming many tiny items, long sentences on the image, duplicate labels, or the same caption on left and right.
- OK to show 2–3 related foods/items per side — not a huge collage of 6+ things.

${countRule}

Carousel narrative:
- One main theme; each slide = different sub-angle.
- Slide 1 = hook; last slide = takeaway.

Rules:
- imageTitle = ALL CAPS, 2–5 words
- topic = 2–6 words
- topSection / bottomSection = one concise sentence each (about 30–50 words max): what appears left/center/right + one caption phrase
- TikTok health/education tone. English only. No HTML.

${buildInfographicJsonSchema(forcedSlideCount ?? INFOGRAPHIC_SLIDE_COUNT)}`;
}

function buildInfographicUserMessage(topic, extraContext = '') {
  const t = String(topic || '').trim() || 'general health tips';
  const ctx = String(extraContext || '').trim();
  return [
    `Main carousel theme: ${t}`,
    ctx ? `Extra context from author:\n${ctx}` : '',
    `Plan ${INFOGRAPHIC_SLIDE_COUNT} distinct infographic slides — clean layout, limited text noise per slide.`,
    'Valid JSON only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

module.exports = {
  buildInfographicSystemPrompt,
  buildInfographicUserMessage,
};

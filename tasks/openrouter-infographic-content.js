'use strict';

const {
  clampSlideCount,
  slideCountFromEnv,
  MIN_SLIDES,
  MAX_SLIDES,
} = require('./post-slides.js');
const { POST_TYPE_INFOGRAPHIC, defaultSlideCountForType } = require('./post-types.js');
const {
  extractJson,
  chatCompletion,
  resolveSlideCount,
} = require('./openrouter-content.js');
const {
  cleanModelResponseText,
  isGarbageResponse,
} = require('./openrouter-response.js');
const {
  buildInfographicSystemPrompt,
  buildInfographicUserMessage,
} = require('./openrouter-infographic-prompts.js');

function sanitizeField(value, field) {
  const t = String(value || '').trim();
  if (!t) {
    throw new Error(`OpenRouter infographic: empty ${field}`);
  }
  return t;
}

function normalizeInfographicSlides(data, targetCount) {
  let slides = Array.isArray(data.slides) ? [...data.slides] : [];
  if (slides.length === 0) {
    throw new Error('OpenRouter infographic: JSON has no slides');
  }

  if (slides.length > targetCount) {
    slides = slides.slice(0, targetCount);
  }

  const lastWithContent = () => {
    for (let i = slides.length - 1; i >= 0; i -= 1) {
      const s = slides[i];
      if (s?.topSection && s?.bottomSection) return s;
    }
    return slides[slides.length - 1];
  };

  while (slides.length < targetCount) {
    slides.push({ ...lastWithContent() });
  }

  return slides.map((s, index) => {
    const isFirst = index === 0;
    const isLast = index === targetCount - 1;
    let slideRole = String(s.slideRole || '').trim().toLowerCase();
    if (!['hook', 'build', 'cta'].includes(slideRole)) {
      if (isFirst) slideRole = 'hook';
      else if (isLast) slideRole = 'cta';
      else slideRole = 'build';
    }

    return {
      index: index + 1,
      slideRole,
      imageTitle: sanitizeField(s.imageTitle, `slides[${index}].imageTitle`),
      topic: sanitizeField(s.topic || s.imageTitle, `slides[${index}].topic`),
      topSection: sanitizeField(s.topSection, `slides[${index}].topSection`),
      bottomSection: sanitizeField(s.bottomSection, `slides[${index}].bottomSection`),
    };
  });
}

function countInvalidInfographicSlides(slides) {
  return slides.filter((s) => !s.topSection || !s.bottomSection || !s.imageTitle).length;
}

/**
 * @param {string} topic
 * @param {{ slideCount?: number | null, context?: string }} [options]
 */
async function generateInfographicPostContent(topic, options = {}) {
  const slideOverride =
    options.slideCount !== undefined ? options.slideCount : slideCountFromEnv();
  const forcedSlideCount = defaultSlideCountForType(POST_TYPE_INFOGRAPHIC, slideOverride);

  console.log('[openrouter] postType=infographic');
  if (forcedSlideCount != null) {
    console.log(`[openrouter] slides: ${forcedSlideCount}`);
  } else {
    console.log(`[openrouter] slides: auto (${MIN_SLIDES}…${MAX_SLIDES})`);
  }

  const attempts = [
    { compact: false, variants: ['json_mode', 'default'] },
    { compact: true, variants: ['default', 'compact'] },
  ];

  let data;

  for (const attempt of attempts) {
    const messages = [
      {
        role: 'system',
        content: buildInfographicSystemPrompt(forcedSlideCount),
      },
      {
        role: 'user',
        content: buildInfographicUserMessage(topic, options.context),
      },
    ];

    if (attempt.compact) {
      console.log('[openrouter] infographic retry (compact)…');
    }

    const result = await chatCompletion(messages, { variants: attempt.variants });
    const text = result?.text?.trim();
    if (!text || isGarbageResponse(text)) continue;

    try {
      data = extractJson(text, { finishReason: result?.finishReason });
    } catch (err) {
      if (!attempt.compact) continue;
      throw err;
    }

    const slideCountProbe = resolveSlideCount(data, forcedSlideCount);
    const slidesProbe = normalizeInfographicSlides(data, slideCountProbe);
    const invalid = countInvalidInfographicSlides(slidesProbe);
    if (invalid > 0) {
      console.warn(`[openrouter] ${invalid} infographic slide(s) incomplete`);
      if (!attempt.compact) continue;
      throw new Error(`OpenRouter: ${invalid} infographic slide(s) missing fields`);
    }
    break;
  }

  if (!data) {
    throw new Error('OpenRouter: could not parse infographic JSON');
  }

  const slideCount = resolveSlideCount(data, forcedSlideCount);
  const slides = normalizeInfographicSlides(data, slideCount);

  console.log(`[openrouter] chose ${slideCount} infographic slide(s)`);

  return {
    postType: POST_TYPE_INFOGRAPHIC,
    slideCount,
    title: String(data.title || topic).trim(),
    description: String(data.description || '').trim(),
    slides,
  };
}

module.exports = {
  generateInfographicPostContent,
  normalizeInfographicSlides,
};

'use strict';

const MIN_SLIDES = 1;
const MAX_SLIDES = 8;

function clampSlideCount(value, label = 'slide count') {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_SLIDES || n > MAX_SLIDES) {
    throw new Error(
      `${label}: use an integer from ${MIN_SLIDES} to ${MAX_SLIDES}`,
    );
  }
  return n;
}

/** @returns {number | null} forced count from env, or null = let OpenRouter decide */
function slideCountFromEnv() {
  const raw = process.env.POST_SLIDE_COUNT;
  if (raw === undefined || String(raw).trim() === '') return null;
  return clampSlideCount(raw, 'POST_SLIDE_COUNT');
}

/**
 * @param {string[]} argv
 * @returns {{ slideCount: number | null, topic: string }}
 */
function parseCreatePostArgv(argv) {
  let slideCount = slideCountFromEnv();
  const topicParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--slides' || arg === '-n') {
      const next = argv[++i];
      if (next === undefined) {
        throw new Error(`Expected a number after ${arg}`);
      }
      slideCount = clampSlideCount(next, arg);
      continue;
    }

    const eq = arg.match(/^--slides=(\d+)$/);
    if (eq) {
      slideCount = clampSlideCount(eq[1], '--slides');
      continue;
    }

    topicParts.push(arg);
  }

  return {
    slideCount,
    topic: topicParts.join(' ').trim(),
  };
}

function createPostUsage() {
  return [
    'Usage: npm run create-post -- ["topic"]',
    `OpenRouter picks slide count (${MIN_SLIDES}…${MAX_SLIDES}) from the topic.`,
    'Optional override:',
    '  --slides N   or   POST_SLIDE_COUNT=N in .env',
    'Examples:',
    '  npm run create-post -- "5 signs your iPhone speaker is broken"',
    '  npm run create-post -- --slides 3 "force exactly 3 slides"',
  ].join('\n');
}

module.exports = {
  MIN_SLIDES,
  MAX_SLIDES,
  clampSlideCount,
  slideCountFromEnv,
  parseCreatePostArgv,
  createPostUsage,
};

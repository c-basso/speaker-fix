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

module.exports = {
  MIN_SLIDES,
  MAX_SLIDES,
  clampSlideCount,
  slideCountFromEnv,
};

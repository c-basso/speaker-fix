'use strict';

/** TikTok carousel часто показывает фото почти квадратом — 9:16 обрезает верх/низ. */
const ASPECT_PRESETS = {
  '1:1': {
    ratio: '1:1',
    width: 1080,
    height: 1080,
    promptLabel: 'square 1:1 aspect ratio',
  },
  '4:5': {
    ratio: '4:5',
    width: 1080,
    height: 1350,
    promptLabel: '4:5 portrait (less tall than 9:16)',
  },
  '9:16': {
    ratio: '9:16',
    width: 1080,
    height: 1920,
    promptLabel: '9:16 vertical',
  },
};

function getInfographicAspect() {
  const raw = String(process.env.INFOGRAPHIC_ASPECT_RATIO || '1:1').trim();
  const preset = ASPECT_PRESETS[raw];
  if (!preset) {
    const allowed = Object.keys(ASPECT_PRESETS).join(', ');
    throw new Error(
      `INFOGRAPHIC_ASPECT_RATIO="${raw}" invalid. Use: ${allowed}`,
    );
  }
  return preset;
}

module.exports = {
  ASPECT_PRESETS,
  getInfographicAspect,
};

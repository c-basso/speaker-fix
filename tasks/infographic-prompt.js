'use strict';

const { getInfographicAspect } = require('./infographic-aspect.js');

function infographicStyleBlock() {
  const { width, height, promptLabel } = getInfographicAspect();
  return `Clean balanced infographic, TikTok photo carousel, ${promptLabel}, ${width}×${height}px canvas.
Keep the full top and bottom sections visible inside the frame (compact layout, safe margins — nothing cut off at edges).
Flat vector illustration, white background, high contrast. A few large icons per half.
Readable short captions only (one line per half). No paragraph text, no duplicate labels.`;
}

/** @deprecated use infographicStyleBlock() — kept for tests */
const INFOGRAPHIC_STYLE_BLOCK = infographicStyleBlock();

const DEFAULT_PROMPT_TEMPLATE = `Educational infographic about {{TOPIC}}, white background, bold black title "{{TITLE}}" at the top.

Top section:
{{TOP_SECTION}}

Bottom section:
{{BOTTOM_SECTION}}

${infographicStyleBlock()}`;

function fillTemplate(template, vars) {
  let out = String(template || DEFAULT_PROMPT_TEMPLATE);
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? '').trim());
  }
  return out.replace(/\{\{[A-Z_]+\}\}/g, '').trim();
}

/**
 * @param {{ topic: string, imageTitle: string, topSection: string, bottomSection: string, template?: string }} spec
 */
function buildInfographicPrompt(spec) {
  const topic = String(spec.topic || spec.imageTitle || 'health').trim();
  const imageTitle = String(spec.imageTitle || topic).trim().toUpperCase();
  const topSection = String(spec.topSection || '').trim();
  const bottomSection = String(spec.bottomSection || '').trim();

  if (!topSection || !bottomSection) {
    throw new Error('buildInfographicPrompt: topSection and bottomSection are required');
  }

  return fillTemplate(spec.template || DEFAULT_PROMPT_TEMPLATE, {
    TOPIC: topic,
    TITLE: imageTitle,
    TOP_SECTION: topSection,
    BOTTOM_SECTION: bottomSection,
  });
}

module.exports = {
  INFOGRAPHIC_STYLE_BLOCK,
  infographicStyleBlock,
  DEFAULT_PROMPT_TEMPLATE,
  buildInfographicPrompt,
  fillTemplate,
};

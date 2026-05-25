'use strict';

/** Общий стиль для всех инфографических слайдов (TikTok 9:16). */
const INFOGRAPHIC_STYLE_BLOCK = `Clean balanced infographic, TikTok educational style, flat vector illustration, white background, high contrast, 9:16 vertical.
Clear layout with breathing room — not empty, not crowded. A few large icons per half (avoid cluttering with many small objects).
Readable short captions only (one line per half, normal size — not fine print). No paragraph text, no duplicate labels, no extra callouts.`;

const DEFAULT_PROMPT_TEMPLATE = `Educational infographic about {{TOPIC}}, white background, bold black title "{{TITLE}}" at the top.

Top section:
{{TOP_SECTION}}

Bottom section:
{{BOTTOM_SECTION}}

${INFOGRAPHIC_STYLE_BLOCK}`;

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
  DEFAULT_PROMPT_TEMPLATE,
  buildInfographicPrompt,
  fillTemplate,
};

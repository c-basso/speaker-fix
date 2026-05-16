'use strict';

const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'mark',
  'span',
  'br',
]);

const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'font-size',
  'font-weight',
  'text-decoration',
  'font-style',
]);

/** Readable neon on light pills — never bare white/black text */
const SAFE_TEXT_COLORS = new Set([
  '#ff0050',
  '#e6007a',
  '#280fa0',
  '#0a7c42',
  '#cc4400',
  '#1a1a1a',
  '#d40000',
]);

const LIGHT_PILL_BG = '#ffffff';
const MARK_PILL_BG = '#ffe203';

function parseStyleMap(styleRaw) {
  const map = {};
  for (const chunk of String(styleRaw || '').split(';')) {
    const piece = chunk.trim();
    if (!piece) continue;
    const colon = piece.indexOf(':');
    if (colon < 0) continue;
    const prop = piece.slice(0, colon).trim().toLowerCase();
    let val = piece.slice(colon + 1).trim().replace(/["']/g, '');
    map[prop] = val;
  }
  return map;
}

function styleMapToString(map) {
  return Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

function parseCssColor(raw) {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'white') return { r: 255, g: 255, b: 255 };
  if (val === 'black') return { r: 0, g: 0, b: 0 };
  let hex = val.replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }) {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function normalizeTextColor(colorRaw) {
  const rgb = parseCssColor(colorRaw);
  if (!rgb) return '#ff0050';

  const lum = relativeLuminance(rgb);
  const hex = colorRaw.trim().toLowerCase();
  if (lum > 0.72 || hex === '#fff' || hex === '#ffffff' || hex === 'white') {
    return '#ff0050';
  }
  if (lum < 0.08 || hex === '#000' || hex === '#000000' || hex === 'black') {
    return '#ff0050';
  }
  if (SAFE_TEXT_COLORS.has(hex.startsWith('#') ? hex : `#${hex}`)) {
    return hex.startsWith('#') ? hex : `#${hex}`;
  }
  return lum < 0.35 ? '#280fa0' : '#ff0050';
}

function enforceReadableStyle(styleRaw) {
  const map = parseStyleMap(sanitizeStyle(styleRaw));
  const hasBg = Boolean(map.background || map['background-color']);

  if (map.color) {
    map.color = normalizeTextColor(map.color);
  }

  if (!hasBg) {
    map['background-color'] = LIGHT_PILL_BG;
  } else {
    const bg = map.background || map['background-color'];
    const bgRgb = parseCssColor(bg);
    if (bgRgb && relativeLuminance(bgRgb) < 0.4) {
      map['background-color'] = LIGHT_PILL_BG;
      delete map.background;
    }
  }

  if (!map.color) {
    map.color = '#ff0050';
  }

  return styleMapToString(map);
}

function sanitizeStyle(styleRaw) {
  if (!styleRaw) return '';
  const parts = [];
  for (const chunk of styleRaw.split(';')) {
    const piece = chunk.trim();
    if (!piece) continue;
    const colon = piece.indexOf(':');
    if (colon < 0) continue;
    const prop = piece.slice(0, colon).trim().toLowerCase();
    let val = piece.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (/url\s*\(|javascript:|expression\s*\(/i.test(val)) continue;
    val = val.replace(/["']/g, '');
    parts.push(`${prop}:${val}`);
  }
  return parts.join(';');
}

function enforceReadableSpans(html) {
  return html.replace(/<span style="([^"]*)">/gi, (_match, styleRaw) => {
    const style = enforceReadableStyle(styleRaw);
    return style ? `<span style="${style}">` : '<span>';
  });
}

/**
 * Allow only inline HTML safe for slide screenshots; enforce readable contrast.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeSlideHtml(raw) {
  let html = String(raw || '').trim();
  if (!html) return '';

  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  html = html.replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\s*([^>]*)>/gi, (full, slash, tagName, attrs) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';

    if (tag === 'br') return '<br>';

    if (slash) return `</${tag}>`;

    if (tag === 'span') {
      const styleMatch = attrs.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i);
      const styleRaw = styleMatch ? styleMatch[2] || styleMatch[3] : '';
      const style = enforceReadableStyle(styleRaw);
      return style ? `<span style="${style}">` : '<span>';
    }

    return `<${tag}>`;
  });

  return enforceReadableSpans(html.trim());
}

module.exports = {
  sanitizeSlideHtml,
  enforceReadableStyle,
  MARK_PILL_BG,
  LIGHT_PILL_BG,
};

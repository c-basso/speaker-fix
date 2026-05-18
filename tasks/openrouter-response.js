'use strict';

/** Strip runaway `</</</...` loops and trim broken tails from model output. */
function cleanModelResponseText(text) {
  let s = String(text || '');

  s = s.replace(/(?:<\s*\/\s*>){3,}/gi, '');
  s = s.replace(/(<\/)+/gi, (m) => (m.length > 6 ? '' : m));

  const start = s.indexOf('{');
  if (start >= 0) {
    const tail = s.slice(start);
    const closeSpam = (tail.match(/<\//g) || []).length;
    if (closeSpam > 20) {
      const cut = tail.search(/(?:<\s*\/\s*>){4,}/i);
      if (cut > 0) {
        s = s.slice(0, start + cut);
      }
    }
  }

  return s.trim();
}

function isGarbageResponse(text) {
  const s = String(text || '');
  if (!s.trim()) return true;

  const closeTags = (s.match(/<\//g) || []).length;
  const openTags = (s.match(/<[^/!][^>]*>/g) || []).length;

  if (/(?:<\s*\/\s*>){6,}/i.test(s)) return true;
  if (closeTags > 40) return true;
  if (closeTags > openTags * 3 && closeTags > 15) return true;
  if (!s.includes('{') && closeTags > 8) return true;

  return false;
}

/**
 * Try to close truncated JSON (finish_reason=length).
 * @param {string} text
 */
function repairTruncatedJson(text) {
  let s = cleanModelResponseText(text);
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start);

  s = s.replace(/,\s*$/, '');
  s = s.replace(/,\s*"[^"]*$/, '');
  s = s.replace(/"[^"]*$/, '"');

  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
    }
  }

  if (inString) s += '"';
  while (stack.length) s += stack.pop();

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

module.exports = {
  cleanModelResponseText,
  isGarbageResponse,
  repairTruncatedJson,
};

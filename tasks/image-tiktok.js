'use strict';

const fs = require('fs/promises');
const path = require('path');
const sizeOf = require('image-size');

/** https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide#image_restrictions */
const MAX_LONG_EDGE = 1080;
const MAX_BYTES = 20 * 1024 * 1024;

async function inspectImage(filePath) {
  const buf = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  let width;
  let height;
  try {
    const dim = sizeOf(buf);
    width = dim.width;
    height = dim.height;
  } catch {
    return {
      filePath,
      name: path.basename(filePath),
      ok: false,
      reason: 'не удалось прочитать размер изображения',
      bytes: stat.size,
    };
  }
  const longEdge = Math.max(width, height);
  return {
    filePath,
    name: path.basename(filePath),
    width,
    height,
    longEdge,
    bytes: stat.size,
    ok: longEdge <= MAX_LONG_EDGE && stat.size <= MAX_BYTES,
    reason:
      longEdge > MAX_LONG_EDGE
        ? `длинная сторона ${longEdge}px > ${MAX_LONG_EDGE}px`
        : stat.size > MAX_BYTES
          ? `файл ${(stat.size / 1024 / 1024).toFixed(1)} MB > 20 MB`
          : null,
  };
}

async function validateImagesForTikTok(filePaths) {
  const reports = [];
  for (const p of filePaths) {
    reports.push(await inspectImage(p));
  }
  const bad = reports.filter((r) => !r.ok);
  return { ok: bad.length === 0, reports, bad };
}

function formatImageReport(r) {
  const dim =
    r.width != null ? `${r.width}×${r.height}px` : '?';
  const mb = (r.bytes / 1024 / 1024).toFixed(2);
  return `  ${r.name}: ${dim}, ${mb} MB — ${r.reason}`;
}

module.exports = {
  MAX_LONG_EDGE,
  MAX_BYTES,
  inspectImage,
  validateImagesForTikTok,
  formatImageReport,
};

'use strict';

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

/** Node.js 18+ global fetch (как в tasks/tiktok-oauth.js) */
function httpFetch(url, options) {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error(
      'global fetch недоступен — нужен Node.js 18+ (node -v)',
    );
  }
  return globalThis.fetch(url, options);
}

const {
  OPENROUTER_API_URL,
  getImageGenApiKey,
} = require('./openrouter-image-client.js');
const { formatSdkError } = require('./openrouter-client.js');
const { getInfographicAspect } = require('./infographic-aspect.js');

const DEFAULT_IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL || 'x-ai/grok-imagine-image-quality';

function extractImageUrlsFromResponse(data) {
  const msg = data?.choices?.[0]?.message;
  const urls = [];

  if (Array.isArray(msg?.images)) {
    for (const img of msg.images) {
      const url = img?.image_url?.url || img?.url;
      if (url) urls.push(url);
    }
  }

  const content = msg?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'image_url' && part.image_url?.url) {
        urls.push(part.image_url.url);
      }
    }
  }

  return urls;
}

async function saveImageUrlToFile(imageUrl, outPath, outputSize = null) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  let buf;
  if (/^data:image\//i.test(imageUrl)) {
    const m = /^data:image\/(\w+);base64,(.+)$/i.exec(imageUrl);
    if (!m) throw new Error('Invalid image data URL from OpenRouter');
    buf = Buffer.from(m[2], 'base64');
  } else {
    const res = await httpFetch(imageUrl);
    if (!res.ok) {
      throw new Error(
        `Failed to download image (${res.status}): ${imageUrl.slice(0, 80)}`,
      );
    }
    buf = Buffer.from(await res.arrayBuffer());
  }

  let pipeline = sharp(buf).rotate();
  if (outputSize?.width && outputSize?.height) {
    pipeline = pipeline.resize(outputSize.width, outputSize.height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
  }

  await pipeline.jpeg({ quality: 92, mozjpeg: true }).toFile(outPath);
  return outPath;
}

/**
 * @param {string} prompt
 * @param {{ model?: string, outPath?: string, log?: boolean }} [options]
 */
async function generateImage(prompt, options = {}) {
  const model = options.model || DEFAULT_IMAGE_MODEL;
  const apiKey = getImageGenApiKey();
  const log = options.log !== false;

  const aspect = options.aspect || getInfographicAspect();

  const body = {
    model,
    messages: [{ role: 'user', content: String(prompt).trim() }],
    modalities: ['image'],
    stream: false,
    image_config: {
      aspect_ratio: aspect.ratio,
    },
  };

  if (log) {
    console.log(`[openrouter-image] model=${model} aspect=${aspect.ratio} (${aspect.width}×${aspect.height})`);
    console.log(`[openrouter-image] prompt (${prompt.length} chars):\n${prompt.slice(0, 500)}${prompt.length > 500 ? '…' : ''}`);
  }

  let res;
  try {
    res = await httpFetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://github.com/speaker-fix',
        'X-Title': process.env.OPENROUTER_APP_TITLE || 'speaker-fix',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw formatSdkError(err);
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenRouter image API: non-JSON response (${res.status}): ${raw.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || raw.slice(0, 300);
    throw new Error(`OpenRouter image API ${res.status}: ${msg}`);
  }

  const urls = extractImageUrlsFromResponse(data);
  if (!urls.length) {
    throw new Error(
      'OpenRouter image API: no images in response. Check model and OPENROUTER_IMAGE_GEN_KEY.',
    );
  }

  if (log) {
    const usage = data?.usage;
    if (usage) {
      console.log(
        `[openrouter-image] tokens: prompt=${usage.prompt_tokens ?? usage.promptTokens ?? '?'} completion=${usage.completion_tokens ?? usage.completionTokens ?? '?'}`,
      );
    }
    console.log(`[openrouter-image] got ${urls.length} image(s)`);
  }

  const imageUrl = urls[0];
  if (!options.outPath) {
    return { imageUrl, model, usage: data?.usage };
  }

  const saved = await saveImageUrlToFile(imageUrl, options.outPath, {
    width: aspect.width,
    height: aspect.height,
  });
  return {
    imageUrl,
    outPath: saved,
    model,
    usage: data?.usage,
    aspect: aspect.ratio,
  };
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  generateImage,
  saveImageUrlToFile,
  extractImageUrlsFromResponse,
};

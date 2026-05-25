'use strict';

const fs = require('fs/promises');
const path = require('path');

/** TikTok принимает только JPEG и WebP: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide */
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.webp']);
const IMAGE_EXT_UNSUPPORTED = new Set(['.png', '.gif', '.heic', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);

const DEFAULT_PUBLIC_BASE = 'https://c-basso.github.io/speaker-fix';
const { MAX_SLIDES } = require('./post-slides.js');

function publicBaseUrl() {
  const base = (
    process.env.TIKTOK_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE
  ).replace(/\/$/, '');
  return base;
}

function joinPublicUrl(...segments) {
  return `${publicBaseUrl()}/${segments.map((s) => encodeURIComponent(s)).join('/')}`;
}

function mediaKind(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (IMAGE_EXT_UNSUPPORTED.has(ext)) return 'unsupported-image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

async function nextPostSlug(postsDir) {
  const slugs = await listPostSlugs(postsDir);
  let max = 0;
  for (const s of slugs) {
    const m = /^post(\d+)$/i.exec(s);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `post${max + 1}`;
}

async function listPostSlugs(postsDir) {
  let entries;
  try {
    entries = await fs.readdir(postsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

async function loadPostMeta(postDir) {
  const metaPath = path.join(postDir, 'post.json');
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw);
    return {
      title: meta.title ?? meta.caption ?? undefined,
      description: meta.description ?? undefined,
    };
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function scanPostFolder(postDir, slug) {
  const names = await fs.readdir(postDir);
  const files = [];
  for (const name of names.sort()) {
    if (name.startsWith('.') || name.startsWith('_') || name === 'post.json') {
      continue;
    }
    const kind = mediaKind(name);
    if (kind === 'unsupported-image') {
      throw new Error(
        `${name}: TikTok поддерживает только .jpg, .jpeg, .webp (не .png/.gif)`,
      );
    }
    if (!kind) continue;
    const stat = await fs.stat(path.join(postDir, name));
    if (!stat.isFile()) continue;
    files.push({
      name,
      kind,
      localPath: path.join(postDir, name),
      publicUrl: joinPublicUrl('posts', slug, name),
    });
  }
  const images = files.filter((f) => f.kind === 'image');
  const videos = files.filter((f) => f.kind === 'video');
  const meta = await loadPostMeta(postDir);
  return { slug, postDir, files, images, videos, meta };
}

async function checkUrlAccessible(url) {
  let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (res.ok) return { ok: true, status: res.status };
  if (res.status === 405 || res.status === 501) {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: 'bytes=0-0' },
    });
  }
  return { ok: res.ok, status: res.status };
}

async function verifyPublicUrls(files) {
  const results = [];
  for (const file of files) {
    const check = await checkUrlAccessible(file.publicUrl);
    results.push({ file, ...check });
  }
  return results;
}

function classifyPost(scan) {
  const { images, videos } = scan;
  if (images.length === 0 && videos.length === 0) {
    return {
      type: 'empty',
      error:
        'В папке нет поддерживаемых медиа (.jpg, .jpeg, .webp или .mp4, …)',
    };
  }
  if (videos.length > 0 && images.length > 0) {
    return {
      type: 'mixed',
      error: 'В одной папке не смешивайте фото и видео — только картинки или одно видео',
    };
  }
  if (videos.length > 1) {
    return { type: 'multi-video', error: 'В папке больше одного видео' };
  }
  if (videos.length === 1) {
    return { type: 'video', video: videos[0] };
  }
  if (images.length > MAX_SLIDES) {
    return {
      type: 'too-many-photos',
      error: `В посте ${images.length} фото — максимум ${MAX_SLIDES} (01.jpg … ${String(MAX_SLIDES).padStart(2, '0')}.jpg)`,
    };
  }
  return { type: 'photo', images };
}

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  publicBaseUrl,
  joinPublicUrl,
  listPostSlugs,
  nextPostSlug,
  scanPostFolder,
  checkUrlAccessible,
  verifyPublicUrls,
  classifyPost,
};

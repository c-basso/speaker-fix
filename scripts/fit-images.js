'use strict';

/**
 * Уменьшает фото в posts/ под лимиты TikTok (1080px по длинной стороне, ≤20 MB).
 * Использование: npm run posts:fit [slug]
 */

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const {
  inspectImage,
  MAX_LONG_EDGE,
} = require('../tasks/image-tiktok.js');
const { listPostSlugs, scanPostFolder } = require('../tasks/posts.js');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'posts');

async function fitOneFile(filePath) {
  const before = await inspectImage(filePath);
  if (before.ok) {
    console.log(
      `  пропуск (OK): ${before.name} ${before.width}×${before.height}`,
    );
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const outPath = ext === '.webp' ? filePath : path.join(dir, `${base}.jpg`);
  const tmp = `${outPath}.tmp`;

  let pipeline = sharp(filePath).rotate();
  if (before.longEdge > MAX_LONG_EDGE) {
    pipeline = pipeline.resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (ext === '.webp') {
    await pipeline.webp({ quality: 85 }).toFile(tmp);
  } else {
    await pipeline.jpeg({ quality: 85, mozjpeg: true }).toFile(tmp);
  }

  await fs.rename(tmp, outPath);
  if (outPath !== filePath) {
    await fs.unlink(filePath).catch(() => {});
  }

  const after = await inspectImage(outPath);
  console.log(
    `  ✓ ${path.basename(outPath)} → ${after.width}×${after.height}, ${(after.bytes / 1024 / 1024).toFixed(2)} MB`,
  );
  return true;
}

async function fitPost(slug) {
  const postDir = path.join(POSTS_DIR, slug);
  const scan = await scanPostFolder(postDir, slug);
  if (!scan.images.length) {
    console.log(`  нет фото в ${slug}`);
    return;
  }
  console.log(`\n${slug}:`);
  for (const img of scan.images) {
    await fitOneFile(img.localPath);
  }
}

async function main() {
  const slug = process.argv[2];
  await fs.mkdir(POSTS_DIR, { recursive: true });
  if (slug) {
    await fitPost(slug);
    return;
  }
  const slugs = await listPostSlugs(POSTS_DIR);
  if (!slugs.length) {
    console.log('posts/ пуста');
    return;
  }
  for (const s of slugs) await fitPost(s);
  console.log('\nЗалейте обновлённые файлы на GitHub Pages и снова npm run post');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

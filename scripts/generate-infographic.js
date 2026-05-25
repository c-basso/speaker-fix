'use strict';

/**
 * Одна картинка: npm run generate-infographic -- "topic" --single --out ./x.jpg
 * Карусель в posts/postN (как create-post): npm run generate-infographic -- "topic"
 * То же через create-post: npm run create-post -- --type infographic "topic"
 */

require('../load-env');

const fs = require('fs/promises');
const path = require('path');

const { buildInfographicPrompt } = require('../tasks/infographic-prompt.js');
const { generateImage } = require('../tasks/openrouter-image-gen.js');
const { generateInfographicPostContent } = require('../tasks/openrouter-infographic-content.js');
const { createInfographicPost } = require('../tasks/create-infographic-post.js');
const { nextPostSlug } = require('../tasks/posts.js');
const { INFOGRAPHIC_SLIDE_COUNT } = require('../tasks/post-types.js');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'posts');

function usage() {
  return [
    'Usage: npm run generate-infographic -- <topic> [options]',
    '',
    'Default: full carousel → posts/postN/ (01.jpg …, post.json, TikTok-ready)',
    '',
    'Options:',
    '  --single         One image only (not a post folder)',
    '  --slides N       Slide count (default: 7, use 6 with --slides 6)',
    '  --title TEXT     Bold headline (single mode)',
    '  --top TEXT       Top section (--single)',
    '  --bottom TEXT    Bottom section (--single)',
    '  --out PATH       Output file (--single only)',
    '',
    'Recommended:',
    `  npm run create-post -- --type infographic "your theme and context"`,
    '',
    'Env: OPENROUTER_API_KEY, OPENROUTER_IMAGE_GEN_KEY',
  ].join('\n');
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function parseArgv(argv) {
  let topic = '';
  let imageTitle = '';
  let topSection = '';
  let bottomSection = '';
  let outPath = '';
  let single = false;
  let slideCount = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--title') {
      imageTitle = argv[++i] || '';
      continue;
    }
    if (arg === '--top') {
      topSection = argv[++i] || '';
      continue;
    }
    if (arg === '--bottom') {
      bottomSection = argv[++i] || '';
      continue;
    }
    if (arg === '--out') {
      outPath = argv[++i] || '';
      continue;
    }
    if (arg === '--single') {
      single = true;
      continue;
    }
    if (arg === '--slides' || arg === '-n') {
      slideCount = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    topic = topic ? `${topic} ${arg}` : arg;
  }

  if (!topic.trim()) {
    throw new Error('Topic is required');
  }

  const manualSingle = Boolean(topSection || bottomSection || outPath);
  if (manualSingle && !single) {
    single = true;
  }

  return {
    topic: topic.trim(),
    imageTitle,
    topSection,
    bottomSection,
    outPath,
    single,
    slideCount,
  };
}

async function runSingleSlide(parsed) {
  let { topic, imageTitle, topSection, bottomSection, outPath } = parsed;

  if (!topSection || !bottomSection) {
    console.log('[generate-infographic] OpenRouter text — 1 slide spec…');
    const content = await generateInfographicPostContent(topic, { slideCount: 1 });
    const slide = content.slides[0];
    imageTitle = imageTitle || slide.imageTitle;
    topSection = topSection || slide.topSection;
    bottomSection = bottomSection || slide.bottomSection;
    topic = slide.topic || topic;
  }

  if (!imageTitle) {
    imageTitle = topic.toUpperCase().slice(0, 48);
  }

  const prompt = buildInfographicPrompt({
    topic,
    imageTitle,
    topSection,
    bottomSection,
  });

  const defaultOut = path.join(
    process.cwd(),
    `infographic-${slugify(topic) || 'slide'}.jpg`,
  );
  const target = outPath ? path.resolve(outPath) : defaultOut;

  console.log('\n[generate-infographic] OpenRouter Image…');
  await generateImage(prompt, { outPath: target });

  const promptSidecar = target.replace(/\.jpe?g$/i, '.prompt.txt');
  await fs.writeFile(promptSidecar, `${prompt}\n`, 'utf8');

  console.log(`\nSaved: ${target}`);
  console.log(`Prompt: ${promptSidecar}`);
}

async function runCarouselPost(parsed) {
  const slug = await nextPostSlug(POSTS_DIR);
  const postDir = path.join(POSTS_DIR, slug);
  await fs.mkdir(postDir, { recursive: true });

  const slides = parsed.slideCount ?? INFOGRAPHIC_SLIDE_COUNT;
  console.log(`\n=== ${slug} ===`);
  console.log(`Тип: инфографика (карусель ${slides} слайдов)`);
  console.log(`Тема: ${parsed.topic}\n`);

  await createInfographicPost({
    root: ROOT,
    postDir,
    slug,
    topic: parsed.topic,
    slideCountOverride: parsed.slideCount,
    context: parsed.topic,
  });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(`\n${usage()}`);
    process.exit(1);
  }

  if (parsed.single) {
    await runSingleSlide(parsed);
    return;
  }

  await runCarouselPost(parsed);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

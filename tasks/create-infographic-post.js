'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execSync } = require('child_process');

const { generateInfographicPostContent } = require('./openrouter-infographic-content.js');
const { buildInfographicPrompt } = require('./infographic-prompt.js');
const {
  generateImage,
  DEFAULT_IMAGE_MODEL,
} = require('./openrouter-image-gen.js');
const { getInfographicAspect } = require('./infographic-aspect.js');

function padSlide(n) {
  return String(n).padStart(2, '0');
}

async function fitPostImages(root, slug) {
  try {
    execSync(`node "${path.join(root, 'scripts', 'fit-images.js')}" ${slug}`, {
      stdio: 'inherit',
      cwd: root,
    });
  } catch {
    console.warn('posts:fit не выполнен — проверьте размеры вручную');
  }
}

/**
 * @param {{
 *   root: string,
 *   postDir: string,
 *   slug: string,
 *   topic: string,
 *   slideCountOverride?: number | null,
 *   context?: string,
 * }} ctx
 */
async function createInfographicPost(ctx) {
  const { root, postDir, slug, topic, slideCountOverride, context } = ctx;

  const aspect = getInfographicAspect();
  console.log(`   формат: ${aspect.ratio} (${aspect.width}×${aspect.height})`);

  console.log('1/3 OpenRouter — caption + infographic specs…');
  const content = await generateInfographicPostContent(topic, {
    slideCount: slideCountOverride,
    context: context || topic,
  });
  console.log(`   title: ${content.title}`);
  console.log(`   слайдов: ${content.slideCount}`);

  const promptsDir = path.join(postDir, '_prompts');
  await fs.mkdir(promptsDir, { recursive: true });

  console.log('\n2/3 OpenRouter Image — генерация слайдов…');
  const slideFiles = [];
  const imageGenSlides = [];

  for (let i = 0; i < content.slides.length; i += 1) {
    const slide = content.slides[i];
    const fileName = `${padSlide(i + 1)}.jpg`;
    const outPath = path.join(postDir, fileName);
    const prompt = buildInfographicPrompt({
      topic: slide.topic,
      imageTitle: slide.imageTitle,
      topSection: slide.topSection,
      bottomSection: slide.bottomSection,
    });

    const promptPath = path.join(promptsDir, `${padSlide(i + 1)}.txt`);
    await fs.writeFile(promptPath, `${prompt}\n`, 'utf8');

    console.log(`   [${i + 1}/${content.slides.length}] ${slide.imageTitle}…`);
    await generateImage(prompt, { outPath, log: i === 0 });
    slideFiles.push(fileName);
    imageGenSlides.push({
      file: fileName,
      imageTitle: slide.imageTitle,
      topic: slide.topic,
      promptFile: `_prompts/${padSlide(i + 1)}.txt`,
    });
    console.log(`   ✓ ${fileName}`);
  }

  const slidesMeta = content.slides.map((slide, i) => ({
    file: slideFiles[i],
    slideRole: slide.slideRole,
    imageTitle: slide.imageTitle,
    topic: slide.topic,
    topSection: slide.topSection,
    bottomSection: slide.bottomSection,
    index: slide.index ?? i + 1,
  }));

  const meta = {
    postType: 'infographic',
    title: content.title,
    description: content.description,
    topic,
    slideCount: content.slideCount,
    slides: slidesMeta,
    files: slideFiles,
    imageGen: {
      model: DEFAULT_IMAGE_MODEL,
      aspectRatio: aspect.ratio,
      width: aspect.width,
      height: aspect.height,
      slides: imageGenSlides,
    },
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(postDir, 'post.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );

  console.log('\n3/3 Подгонка под TikTok (≤1080px)…');
  await fitPostImages(root, slug);

  console.log(`\nГотово: posts/${slug}/`);
  console.log('Дальше: git push на GitHub Pages → npm run post');
}

module.exports = { createInfographicPost };

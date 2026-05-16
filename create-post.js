'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execSync } = require('child_process');

require('./load-env');

const { generatePostContent } = require('./tasks/openrouter-content.js');
const { fetchBackgroundPhoto } = require('./tasks/unsplash-photos.js');
const { takeHtmlPageScreenshot } = require('./tasks/render-slide.js');
const { listPostSlugs } = require('./tasks/posts.js');
const {
  parseCreatePostArgv,
  createPostUsage,
} = require('./tasks/post-slides.js');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'slide.html');

async function nextPostSlug() {
  const slugs = await listPostSlugs(POSTS_DIR);
  let max = 0;
  for (const s of slugs) {
    const m = /^post(\d+)$/i.exec(s);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `post${max + 1}`;
}

function padSlide(n) {
  return String(n).padStart(2, '0');
}

async function fitPostImages(slug) {
  try {
    execSync(`node "${path.join(ROOT, 'scripts', 'fit-images.js')}" ${slug}`, {
      stdio: 'inherit',
      cwd: ROOT,
    });
  } catch {
    console.warn('posts:fit не выполнен — проверьте размеры вручную');
  }
}

async function main() {
  let slideCountOverride;
  let topic;
  try {
    ({ slideCount: slideCountOverride, topic } = parseCreatePostArgv(
      process.argv.slice(2),
    ));
  } catch (err) {
    console.error(err.message);
    console.error(`\n${createPostUsage()}`);
    process.exit(1);
  }

  if (!topic) {
    console.error(createPostUsage());
    process.exit(1);
  }
  const slug = await nextPostSlug();
  const postDir = path.join(POSTS_DIR, slug);
  await fs.mkdir(postDir, { recursive: true });

  console.log(`\n=== ${slug} ===`);
  console.log(`Тема: ${topic}`);
  if (slideCountOverride != null) {
    console.log(`Слайдов (задано): ${slideCountOverride}`);
  } else {
    console.log('Слайдов: OpenRouter выберет сам');
  }
  console.log('');

  console.log('1/4 OpenRouter — title, description, слайды…');
  const content = await generatePostContent(topic, {
    slideCount: slideCountOverride,
  });
  const slideCount = content.slideCount;
  console.log(`   title: ${content.title}`);
  console.log(`   unsplash: ${content.unsplashQuery}`);
  console.log(`   слайдов: ${slideCount}`);

  const assetsDir = path.join(postDir, '_assets');
  await fs.mkdir(assetsDir, { recursive: true });

  const bgPath = path.join(postDir, '_background.jpg');
  let primaryBg = null;
  if (slideCount === 1) {
    console.log('\n2/4 Unsplash — фон…');
    primaryBg = await fetchBackgroundPhoto(content.unsplashQuery, bgPath);
  } else {
    console.log('\n2/4 Unsplash — фон для каждого слайда…');
  }

  console.log('\n3/4 Playwright — скриншоты слайдов…');
  const slideFiles = [];
  const slideBackgrounds = [];
  for (let i = 0; i < content.slides.length; i += 1) {
    const slide = content.slides[i];
    const fileName = `${padSlide(i + 1)}.jpg`;
    const screenshotPath = path.join(postDir, fileName);
    const slideBgQuery = slide.unsplashQuery || content.unsplashQuery;
    let bgForSlide = bgPath;
    const customBg =
      slide.unsplashQuery && slide.unsplashQuery !== content.unsplashQuery;

    if (customBg) {
      bgForSlide = path.join(assetsDir, `bg-${padSlide(i + 1)}.jpg`);
      const bg = await fetchBackgroundPhoto(slideBgQuery, bgForSlide);
      slideBackgrounds.push(bg);
    } else if (slideCount > 1) {
      bgForSlide = path.join(assetsDir, `bg-${padSlide(i + 1)}.jpg`);
      const bg = await fetchBackgroundPhoto(slideBgQuery, bgForSlide, {
        index: i,
      });
      slideBackgrounds.push(bg);
    } else if (primaryBg) {
      slideBackgrounds.push(primaryBg);
    }

    await takeHtmlPageScreenshot({
      templatePath: TEMPLATE_PATH,
      screenshotPath,
      backgroundImagePath: bgForSlide,
      title: slide.title,
      description: slide.description,
      bg: true,
    });
    slideFiles.push(fileName);
    console.log(`   ✓ ${fileName}`);
  }

  const meta = {
    title: content.title,
    description: content.description,
    topic,
    slideCount,
    slides: content.slides,
    files: slideFiles,
    unsplash: {
      query: content.unsplashQuery,
      photoId: (primaryBg || slideBackgrounds[0])?.id,
      author: (primaryBg || slideBackgrounds[0])?.user,
      slides: slideBackgrounds.map((bg, idx) => ({
        file: slideFiles[idx],
        photoId: bg?.id,
        author: bg?.user,
      })),
    },
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(postDir, 'post.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );

  console.log('\n4/4 Подгонка под TikTok (≤1080px)…');
  await fitPostImages(slug);

  console.log(`\nГотово: posts/${slug}/`);
  console.log('Дальше: git push на GitHub Pages → npm run post');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

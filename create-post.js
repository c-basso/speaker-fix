'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execSync } = require('child_process');

require('./load-env');

const { generatePostContent } = require('./tasks/openrouter-content.js');
const { fetchBackgroundPhoto } = require('./tasks/unsplash-photos.js');
const { takeHtmlPageScreenshot } = require('./tasks/render-slide.js');
const { nextPostSlug } = require('./tasks/posts.js');
const {
  parseCreatePostArgv,
  createPostUsage,
  POST_TYPE_APP_AD,
  POST_TYPE_INFOGRAPHIC,
  INFOGRAPHIC_SLIDE_COUNT,
} = require('./tasks/post-types.js');
const { createInfographicPost } = require('./tasks/create-infographic-post.js');
const { resolveCreatePostInput } = require('./tasks/resolve-create-post.js');
const {
  resolveAppAssets,
  slideUsesScreenshotBackground,
  slideShowsLogo,
  pickScreenshotForSlide,
  appendWebsiteToHtml,
} = require('./tasks/app-assets.js');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'slide.html');

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
  let parsed;
  try {
    parsed = parseCreatePostArgv(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(`\n${createPostUsage()}`);
    process.exit(1);
  }

  let input;
  try {
    input = await resolveCreatePostInput(parsed);
  } catch (err) {
    console.error(err.message);
    console.error(`\n${createPostUsage()}`);
    process.exit(1);
  }

  if (input.listApps) {
    const { listAppsCatalog } = require('./tasks/apps-catalog.js');
    console.log(await listAppsCatalog());
    return;
  }

  const {
    postType,
    appName,
    appId,
    topic,
    slideCount: slideCountOverride,
    appProfile,
    appAssets: catalogAssets,
  } = input;

  let appAssets = catalogAssets;
  if (appProfile && !appAssets) {
    appAssets = await resolveAppAssets(appProfile, ROOT);
  }
  if (appAssets?.logo) console.log(`   logo: ${appAssets.logo}`);
  if (appAssets?.screenshots?.length) {
    console.log(`   screenshots: ${appAssets.screenshots.length}`);
  }
  if (appAssets?.website) console.log(`   website: ${appAssets.website}`);

  const slug = await nextPostSlug(POSTS_DIR);
  const postDir = path.join(POSTS_DIR, slug);
  await fs.mkdir(postDir, { recursive: true });

  console.log(`\n=== ${slug} ===`);
  const typeLabel =
    postType === POST_TYPE_APP_AD
      ? 'реклама приложения'
      : postType === POST_TYPE_INFOGRAPHIC
        ? 'инфографика (AI image)'
        : 'тема';
  console.log(`Тип: ${typeLabel}`);

  if (postType === POST_TYPE_INFOGRAPHIC) {
    if (topic) console.log(`Тема: ${topic}`);
    if (slideCountOverride != null) {
      console.log(`Слайдов (задано): ${slideCountOverride}`);
    } else {
      console.log(`Слайдов: ${INFOGRAPHIC_SLIDE_COUNT} (карусель infographic)`);
    }
    console.log('');
    await createInfographicPost({
      root: ROOT,
      postDir,
      slug,
      topic: topic || 'health tips',
      slideCountOverride,
      context: topic,
    });
    return;
  }
  if (postType === POST_TYPE_APP_AD) {
    console.log(`Приложение: ${appName}${appId ? ` (${appId})` : ''}`);
    if (appProfile?.tagline) console.log(`   ${appProfile.tagline}`);
  }
  if (topic) {
    console.log(
      postType === POST_TYPE_APP_AD ? `Контекст для AI:\n${topic}` : `Тема: ${topic}`,
    );
  }
  if (slideCountOverride != null) {
    console.log(`Слайдов (задано): ${slideCountOverride}`);
  } else {
    console.log('Слайдов: OpenRouter выберет сам');
  }
  console.log('');

  console.log('1/4 OpenRouter — title, description, слайды…');
  const content = await generatePostContent(topic, {
    slideCount: slideCountOverride,
    postType,
    appName,
    websiteUrl: appAssets?.website ?? null,
  });
  const slideCount = content.slideCount;
  console.log(`   title: ${content.title}`);
  console.log(`   unsplash: ${content.unsplashQuery}`);
  console.log(`   слайдов: ${slideCount}`);

  const assetsDir = path.join(postDir, '_assets');
  await fs.mkdir(assetsDir, { recursive: true });

  const bgPath = path.join(postDir, '_background.jpg');
  let primaryBg = null;
  const needsUnsplash = content.slides.some(
    (s, idx) => !slideUsesScreenshotBackground(s, appAssets),
  );

  if (needsUnsplash) {
    if (slideCount === 1) {
      console.log('\n2/4 Unsplash — фон…');
      primaryBg = await fetchBackgroundPhoto(content.unsplashQuery, bgPath);
    } else {
      console.log('\n2/4 Unsplash — фон для слайдов без скриншотов аппа…');
    }
  } else {
    console.log('\n2/4 Фоны — скриншоты приложения');
  }

  console.log('\n3/4 Playwright — слайды…');
  const slideFiles = [];
  const slideBackgrounds = [];
  let screenshotPick = 0;

  for (let i = 0; i < content.slides.length; i += 1) {
    const slide = content.slides[i];
    const fileName = `${padSlide(i + 1)}.jpg`;
    const screenshotPath = path.join(postDir, fileName);
    const useAppBg = slideUsesScreenshotBackground(slide, appAssets);
    const slideBgQuery = slide.unsplashQuery || content.unsplashQuery;
    let bgForSlide = null;
    let appScreenshotBackground = false;
    let phoneOverlay = '';

    if (useAppBg) {
      bgForSlide = pickScreenshotForSlide(appAssets, screenshotPick);
      screenshotPick += 1;
      appScreenshotBackground = true;
      slideBackgrounds.push({ id: 'app-screenshot', localPath: bgForSlide });
    } else if (
      slide.role === 'experience' &&
      appAssets?.screenshots?.length
    ) {
      phoneOverlay = pickScreenshotForSlide(appAssets, screenshotPick);
      screenshotPick += 1;
    }

    if (!useAppBg) {
      bgForSlide = bgPath;
      const customBg =
        slide.unsplashQuery && slide.unsplashQuery !== content.unsplashQuery;

      if (customBg) {
        bgForSlide = path.join(assetsDir, `bg-${padSlide(i + 1)}.jpg`);
        const bg = await fetchBackgroundPhoto(slideBgQuery, bgForSlide);
        slideBackgrounds.push(bg);
      } else if (slideCount > 1 || !primaryBg) {
        bgForSlide = path.join(assetsDir, `bg-${padSlide(i + 1)}.jpg`);
        const bg = await fetchBackgroundPhoto(slideBgQuery, bgForSlide, {
          index: i,
        });
        slideBackgrounds.push(bg);
      } else if (primaryBg) {
        slideBackgrounds.push(primaryBg);
      }
    }

    let descriptionHtml = slide.description;
    if (slide.role === 'cta' && appAssets?.website) {
      descriptionHtml = appendWebsiteToHtml(descriptionHtml, appAssets.website);
    }

    const logoPath = slideShowsLogo(slide, appAssets) ? appAssets.logo : '';

    await takeHtmlPageScreenshot({
      templatePath: TEMPLATE_PATH,
      screenshotPath,
      backgroundImagePath: bgForSlide,
      title: slide.title,
      description: descriptionHtml,
      logoPath,
      phoneScreenshotPath: phoneOverlay || '',
      appScreenshotBackground,
      bg: true,
    });
    slideFiles.push(fileName);
    const parts = [fileName];
    if (slide.role) parts.push(`[${slide.role}]`);
    if (logoPath) parts.push('+logo');
    if (useAppBg) parts.push('+app-bg');
    console.log(`   ✓ ${parts.join(' ')}`);
  }

  const meta = {
    postType,
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
  if (postType === POST_TYPE_APP_AD) {
    meta.appName = appName;
    if (appId) meta.appId = appId;
    if (appProfile) {
      meta.app = {
        id: appProfile.id,
        name: appProfile.name,
        website: appProfile.website || undefined,
      };
    }
    if (appAssets) {
      meta.appAssets = {
        logo: appProfile?.logo || null,
        screenshots: appProfile?.screenshots || [],
        website: appAssets.website,
      };
    }
  }

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

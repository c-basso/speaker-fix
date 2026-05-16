'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1920;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSlideUrl(templatePath, params) {
  const q = new URLSearchParams();
  if (params.title) q.set('title', params.title);
  if (params.description) q.set('description', params.description);
  if (params.image) q.set('image', params.image);
  if (params.logo) q.set('logo', params.logo);
  if (params.logoCaption) q.set('logoCaption', params.logoCaption);
  if (params.bg) q.set('bg', '1');

  const fileUrl = pathToFileURL(path.resolve(templatePath));
  fileUrl.search = q.toString();
  return fileUrl.href;
}

/**
 * @param {object} options
 * @param {string} options.templatePath
 * @param {string} [options.url]
 * @param {string} options.screenshotPath
 * @param {string} [options.backgroundImagePath] — file:// для фона
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {string} [options.logoCaption]
 * @param {boolean} [options.bg]
 */
async function takeHtmlPageScreenshot(options) {
  const {
    templatePath,
    url,
    screenshotPath,
    backgroundImagePath,
    title,
    description,
    logo,
    logoCaption,
    bg = true,
    width = SLIDE_WIDTH,
    height = SLIDE_HEIGHT,
  } = options;

  const targetUrl =
    url ||
    buildSlideUrl(templatePath, {
      title,
      description,
      image: backgroundImagePath
        ? pathToFileURL(path.resolve(backgroundImagePath)).href
        : '',
      logo: logo ? pathToFileURL(path.resolve(logo)).href : '',
      logoCaption,
      bg: bg ? '1' : '',
    });

  console.log('[screenshot]', screenshotPath);
  console.log('[screenshot] url:', targetUrl.slice(0, 120) + '…');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });
    page.setDefaultNavigationTimeout(60_000);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await sleep(500);
    await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 90 });
  } finally {
    await browser.close();
  }
}

module.exports = {
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  buildSlideUrl,
  takeHtmlPageScreenshot,
};

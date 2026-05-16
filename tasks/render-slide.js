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
  if (params.image) q.set('image', params.image);
  if (params.bg) q.set('bg', '1');

  const fileUrl = pathToFileURL(path.resolve(templatePath));
  fileUrl.search = q.toString();
  return fileUrl.href;
}

async function injectSlideHtml(page, { titleHtml, descriptionHtml, bg }) {
  await page.evaluate(
    ({ titleHtml: t, descriptionHtml: d, useBg }) => {
      const msg = document.querySelector('.message');
      if (!msg) return;
      msg.innerHTML = '';
      if (t) {
        const el = document.createElement('div');
        el.className = useBg ? 'title bg' : 'title';
        el.innerHTML = t;
        msg.appendChild(el);
      }
      if (d) {
        const el = document.createElement('div');
        el.className = useBg ? 'description bg' : 'description';
        el.innerHTML = d;
        msg.appendChild(el);
      }
    },
    {
      titleHtml: titleHtml || '',
      descriptionHtml: descriptionHtml || '',
      bg: Boolean(bg),
    },
  );
}

/**
 * @param {object} options
 * @param {string} options.templatePath
 * @param {string} [options.url]
 * @param {string} options.screenshotPath
 * @param {string} [options.backgroundImagePath]
 * @param {string} [options.title] — HTML fragment
 * @param {string} [options.description] — HTML fragment
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
    bg = true,
    width = SLIDE_WIDTH,
    height = SLIDE_HEIGHT,
  } = options;

  const targetUrl =
    url ||
    buildSlideUrl(templatePath, {
      image: backgroundImagePath
        ? pathToFileURL(path.resolve(backgroundImagePath)).href
        : '',
      bg: bg ? '1' : '',
    });

  console.log('[screenshot]', screenshotPath);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });
    page.setDefaultNavigationTimeout(60_000);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await injectSlideHtml(page, {
      titleHtml: title,
      descriptionHtml: description,
      bg,
    });
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
  injectSlideHtml,
};

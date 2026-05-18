'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1920;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileHref(filePath) {
  if (!filePath) return '';
  return pathToFileURL(path.resolve(filePath)).href;
}

function buildSlideUrl(templatePath, params) {
  const q = new URLSearchParams();
  if (params.image) q.set('image', params.image);
  if (params.bg) q.set('bg', '1');
  if (params.appBg) q.set('appBg', '1');

  const fileUrl = pathToFileURL(path.resolve(templatePath));
  fileUrl.search = q.toString();
  return fileUrl.href;
}

/**
 * @param {import('playwright').Page} page
 */
async function injectSlideHtml(page, options) {
  const {
    titleHtml = '',
    descriptionHtml = '',
    bg = true,
    logoPath = '',
    phoneScreenshotPath = '',
  } = options;

  await page.evaluate(
    ({ titleHtml: t, descriptionHtml: d, useBg, logoHref, phoneHref }) => {
      const msg = document.querySelector('.message');
      if (!msg) return;
      msg.innerHTML = '';

      if (logoHref) {
        const logo = document.createElement('div');
        logo.className = 'logo';
        const img = document.createElement('img');
        img.src = logoHref;
        img.alt = '';
        logo.appendChild(img);
        msg.appendChild(logo);
      }

      if (phoneHref) {
        const phone = document.createElement('div');
        phone.className = 'phone-shot';
        const img = document.createElement('img');
        img.src = phoneHref;
        img.alt = '';
        phone.appendChild(img);
        msg.appendChild(phone);
      }

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
      titleHtml,
      descriptionHtml,
      useBg: Boolean(bg),
      logoHref: fileHref(logoPath),
      phoneHref: fileHref(phoneScreenshotPath),
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
 * @param {string} [options.logoPath]
 * @param {string} [options.phoneScreenshotPath] — overlay on top of bg
 * @param {boolean} [options.appScreenshotBackground] — screenshot fills frame
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
    logoPath,
    phoneScreenshotPath,
    appScreenshotBackground = false,
    bg = true,
    width = SLIDE_WIDTH,
    height = SLIDE_HEIGHT,
  } = options;

  const targetUrl =
    url ||
    buildSlideUrl(templatePath, {
      image: backgroundImagePath ? fileHref(backgroundImagePath) : '',
      bg: bg ? '1' : '',
      appBg: appScreenshotBackground ? '1' : '',
    });

  console.log('[screenshot]', screenshotPath);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });
    page.setDefaultNavigationTimeout(60_000);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    const overlayShot =
      appScreenshotBackground ? '' : phoneScreenshotPath;

    await injectSlideHtml(page, {
      titleHtml: title,
      descriptionHtml: description,
      bg,
      logoPath,
      phoneScreenshotPath: overlayShot,
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
  fileHref,
};

'use strict';

const fs = require('fs/promises');
const path = require('path');

/** Roles that use app screenshots as slide background */
const SCREENSHOT_BG_ROLES = new Set(['experience', 'transformation']);

/** Roles that show the app logo */
const LOGO_ROLES = new Set(['hook', 'intro', 'experience', 'cta']);

function projectRoot() {
  return path.join(__dirname, '..');
}

function resolveProjectPath(relativePath, root = projectRoot()) {
  if (!relativePath) return null;
  const p = String(relativePath).trim();
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

async function pathExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * @param {object} app — entry from apps.json
 * @param {string} [root]
 */
async function resolveAppAssets(app, root = projectRoot()) {
  const logoPath = resolveProjectPath(app.logo, root);
  let logo = null;
  if (logoPath) {
    if (await pathExists(logoPath)) {
      logo = logoPath;
    } else {
      console.warn(`[app] logo not found: ${logoPath}`);
    }
  }

  const rawShots = Array.isArray(app.screenshots) ? app.screenshots : [];
  const screenshots = [];
  for (const rel of rawShots) {
    const shotPath = resolveProjectPath(rel, root);
    if (!shotPath) continue;
    if (await pathExists(shotPath)) {
      screenshots.push(shotPath);
    } else {
      console.warn(`[app] screenshot not found: ${shotPath}`);
    }
  }

  const website = app.website ? String(app.website).trim() : '';

  return {
    logo,
    screenshots,
    website: website || null,
  };
}

function slideUsesScreenshotBackground(slide, assets) {
  if (!assets?.screenshots?.length) return false;
  if (!slide?.role) return false;
  return SCREENSHOT_BG_ROLES.has(slide.role);
}

function slideShowsLogo(slide, assets) {
  if (!assets?.logo) return false;
  if (!slide?.role) return false;
  return LOGO_ROLES.has(slide.role);
}

function pickScreenshotForSlide(assets, slideIndex) {
  const list = assets?.screenshots || [];
  if (!list.length) return null;
  return list[slideIndex % list.length];
}

function appendWebsiteToHtml(html, website) {
  if (!website) return html || '';
  const base = html || '';
  if (base.includes(website)) return base;
  const safe = website
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `${base}<br><span class="website-link">${safe}</span>`;
}

function appendWebsiteToCaption(caption, website) {
  if (!website) return caption || '';
  const base = String(caption || '').trim();
  if (base.includes(website)) return base;
  return base ? `${base}\n${website}` : website;
}

module.exports = {
  LOGO_ROLES,
  SCREENSHOT_BG_ROLES,
  resolveAppAssets,
  slideUsesScreenshotBackground,
  slideShowsLogo,
  pickScreenshotForSlide,
  appendWebsiteToHtml,
  appendWebsiteToCaption,
  resolveProjectPath,
};

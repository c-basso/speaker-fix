'use strict';

const fs = require('fs/promises');
const path = require('path');

const { POST_TYPE_APP_AD, normalizePostType } = require('./post-types.js');
const { resolveAppAssets } = require('./app-assets.js');

const DEFAULT_APPS_PATH = path.join(__dirname, '..', 'apps.json');

function appsPath() {
  return process.env.APPS_JSON_PATH
    ? path.resolve(process.env.APPS_JSON_PATH)
    : DEFAULT_APPS_PATH;
}

/**
 * @returns {Promise<Array<object>>}
 */
async function loadAppsCatalog(filePath = appsPath()) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `apps.json not found (${filePath}). Create it or set APPS_JSON_PATH.`,
      );
    }
    throw err;
  }

  const data = JSON.parse(raw);
  if (!Array.isArray(data.apps) || data.apps.length === 0) {
    throw new Error(`apps.json must contain a non-empty "apps" array`);
  }

  return data.apps.map((app, index) => ({
    ...app,
    _index: index + 1,
  }));
}

function normalizeRef(ref) {
  return String(ref || '').trim();
}

/**
 * @param {Array<object>} apps
 * @param {string} ref — "1", id, or name
 */
function findAppByRef(apps, ref) {
  const q = normalizeRef(ref);
  if (!q) return null;

  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return apps.find((a) => a._index === n) ?? null;
  }

  const lower = q.toLowerCase();
  const byId = apps.find((a) => String(a.id || '').toLowerCase() === lower);
  if (byId) return byId;

  const byName = apps.find(
    (a) => String(a.name || '').toLowerCase() === lower,
  );
  if (byName) return byName;

  return (
    apps.find((a) => String(a.id || '').toLowerCase().includes(lower)) ||
    apps.find((a) => String(a.name || '').toLowerCase().includes(lower)) ||
    null
  );
}

function buildAppContext(app, extraTopic = '') {
  const lines = [
    `App: ${app.name}`,
    app.tagline ? `Tagline: ${app.tagline}` : '',
    app.audience ? `Audience: ${app.audience}` : '',
    app.problem ? `Problem: ${app.problem}` : '',
  ];

  if (Array.isArray(app.features) && app.features.length) {
    lines.push(`Features: ${app.features.join('; ')}`);
  }
  if (Array.isArray(app.platforms) && app.platforms.length) {
    lines.push(`Platforms: ${app.platforms.join(', ')}`);
  }
  if (app.angle) {
    lines.push(`Angle: ${app.angle}`);
  }
  if (app.website) {
    lines.push(`Website (optional in CTA/caption): ${app.website}`);
  }
  if (extraTopic) {
    lines.push(`Extra angle from user: ${extraTopic}`);
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * @param {string} ref
 * @param {{ extraTopic?: string }} options
 */
async function resolveAppByRef(ref, options = {}) {
  const apps = await loadAppsCatalog();
  const app = findAppByRef(apps, ref);
  if (!app) {
    const names = apps
      .map((a) => `  ${a._index}. ${a.name} (${a.id})`)
      .join('\n');
    throw new Error(`App not found: "${ref}"\n\nAvailable:\n${names}`);
  }

  const postType = app.defaultPostType
    ? normalizePostType(app.defaultPostType)
    : POST_TYPE_APP_AD;

  const assets = await resolveAppAssets(app);

  return {
    app,
    appId: app.id,
    appName: app.name,
    postType,
    topic: buildAppContext(app, options.extraTopic || ''),
    hashtags: Array.isArray(app.hashtags) ? app.hashtags : [],
    assets,
  };
}

function formatAppsList(apps) {
  const lines = ['Apps in apps.json:\n'];
  for (const app of apps) {
    lines.push(`  ${app._index}. ${app.name}`);
    lines.push(`     id: ${app.id}`);
    if (app.tagline) lines.push(`     ${app.tagline}`);
    if (app.logo) lines.push(`     logo: ${app.logo}`);
    if (app.screenshots?.length) {
      lines.push(`     screenshots: ${app.screenshots.length} file(s)`);
    }
    if (app.website) lines.push(`     website: ${app.website}`);
    lines.push('');
  }
  lines.push('Usage:');
  lines.push('  npm run create-post -- 1');
  lines.push('  npm run create-post -- speaker-fix');
  lines.push('  npm run create-post -- "Speaker Fix" "optional extra context"');
  return lines.join('\n');
}

async function listAppsCatalog() {
  const apps = await loadAppsCatalog();
  return formatAppsList(apps);
}

/**
 * If the first topic token looks like an app ref, treat it as app selection.
 * @param {string} token
 * @param {Array<object>} apps
 */
function looksLikeAppRef(token, apps) {
  const q = normalizeRef(token);
  if (!q) return false;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return apps.some((a) => a._index === n);
  }
  return Boolean(findAppByRef(apps, q));
}

module.exports = {
  appsPath,
  loadAppsCatalog,
  findAppByRef,
  resolveAppByRef,
  buildAppContext,
  listAppsCatalog,
  looksLikeAppRef,
};

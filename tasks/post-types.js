'use strict';

const {
  slideCountFromEnv,
  clampSlideCount,
  MIN_SLIDES,
  MAX_SLIDES,
} = require('./post-slides.js');

const POST_TYPE_TOPIC = 'topic';
const POST_TYPE_APP_AD = 'app-ad';
const APP_AD_SLIDE_COUNT = 7;

const POST_TYPE_ALIASES = new Map([
  ['topic', POST_TYPE_TOPIC],
  ['general', POST_TYPE_TOPIC],
  ['app-ad', POST_TYPE_APP_AD],
  ['app', POST_TYPE_APP_AD],
  ['ad', POST_TYPE_APP_AD],
  ['реклама', POST_TYPE_APP_AD],
]);

function normalizePostType(raw) {
  const key = String(raw || POST_TYPE_TOPIC).trim().toLowerCase();
  const type = POST_TYPE_ALIASES.get(key);
  if (!type) {
    throw new Error(
      `Unknown post type "${raw}". Use: topic, app-ad (aliases: ad, app, реклама)`,
    );
  }
  return type;
}

function postTypeFromEnv() {
  const raw = process.env.POST_TYPE;
  if (!raw || !String(raw).trim()) return POST_TYPE_TOPIC;
  return normalizePostType(raw);
}

function appRefFromEnv() {
  const raw = process.env.APP_ID || process.env.APP_NAME;
  return raw ? String(raw).trim() : '';
}

/**
 * @param {string[]} argv
 */
function parseCreatePostArgv(argv) {
  let slideCount = slideCountFromEnv();
  let postType = postTypeFromEnv();
  let typeExplicit = false;
  let appRef = appRefFromEnv();
  let listApps = false;
  const topicParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--list-apps' || arg === '--apps') {
      listApps = true;
      continue;
    }

    if (arg === '--slides' || arg === '-n') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Expected a number after ${arg}`);
      slideCount = clampSlideCount(next, arg);
      continue;
    }
    const slidesEq = arg.match(/^--slides=(\d+)$/);
    if (slidesEq) {
      slideCount = clampSlideCount(slidesEq[1], '--slides');
      continue;
    }

    if (arg === '--type' || arg === '-t') {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Expected a value after ${arg}`);
      postType = normalizePostType(next);
      typeExplicit = true;
      continue;
    }
    const typeEq = arg.match(/^--type=(.+)$/);
    if (typeEq) {
      postType = normalizePostType(typeEq[1]);
      typeExplicit = true;
      continue;
    }

    if (arg === '--app') {
      const next = argv[++i];
      if (next === undefined) throw new Error('Expected app ref after --app');
      appRef = String(next).trim();
      continue;
    }
    const appEq = arg.match(/^--app=(.+)$/);
    if (appEq) {
      appRef = appEq[1].trim();
      continue;
    }

    topicParts.push(arg);
  }

  return {
    slideCount,
    postType,
    typeExplicit,
    appRef,
    listApps,
    topic: topicParts.join(' ').trim(),
  };
}

function createPostUsage() {
  return [
    'Usage: npm run create-post -- [options] [app ref or topic]',
    '',
    'Apps catalog (apps.json):',
    '  npm run list-apps',
    '  npm run create-post -- 1',
    '  npm run create-post -- speaker-fix',
    '  npm run create-post -- "Speaker Fix"',
    '  npm run create-post -- 1 "optional extra angle for this post"',
    '',
    'Post types:',
    '  --type topic     general viral carousel (default without app ref)',
    '  --type app-ad    force app ad (with --app or apps.json ref)',
    '',
    'Flags:',
    `  --slides N   force slide count (${MIN_SLIDES}–${MAX_SLIDES}; otherwise AI chooses)`,
    '  --list-apps  print apps from apps.json',
    '  APP_ID or APP_NAME in .env',
    '',
    'Examples:',
    '  npm run create-post -- "5 signs your mic is broken"',
    '  npm run create-post -- 1',
    '  npm run create-post -- --app speaker-fix "water damage angle"',
  ].join('\n');
}

function defaultSlideCountForType(_postType, slideCountOverride) {
  if (slideCountOverride != null) return slideCountOverride;
  return null;
}

module.exports = {
  POST_TYPE_TOPIC,
  POST_TYPE_APP_AD,
  APP_AD_SLIDE_COUNT,
  normalizePostType,
  parseCreatePostArgv,
  createPostUsage,
  defaultSlideCountForType,
};

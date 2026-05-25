'use strict';

const {
  POST_TYPE_APP_AD,
  POST_TYPE_TOPIC,
  POST_TYPE_INFOGRAPHIC,
} = require('./post-types.js');
const {
  loadAppsCatalog,
  resolveAppByRef,
  looksLikeAppRef,
  listAppsCatalog,
} = require('./apps-catalog.js');

/**
 * @param {ReturnType<import('./post-types.js').parseCreatePostArgv>} parsed
 */
async function resolveCreatePostInput(parsed) {
  if (parsed.listApps) {
    return { listApps: true };
  }

  let { postType, typeExplicit, appRef, topic, slideCount } = parsed;

  let apps = [];
  try {
    apps = await loadAppsCatalog();
  } catch {
    apps = [];
  }

  if (!appRef && topic && apps.length) {
    const trimmed = topic.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const head = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const tail = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : '';

    if (looksLikeAppRef(head, apps)) {
      appRef = head;
      topic = tail;
    } else if (looksLikeAppRef(trimmed, apps)) {
      appRef = trimmed;
      topic = '';
    }
  }

  if (appRef && apps.length) {
    try {
      const resolved = await resolveAppByRef(appRef, { extraTopic: topic });
      return {
        postType: typeExplicit ? postType : resolved.postType,
        appName: resolved.appName,
        appId: resolved.appId,
        topic: resolved.topic,
        slideCount,
        appProfile: resolved.app,
        appAssets: resolved.assets,
        fromCatalog: true,
      };
    } catch (err) {
      if (/^\d+$/.test(appRef) || apps.some((a) => a.id === appRef)) {
        throw err;
      }
    }
  }

  if (appRef && postType !== POST_TYPE_APP_AD && !typeExplicit) {
    postType = POST_TYPE_APP_AD;
  }

  if (postType === POST_TYPE_APP_AD) {
    const appName = appRef || '';
    if (!appName && !topic) {
      throw new Error(
        'App ad needs an app: use `npm run create-post -- 1` or --app from apps.json (npm run list-apps)',
      );
    }
    return {
      postType,
      appName: appName || 'App',
      appId: undefined,
      topic: topic || '',
      slideCount,
      fromCatalog: false,
    };
  }

  if (postType === POST_TYPE_INFOGRAPHIC) {
    if (!topic) {
      throw new Error(
        'Topic required for --type infographic (e.g. npm run create-post -- --type infographic "sperm health tips")',
      );
    }
    return {
      postType: POST_TYPE_INFOGRAPHIC,
      topic,
      slideCount,
      appName: '',
      fromCatalog: false,
    };
  }

  if (!topic) {
    throw new Error('Topic required for --type topic (or pick an app: npm run create-post -- 1)');
  }

  return {
    postType: POST_TYPE_TOPIC,
    topic,
    slideCount,
    appName: '',
    fromCatalog: false,
  };
}

module.exports = {
  resolveCreatePostInput,
  listAppsCatalog,
};

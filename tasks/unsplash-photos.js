'use strict';

require('../load-env');

const fs = require('fs/promises');
const path = require('path');
const { createApi } = require('unsplash-js');

const UNSPLASH_API = 'https://api.unsplash.com';

function stripEnvValue(raw) {
  if (raw === undefined || raw === null) return '';
  let s = String(raw).trim();
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1);
  }
  return s;
}

function getAccessKey() {
  const accessKey = stripEnvValue(process.env.UNSPLASH_ACCESS_KEY);
  if (!accessKey) {
    throw new Error('Set UNSPLASH_ACCESS_KEY in .env — https://unsplash.com/oauth/applications');
  }
  if (accessKey.length < 20) {
    throw new Error('UNSPLASH_ACCESS_KEY looks invalid (too short)');
  }
  return accessKey;
}

async function unsplashFetch(url, options = {}) {
  const target = typeof url === 'string' ? url : String(url);
  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  try {
    return await fetch(target, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const cause = err.cause?.message || err.cause || '';
    throw new Error(
      `Unsplash fetch failed: ${err.message}${cause ? ` — ${cause}` : ''}`,
    );
  }
}

function getUnsplashClient(accessKey) {
  return createApi({
    accessKey,
    fetch: (url, options) => unsplashFetch(url, options),
  });
}

function mapPhoto(photo) {
  return {
    id: photo.id,
    url: photo.urls?.regular || photo.urls?.small,
    user: photo.user?.name || 'unknown',
    downloadLocation: photo.links?.download_location,
  };
}

async function searchPhotosDirect(query, accessKey, perPage) {
  const url = new URL(`${UNSPLASH_API}/search/photos`);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('order_by', 'relevant');

  const res = await unsplashFetch(url.href, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    },
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unsplash API: invalid JSON (${res.status})`);
  }

  if (!res.ok) {
    const msg = json?.errors?.join?.(', ') || json?.error || text || res.statusText;
    throw new Error(`Unsplash API HTTP ${res.status}: ${msg}`);
  }

  return (json.results || []).map(mapPhoto).filter((p) => p.url);
}

/**
 * @returns {Promise<Array<{ id: string, url: string, user: string, downloadLocation?: string }>>}
 */
async function searchPhotos(query, options = {}) {
  const perPage = options.perPage ?? 10;
  const accessKey = getAccessKey();

  console.log(`[unsplash] search: "${query}"`);

  try {
    const unsplash = getUnsplashClient(accessKey);
    const result = await unsplash.search.getPhotos({
      query,
      perPage,
      orderBy: 'relevant',
      page: 1,
    });

    if (result.errors?.length) {
      throw new Error(`Unsplash: ${result.errors.join(', ')}`);
    }
    if (!result.response?.results?.length) {
      return [];
    }

    return result.response.results.map(mapPhoto).filter((p) => p.url);
  } catch (err) {
    const msg = err?.message || String(err);
    if (/fetch failed|network|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg)) {
      console.warn('[unsplash] SDK request failed, retry via REST API…');
      return searchPhotosDirect(query, accessKey, perPage);
    }
    throw err;
  }
}

async function triggerDownload(accessKey, downloadLocation) {
  if (!downloadLocation) return;
  try {
    const unsplash = getUnsplashClient(accessKey);
    await unsplash.photos.trackDownload({ downloadLocation });
  } catch {
    try {
      await unsplashFetch(downloadLocation, {
        headers: { Authorization: `Client-ID ${accessKey}` },
      });
    } catch {
      /* optional */
    }
  }
}

async function downloadPhotoToFile(photo, destPath) {
  const accessKey = getAccessKey();
  await triggerDownload(accessKey, photo.downloadLocation);

  const res = await unsplashFetch(photo.url);
  if (!res.ok) {
    throw new Error(`Download photo: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  console.log(`[unsplash] saved: ${destPath}`);
  return destPath;
}

/** Photo for query; `options.index` picks another result (0-based) for carousels. */
async function fetchBackgroundPhoto(query, destPath, options = {}) {
  const index = Number(options.index) || 0;
  const perPage = Math.min(30, Math.max(15, index + 1));
  const photos = await searchPhotos(query, { perPage });
  if (!photos.length) {
    throw new Error(`Unsplash: no results for "${query}"`);
  }
  const pick = photos[index] ?? photos[photos.length - 1];
  await downloadPhotoToFile(pick, destPath);
  return { ...pick, localPath: destPath };
}

module.exports = {
  searchPhotos,
  downloadPhotoToFile,
  fetchBackgroundPhoto,
  getAccessKey,
};

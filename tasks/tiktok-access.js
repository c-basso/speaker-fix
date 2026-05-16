'use strict';

const fs = require('fs/promises');
const path = require('path');

const { refreshAccessToken } = require('./tiktok-oauth.js');

const ACCESS_FILE = path.join(__dirname, '..', 'access.json');
const ACCESS_EXPIRY_BUFFER_MS = 2 * 60 * 1000;

function normalizeTokenRecord(apiResponse) {
  const now = Date.now();
  const expiresIn = Number(apiResponse.expires_in) || 0;
  const refreshExpiresIn = Number(apiResponse.refresh_expires_in) || 0;
  return {
    ...apiResponse,
    obtained_at: new Date(now).toISOString(),
    access_expires_at:
      expiresIn > 0
        ? new Date(now + expiresIn * 1000).toISOString()
        : null,
    refresh_expires_at:
      refreshExpiresIn > 0
        ? new Date(now + refreshExpiresIn * 1000).toISOString()
        : null,
  };
}

async function accessFileExists() {
  try {
    await fs.access(ACCESS_FILE);
    return true;
  } catch {
    return false;
  }
}

async function loadAccess() {
  const raw = await fs.readFile(ACCESS_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveAccess(record) {
  await fs.writeFile(ACCESS_FILE, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function isAccessExpired(record, bufferMs = ACCESS_EXPIRY_BUFFER_MS) {
  if (!record?.access_token) return true;
  if (!record.access_expires_at) return false;
  const expiresAt = new Date(record.access_expires_at).getTime();
  return expiresAt <= Date.now() + bufferMs;
}

function isRefreshExpired(record) {
  if (!record?.refresh_token) return true;
  if (!record.refresh_expires_at) return false;
  return new Date(record.refresh_expires_at).getTime() <= Date.now();
}

async function probeAccessToken(accessToken) {
  const res = await fetch('https://open.tiktokapis.com/v2/user/info/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: ['open_id'] }),
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
  }
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) {
    const code = json?.error?.code;
    if (code && code !== 'ok') return false;
    throw new Error(
      `Проверка токена: HTTP ${res.status} — ${json?.error?.message || text}`,
    );
  }
  const code = json?.error?.code;
  if (code && code !== 'ok') return false;
  return Boolean(json?.data);
}

function oauthErrorNeedsReauth(err) {
  const msg = String(err?.message || err).toLowerCase();
  return (
    msg.includes('invalid_grant') ||
    msg.includes('invalid_refresh') ||
    msg.includes('refresh token') ||
    msg.includes('refresh_token') ||
    (msg.includes('expired') && msg.includes('refresh'))
  );
}

async function refreshAccessRecord(record, client) {
  const refreshed = await refreshAccessToken({
    clientKey: client.clientKey,
    clientSecret: client.clientSecret,
    refreshToken: record.refresh_token,
  });
  return normalizeTokenRecord(refreshed);
}

/**
 * access.json есть, access не протух (и probe OK) → record;
 * иначе refresh; при неудаче refresh, требующей reauth — throws ReauthRequiredError.
 */
async function ensureValidAccess(client) {
  if (!(await accessFileExists())) {
    const err = new Error('access.json не найден');
    err.code = 'ACCESS_MISSING';
    throw err;
  }

  let record = await loadAccess();

  if (!isAccessExpired(record)) {
    try {
      if (await probeAccessToken(record.access_token)) return record;
    } catch {
      /* пробуем refresh */
    }
  }

  if (isRefreshExpired(record)) {
    const err = new Error('refresh_token истёк, нужна повторная авторизация');
    err.code = 'REAUTH_REQUIRED';
    throw err;
  }

  try {
    record = await refreshAccessRecord(record, client);
    await saveAccess(record);
    return record;
  } catch (err) {
    if (oauthErrorNeedsReauth(err)) {
      const reauth = new Error(err.message);
      reauth.code = 'REAUTH_REQUIRED';
      reauth.cause = err;
      throw reauth;
    }
    throw err;
  }
}

module.exports = {
  ACCESS_FILE,
  normalizeTokenRecord,
  accessFileExists,
  loadAccess,
  saveAccess,
  isAccessExpired,
  isRefreshExpired,
  probeAccessToken,
  oauthErrorNeedsReauth,
  refreshAccessRecord,
  ensureValidAccess,
};

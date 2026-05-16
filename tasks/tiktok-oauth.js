'use strict';

/**
 * TikTok OAuth — user access token: обмен кода, refresh, revoke.
 * @see https://developers.tiktok.com/doc/oauth-user-access-token-management
 *
 * Требуется Node.js 18+ (глобальный fetch).
 */

const ENDPOINTS = {
  OAUTH_TOKEN: 'https://open.tiktokapis.com/v2/oauth/token/',
  OAUTH_REVOKE: 'https://open.tiktokapis.com/v2/oauth/revoke/',
};

const FORM_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Cache-Control': 'no-cache',
};

function toFormBody(fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  return body;
}

async function parseOAuthJson(res) {
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`OAuth: не JSON (${res.status}): ${text.slice(0, 300)}`);
    }
  }
  if (!res.ok || json.error) {
    const code = json.error || `http_${res.status}`;
    const desc = json.error_description || text || res.statusText;
    const logId = json.log_id || 'n/a';
    throw new Error(`TikTok OAuth: ${code} — ${desc} (log_id: ${logId})`);
  }
  return json;
}

/**
 * Обмен authorization code на access/refresh token.
 * @param {object} params
 * @param {string} params.clientKey — client_key
 * @param {string} params.clientSecret — client_secret
 * @param {string} params.code — URL-decoded код из callback
 * @param {string} params.redirectUri — тот же redirect_uri, что при запросе code
 * @param {string} [params.codeVerifier] — обязателен для mobile/desktop PKCE
 */
async function exchangeAuthorizationCode(params) {
  const {
    clientKey,
    client_key,
    clientSecret,
    client_secret,
    code,
    redirectUri,
    redirect_uri,
    codeVerifier,
    code_verifier,
  } = params;

  const fields = {
    client_key: clientKey ?? client_key,
    client_secret: clientSecret ?? client_secret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri ?? redirect_uri,
  };
  const verifier = codeVerifier ?? code_verifier;
  if (verifier) fields.code_verifier = verifier;

  const res = await fetch(ENDPOINTS.OAUTH_TOKEN, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: toFormBody(fields),
  });
  return parseOAuthJson(res);
}

/**
 * Обновление access_token по refresh_token.
 * При смене refresh_token в ответе нужно сохранять новое значение.
 */
async function refreshAccessToken(params) {
  const {
    clientKey,
    client_key,
    clientSecret,
    client_secret,
    refreshToken,
    refresh_token,
  } = params;

  const res = await fetch(ENDPOINTS.OAUTH_TOKEN, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: toFormBody({
      client_key: clientKey ?? client_key,
      client_secret: clientSecret ?? client_secret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken ?? refresh_token,
    }),
  });
  return parseOAuthJson(res);
}

/**
 * Отзыв доступа (disconnect). Успешный ответ — пустое тело.
 */
async function revokeAccessToken(params) {
  const {
    clientKey,
    client_key,
    clientSecret,
    client_secret,
    token,
  } = params;

  const res = await fetch(ENDPOINTS.OAUTH_REVOKE, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: toFormBody({
      client_key: clientKey ?? client_key,
      client_secret: clientSecret ?? client_secret,
      token,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        /* ignore */
      }
    }
    const code = json.error || `http_${res.status}`;
    const desc = json.error_description || text || res.statusText;
    const logId = json.log_id || 'n/a';
    throw new Error(`TikTok OAuth revoke: ${code} — ${desc} (log_id: ${logId})`);
  }
  if (text) {
    try {
      const json = JSON.parse(text);
      if (json.error) {
        const logId = json.log_id || 'n/a';
        throw new Error(
          `TikTok OAuth revoke: ${json.error} — ${json.error_description || ''} (log_id: ${logId})`,
        );
      }
    } catch (e) {
      if (e.message.startsWith('TikTok OAuth revoke:')) throw e;
    }
  }
  return { ok: true };
}

module.exports = {
  ENDPOINTS,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeAccessToken,
};

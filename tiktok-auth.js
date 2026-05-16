'use strict';

require('./load-env');

/**
 * Только TikTok OAuth: переменные из `.env` в корне проекта (см. пример в комментариях ниже).
 *
 * Переменные:
 *   TIKTOK_CLIENT_KEY
 *   TIKTOK_CLIENT_SECRET
 *   TIKTOK_REDIRECT_URI — как в портале, для exchange обязателен
 *
 * Для обмена кода на токены:
 *   TIKTOK_AUTH_REDIRECTED_URL_WITH_CODE — полная ссылка из браузера после редиректа
 *     (или query с code=; база для относительных URL — TIKTOK_REDIRECT_URI при наличии).
 *   TIKTOK_CODE_VERIFIER — опционально, PKCE (mobile/desktop)
 *
 * Для refresh:
 *   TIKTOK_REFRESH_TOKEN
 *
 * Для revoke:
 *   TIKTOK_ACCESS_TOKEN
 *
 * В Login Kit (форма авторизации) укажите scope: user.info.basic,video.upload
 *
 * CLI: node tiktok-auth.js exchange | refresh | revoke
 */

const {
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeAccessToken,
} = require('./tasks/tiktok-oauth.js');

function need(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Задайте переменную окружения: ${name}`);
  }
  return v;
}

function optional(name) {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

const AUTH_REDIRECT_URL_ENV = 'TIKTOK_AUTH_REDIRECTED_URL_WITH_CODE';

function stripEnvQuotes(raw) {
  let s = String(raw).trim();
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1);
  }
  return s;
}

/**
 * Достаёт code из URL редиректа TikTok (query). Поддержка: абсолютный URL,
 * только ?code=…&…, строка code=…&… без ведущего ?, относительный путь при baseUrl.
 */
function parseAuthCodeFromTikTokRedirectUrl(rawInput, baseUrl) {
  let raw = stripEnvQuotes(rawInput);
  let url;
  if (/^https?:\/\//i.test(raw)) {
    url = new URL(raw);
  } else if (raw.includes('code=') && !raw.includes('://')) {
    const q = raw.startsWith('?') ? raw.slice(1) : raw;
    url = new URL(`https://oauth.redirect.invalid/?${q}`);
  } else {
    const base =
      (baseUrl && String(baseUrl).trim()) || 'https://oauth.redirect.invalid/';
    try {
      url = new URL(raw, base);
    } catch {
      throw new Error(
        `${AUTH_REDIRECT_URL_ENV}: не удалось разобрать строку как URL`,
      );
    }
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const desc = url.searchParams.get('error_description') || '';
    throw new Error(`OAuth redirect: ${oauthError} — ${desc}`);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error(
      `${AUTH_REDIRECT_URL_ENV}: в ссылке нет параметра code (ожидается как в callback TikTok)`,
    );
  }
  return code;
}

function authCodeFromRedirectEnv() {
  const value = need(AUTH_REDIRECT_URL_ENV);
  const base = optional('TIKTOK_REDIRECT_URI');
  return parseAuthCodeFromTikTokRedirectUrl(value, base);
}

function clientFromEnv() {
  return {
    clientKey: need('TIKTOK_CLIENT_KEY'),
    clientSecret: need('TIKTOK_CLIENT_SECRET'),
  };
}

function oauthClientFromEnv() {
  return {
    ...clientFromEnv(),
    redirectUri: need('TIKTOK_REDIRECT_URI'),
    codeVerifier: optional('TIKTOK_CODE_VERIFIER'),
  };
}

/** Обмен authorization code на access_token / refresh_token (см. доку TikTok OAuth). */
async function exchangeWithRedirectUrl(redirectUrl) {
  const client = oauthClientFromEnv();
  const code = parseAuthCodeFromTikTokRedirectUrl(
    redirectUrl,
    client.redirectUri,
  );
  return exchangeAuthorizationCode({
    ...client,
    code,
  });
}

/** Обмен authorization code на access_token / refresh_token (см. доку TikTok OAuth). */
async function exchangeFromEnv() {
  return exchangeWithRedirectUrl(need(AUTH_REDIRECT_URL_ENV));
}

/** Новый access_token по refresh_token. */
async function refreshFromEnv() {
  return refreshAccessToken({
    ...clientFromEnv(),
    refreshToken: need('TIKTOK_REFRESH_TOKEN'),
  });
}

/** Отзыв access_token. */
async function revokeFromEnv() {
  return revokeAccessToken({
    ...clientFromEnv(),
    token: need('TIKTOK_ACCESS_TOKEN'),
  });
}

module.exports = {
  clientFromEnv,
  oauthClientFromEnv,
  exchangeFromEnv,
  exchangeWithRedirectUrl,
  refreshFromEnv,
  revokeFromEnv,
  parseAuthCodeFromTikTokRedirectUrl,
};

if (require.main === module) {
  const cmd = process.argv[2];
  const main = async () => {
    let result;
    if (cmd === 'exchange') result = await exchangeFromEnv();
    else if (cmd === 'refresh') result = await refreshFromEnv();
    else if (cmd === 'revoke') result = await revokeFromEnv();
    else {
      console.error('Использование: node tiktok-auth.js <exchange|refresh|revoke');
      process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  };
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

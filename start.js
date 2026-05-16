'use strict';

const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

require('./load-env');

const { oauthClientFromEnv, exchangeWithRedirectUrl } = require('./tiktok-auth.js');
const {
  accessFileExists,
  saveAccess,
  normalizeTokenRecord,
  ensureValidAccess,
  oauthErrorNeedsReauth,
} = require('./tasks/tiktok-access.js');

const execAsync = promisify(exec);
const ROOT = __dirname;
const FORM_PATH = path.join(ROOT, 'tiktok-oauth-form.html');
const WAIT_PORT = Number(process.env.TIKTOK_OAUTH_WAIT_PORT) || 39281;

function needEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Задайте переменную окружения: ${name}`);
  }
  return v;
}

async function openInBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === 'darwin'
      ? `open "${url}"`
      : platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  try {
    await execAsync(cmd);
  } catch {
    console.log(`Откройте в браузере: ${url}`);
  }
}

function injectFormConfig(html) {
  const clientKey = needEnv('TIKTOK_CLIENT_KEY');
  const redirectUri = needEnv('TIKTOK_REDIRECT_URI');
  return html
    .replace(/id="client_key"[^>]*value="[^"]*"/, `id="client_key" name="client_key" required autocomplete="off" value="${clientKey}"`)
    .replace(
      /id="redirect_uri"[^>]*value="[^"]*"/,
      `id="redirect_uri" name="redirect_uri" type="url" required value="${redirectUri}"`,
    );
}

/**
 * Локальная форма: шаг 1 — TikTok, шаг 2 — вставить URL редиректа → POST /oauth/redirect-done
 */
function waitForRedirectUrlViaForm() {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      server.close();
      fn(value);
    };

    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
          const html = injectFormConfig(
            await fs.readFile(FORM_PATH, 'utf8'),
          );
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        if (req.method === 'POST' && req.url === '/oauth/redirect-done') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString('utf8');
          let redirectUrl = '';
          const ct = req.headers['content-type'] || '';
          if (ct.includes('application/json')) {
            redirectUrl = JSON.parse(body).redirectUrl || '';
          } else {
            const params = new URLSearchParams(body);
            redirectUrl = params.get('redirectUrl') || '';
          }
          redirectUrl = redirectUrl.trim();
          if (!redirectUrl.includes('code=')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'В URL нет параметра code' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          finish(resolve, redirectUrl);
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        if (!settled) finish(reject, err);
      }
    });

    server.on('error', (err) => finish(reject, err));

    server.listen(WAIT_PORT, '127.0.0.1', async () => {
      const url = `http://127.0.0.1:${WAIT_PORT}/`;
      console.log('');
      console.log('Нужна авторизация TikTok.');
      console.log('1. В открывшейся форме нажмите «Продолжить с TikTok» и войдите.');
      console.log('2. После редиректа скопируйте весь URL из адресной строки.');
      console.log('3. Вставьте URL в поле на той же странице и нажмите «Сохранить URL».');
      console.log('');
      await openInBrowser(url);
    });
  });
}

async function runInteractiveAuth(client) {
  const redirectUrl = await waitForRedirectUrlViaForm();
  console.log('Обмен code на токены…');
  let tokens;
  try {
    tokens = await exchangeWithRedirectUrl(redirectUrl);
  } catch (err) {
    if (oauthErrorNeedsReauth(err) || String(err.message).includes('code')) {
      console.error('Ошибка обмена:', err.message);
      console.log('Повторите авторизацию (код одноразовый).');
      return runInteractiveAuth(client);
    }
    throw err;
  }
  const record = normalizeTokenRecord(tokens);
  await saveAccess(record);
  console.log('Токены сохранены в access.json');
  return record;
}

async function main() {
  const client = oauthClientFromEnv();

  if (!(await accessFileExists())) {
    console.log('access.json не найден — запуск авторизации.');
    await runInteractiveAuth(client);
    console.log('Всё ок: access.json создан, токен действителен.');
    return;
  }

  try {
    const record = await ensureValidAccess(client);
    const openId = record.open_id || '—';
    console.log(`Всё ок: токен действителен (open_id: ${openId}).`);
  } catch (err) {
    if (err.code === 'ACCESS_MISSING' || err.code === 'REAUTH_REQUIRED') {
      console.log(err.message);
      console.log('Повторная авторизация…');
      await runInteractiveAuth(client);
      console.log('Всё ок: токен обновлён после повторной авторизации.');
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

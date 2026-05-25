'use strict';

require('../load-env');

/** @type {import('@openrouter/sdk').OpenRouter | null} */
let clientPromise = null;

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

function getApiKey() {
  const apiKey = stripEnvValue(process.env.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error(
      'Задайте OPENROUTER_API_KEY в .env — https://openrouter.ai/keys',
    );
  }
  return apiKey;
}

function errorDetailPayload(err) {
  if (!err || typeof err !== 'object') return '';
  const chunks = [];
  for (const key of ['body', 'data', 'response', 'cause']) {
    const val = err[key];
    if (!val) continue;
    if (typeof val === 'string') chunks.push(val);
    else {
      try {
        chunks.push(JSON.stringify(val));
      } catch {
        chunks.push(String(val));
      }
    }
  }
  return chunks.join(' | ').slice(0, 800);
}

function formatSdkError(err, context = {}) {
  const name = err?.name || '';
  const msg = err?.message || String(err);
  const model = context.model || err?.model || '';
  const variant = context.variant ? ` variant=${context.variant}` : '';
  const extra = errorDetailPayload(err);
  const providerHint = /provider returned error/i.test(msg)
    ? ' Провайдер модели временно недоступен — повторите или задайте OPENROUTER_MODEL (например google/gemini-2.0-flash-001).'
    : '';

  if (name === 'UnauthorizedResponseError' || /401|user not found/i.test(msg)) {
    return new Error(
      `OpenRouter 401: ${msg}. Проверьте OPENROUTER_API_KEY в .env (без кавычек).`,
    );
  }
  if (name === 'PaymentRequiredResponseError') {
    return new Error(`OpenRouter 402: ${msg}. Пополните баланс на openrouter.ai`);
  }

  const head = [`OpenRouter${variant}: ${msg}${model ? ` (model=${model})` : ''}${providerHint}`];
  if (extra) head.push(extra);
  return new Error(head.join('\n'));
}

async function getOpenRouterClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { OpenRouter } = await import('@openrouter/sdk');
      return new OpenRouter({ apiKey: getApiKey() });
    })();
  }
  return clientPromise;
}

module.exports = {
  getApiKey,
  getOpenRouterClient,
  formatSdkError,
  errorDetailPayload,
  stripEnvValue,
};

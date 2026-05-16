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

function formatSdkError(err) {
  const name = err?.name || '';
  const msg = err?.message || String(err);
  if (name === 'UnauthorizedResponseError' || /401|user not found/i.test(msg)) {
    return new Error(
      `OpenRouter 401: ${msg}. Проверьте OPENROUTER_API_KEY в .env (без кавычек).`,
    );
  }
  if (name === 'PaymentRequiredResponseError') {
    return new Error(`OpenRouter 402: ${msg}. Пополните баланс на openrouter.ai`);
  }
  return err instanceof Error ? err : new Error(msg);
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
  stripEnvValue,
};

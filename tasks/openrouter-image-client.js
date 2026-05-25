'use strict';

require('../load-env');

const { stripEnvValue } = require('./openrouter-client.js');

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

function getImageGenApiKey() {
  const apiKey = stripEnvValue(process.env.OPENROUTER_IMAGE_GEN_KEY);
  if (!apiKey) {
    throw new Error(
      'Задайте OPENROUTER_IMAGE_GEN_KEY в .env — отдельный ключ для генерации изображений (openrouter.ai/keys)',
    );
  }
  return apiKey;
}

module.exports = {
  OPENROUTER_API_URL,
  getImageGenApiKey,
};

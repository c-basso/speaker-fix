'use strict';

/**
 * TikTok Content Posting API — upload draft to inbox (video / photo).
 * @see https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content/
 *
 * Требуется Node.js 18+ (глобальный fetch).
 */

const fs = require('fs/promises');

const ENDPOINTS = {
  VIDEO_INBOX_INIT: 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
  POST_STATUS_FETCH: 'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
  CONTENT_INIT: 'https://open.tiktokapis.com/v2/post/publish/content/init/',
};

function jsonHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function parseTikTokJson(res) {
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Некорректный JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${json?.error?.message || text}`);
  }
  const code = json?.error?.code;
  if (code && code !== 'ok') {
    const logId = json.error.log_id || 'n/a';
    throw new Error(
      `TikTok API: ${code} — ${json.error.message || ''} (log_id: ${logId})`,
    );
  }
  return json;
}

/**
 * Шаг 1 (видео): POST /v2/post/publish/inbox/video/init/
 * Тело — как в документации (source_info с FILE_UPLOAD или PULL_FROM_URL).
 */
async function initInboxVideoUpload(accessToken, body) {
  const res = await fetch(ENDPOINTS.VIDEO_INBOX_INIT, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(body),
  });
  return parseTikTokJson(res);
}

/**
 * Инициализация загрузки файла с диска (source = FILE_UPLOAD).
 * Дальше вызовите {@link putVideoToUploadUrl} с телом из upload_url.
 */
async function initInboxVideoFileUpload(accessToken, params) {
  const {
    videoSize,
    chunkSize = videoSize,
    totalChunkCount = 1,
  } = params;
  return initInboxVideoUpload(accessToken, {
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunkCount,
    },
  });
}

/**
 * Загрузка бинарных данных на upload_url (PUT).
 * Для одного чанка: byteStart=0, byteEnd=size-1, totalSize=size.
 */
async function putVideoToUploadUrl(uploadUrl, buffer, options = {}) {
  const size = buffer.length;
  if (size === 0) throw new Error('Пустой буфер видео');
  const contentType = options.contentType || 'video/mp4';
  const start = options.byteStart ?? 0;
  const end = options.byteEnd ?? size - 1;
  const total = options.totalSize ?? size;
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${total}`,
    },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PUT загрузка видео не удалась (${res.status}): ${t}`);
  }
  return res;
}

/**
 * Полный сценарий FILE_UPLOAD: init → PUT файла целиком (один чанк).
 * @returns {{ publishId: string, initResponse: object }}
 */
async function uploadInboxVideoFromLocalFile(accessToken, filePath, options = {}) {
  const buf = await fs.readFile(filePath);
  const videoSize = buf.length;
  const initResponse = await initInboxVideoFileUpload(accessToken, {
    videoSize,
    chunkSize: options.chunkSize ?? videoSize,
    totalChunkCount: options.totalChunkCount ?? 1,
  });
  const uploadUrl = initResponse?.data?.upload_url;
  const publishId = initResponse?.data?.publish_id;
  if (!uploadUrl || !publishId) {
    throw new Error('Ответ init без upload_url или publish_id');
  }
  await putVideoToUploadUrl(uploadUrl, buf, { contentType: options.contentType });
  return { publishId, initResponse };
}

/**
 * Видео по URL с проверенного домена (source = PULL_FROM_URL).
 */
async function initInboxVideoPullFromUrl(accessToken, videoUrl) {
  return initInboxVideoUpload(accessToken, {
    source_info: {
      source: 'PULL_FROM_URL',
      video_url: videoUrl,
    },
  });
}

/**
 * Черновик видео в inbox по публичному URL (PULL_FROM_URL).
 * @returns {{ publishId: string, initResponse: object }}
 */
async function uploadInboxVideoFromPullUrl(accessToken, videoUrl) {
  const initResponse = await initInboxVideoPullFromUrl(accessToken, videoUrl);
  const publishId = initResponse?.data?.publish_id;
  if (!publishId) {
    throw new Error('Ответ init без publish_id');
  }
  return { publishId, initResponse };
}

/**
 * Статус публикации / обработки: POST /v2/post/publish/status/fetch/
 */
async function fetchPostStatus(accessToken, publishId) {
  const res = await fetch(ENDPOINTS.POST_STATUS_FETCH, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ publish_id: publishId }),
  });
  return parseTikTokJson(res);
}

/**
 * Фото: POST /v2/post/publish/content/init/
 * @param {object} payload — post_info, source_info, post_mode, media_type (как в доке)
 */
async function initContentUpload(accessToken, payload) {
  const body = {
    post_info: payload.post_info ?? payload.postInfo,
    source_info: payload.source_info ?? payload.sourceInfo,
    post_mode: payload.post_mode ?? payload.postMode ?? 'MEDIA_UPLOAD',
    media_type: payload.media_type ?? payload.mediaType ?? 'PHOTO',
  };
  const res = await fetch(ENDPOINTS.CONTENT_INIT, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(body),
  });
  return parseTikTokJson(res);
}

/**
 * Фото с URL (PULL_FROM_URL), заголовок/описание опционально.
 */
async function uploadPhotosFromUrls(accessToken, photoUrls, options = {}) {
  const cover =
    options.photo_cover_index ?? options.photoCoverIndex ?? 1;
  return initContentUpload(accessToken, {
    post_info: {
      ...(options.title != null && { title: options.title }),
      ...(options.description != null && { description: options.description }),
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: cover,
      photo_images: photoUrls,
    },
    post_mode: 'MEDIA_UPLOAD',
    media_type: 'PHOTO',
  });
}

module.exports = {
  ENDPOINTS,
  initInboxVideoUpload,
  initInboxVideoFileUpload,
  putVideoToUploadUrl,
  uploadInboxVideoFromLocalFile,
  initInboxVideoPullFromUrl,
  uploadInboxVideoFromPullUrl,
  fetchPostStatus,
  initContentUpload,
  uploadPhotosFromUrls,
};

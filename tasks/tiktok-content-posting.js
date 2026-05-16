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
    'Content-Type': 'application/json; charset=UTF-8',
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
    const errCode = json?.error?.code;
    const errMsg = json?.error?.message || text;
    throw new Error(
      `HTTP ${res.status}${errCode ? ` [${errCode}]` : ''}: ${errMsg}`,
    );
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

const PROCESSING_STATUSES = new Set([
  'PROCESSING_DOWNLOAD',
  'PROCESSING_UPLOAD',
]);

/** Успех для MEDIA_UPLOAD: черновик ушёл в Inbox. */
const INBOX_READY_STATUSES = new Set([
  'SEND_TO_USER_INBOX',
  'PUBLISH_COMPLETE',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatStatusProgress(data) {
  const parts = [];
  if (data.downloaded_bytes != null) {
    parts.push(`downloaded_bytes=${data.downloaded_bytes}`);
  }
  if (data.uploaded_bytes != null) {
    parts.push(`uploaded_bytes=${data.uploaded_bytes}`);
  }
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * Опрашивает /status/fetch/ до SEND_TO_USER_INBOX, PUBLISH_COMPLETE или FAILED.
 * Отдельного API «отправить в inbox» нет — TikTok делает это после скачивания медиа.
 * @see https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
 */
async function waitForPublishStatus(accessToken, publishId, options = {}) {
  const intervalMs =
    options.intervalMs ??
    (Number(process.env.TIKTOK_STATUS_POLL_MS) || 5000);
  const timeoutMs =
    options.timeoutMs ??
    (Number(process.env.TIKTOK_STATUS_TIMEOUT_MS) || 15 * 60 * 1000);
  const targetStatuses =
    options.targetStatuses ?? [...INBOX_READY_STATUSES];

  const started = Date.now();
  let lastStatus = null;
  let lastResponse = null;

  while (Date.now() - started < timeoutMs) {
    lastResponse = await fetchPostStatus(accessToken, publishId);
    const data = lastResponse?.data ?? {};
    const status = data.status;

    if (status && status !== lastStatus) {
      lastStatus = status;
      console.log(`  → ${status}${formatStatusProgress(data)}`);
    }

    if (status === 'FAILED') {
      const reason = data.fail_reason || 'не указана';
      const err = new Error(`TikTok FAILED: ${reason}`);
      err.failReason = data.fail_reason;
      err.statusResponse = lastResponse;
      throw err;
    }

    if (targetStatuses.includes(status)) {
      return lastResponse;
    }

    if (status && !PROCESSING_STATUSES.has(status)) {
      console.log(`  … статус ${status}, ждём ${[...targetStatuses].join(' или ')}`);
    }

    await sleep(intervalMs);
  }

  const err = new Error(
    `Таймаут ${Math.round(timeoutMs / 1000)} с: последний статус «${lastStatus || 'нет'}»`,
  );
  err.lastStatus = lastStatus;
  err.statusResponse = lastResponse;
  throw err;
}

/**
 * Фото: POST /v2/post/publish/content/init/
 * @param {object} payload — post_info, source_info, post_mode, media_type (как в доке)
 */
async function initContentUpload(accessToken, payload) {
  const postInfo = payload.post_info ?? payload.postInfo ?? {};
  const sourceInfo = payload.source_info ?? payload.sourceInfo;
  if (!sourceInfo?.source || !Array.isArray(sourceInfo.photo_images)) {
    throw new Error('source_info: нужны source и photo_images');
  }
  const body = {
    post_info: postInfo,
    source_info: sourceInfo,
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
  if (!photoUrls?.length) {
    throw new Error('photo_images: нужен хотя бы один URL');
  }
  // API: индекс обложки с 0 — для одного фото только 0 (см. Photo Post API)
  let coverIndex =
    options.photo_cover_index ?? options.photoCoverIndex ?? 0;
  coverIndex = Number(coverIndex);
  if (
    !Number.isInteger(coverIndex) ||
    coverIndex < 0 ||
    coverIndex >= photoUrls.length
  ) {
    throw new Error(
      `photo_cover_index должен быть от 0 до ${photoUrls.length - 1}`,
    );
  }

  const post_info = {};
  if (options.title != null && String(options.title).trim()) {
    post_info.title = String(options.title).trim();
  }
  if (options.description != null && String(options.description).trim()) {
    post_info.description = String(options.description).trim();
  }
  if (!post_info.title) {
    post_info.title = 'Post';
  }

  return initContentUpload(accessToken, {
    post_info,
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: coverIndex,
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
  waitForPublishStatus,
  PROCESSING_STATUSES,
  INBOX_READY_STATUSES,
  initContentUpload,
  uploadPhotosFromUrls,
};

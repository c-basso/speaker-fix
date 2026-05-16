'use strict';

const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');

require('./load-env');

const { oauthClientFromEnv } = require('./tiktok-auth.js');
const { ensureValidAccess } = require('./tasks/tiktok-access.js');
const {
  listPostSlugs,
  scanPostFolder,
  verifyPublicUrls,
  classifyPost,
  publicBaseUrl,
} = require('./tasks/posts.js');
const {
  uploadPhotosFromUrls,
  uploadInboxVideoFromPullUrl,
  uploadInboxVideoFromLocalFile,
  fetchPostStatus,
} = require('./tasks/tiktok-content-posting.js');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');

function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    ask(question) {
      return new Promise((resolve) => rl.question(question, resolve));
    },
    close() {
      rl.close();
    },
  };
}

async function choosePost(slugs, prompter) {
  console.log('\nПосты в posts/:');
  slugs.forEach((slug, i) => {
    console.log(`  ${i + 1}. ${slug}`);
  });
  console.log('  0. Выход\n');

  while (true) {
    const answer = (await prompter.ask('Номер поста: ')).trim();
    if (answer === '0' || answer.toLowerCase() === 'q') return null;
    const n = Number.parseInt(answer, 10);
    if (n >= 1 && n <= slugs.length) return slugs[n - 1];
    console.log('Введите число из списка или 0 для выхода.');
  }
}

function printVerifyResults(results) {
  console.log('\nПроверка URL на сайте:');
  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} [${r.status}] ${r.file.publicUrl}`);
    if (!r.ok) allOk = false;
  }
  return allOk;
}

async function publishPhoto(accessToken, scan, classification) {
  const checks = await verifyPublicUrls(classification.images);
  if (!printVerifyResults(checks)) {
    throw new Error(
      `Не все файлы доступны по ${publicBaseUrl()}/posts/… — залейте posts/ на GitHub Pages`,
    );
  }

  const photoUrls = classification.images.map((f) => f.publicUrl);
  const title = scan.meta.title ?? scan.slug;
  const description = scan.meta.description;

  console.log('\nОтправка фото в TikTok (MEDIA_UPLOAD)…');
  const response = await uploadPhotosFromUrls(accessToken, photoUrls, {
    title,
    description,
    photoCoverIndex: 0,
  });
  return response;
}

async function publishVideo(accessToken, scan, classification) {
  const video = classification.video;
  const checks = await verifyPublicUrls([video]);

  if (printVerifyResults(checks) && checks[0].ok) {
    console.log('\nОтправка видео в TikTok (PULL_FROM_URL)…');
    return uploadInboxVideoFromPullUrl(accessToken, video.publicUrl);
  }

  console.log(
    '\nВидео недоступно по публичному URL — загрузка с диска (FILE_UPLOAD)…',
  );
  return uploadInboxVideoFromLocalFile(accessToken, video.localPath);
}

async function printPublishResult(result, accessToken) {
  const publishId =
    result?.data?.publish_id ?? result?.publishId ?? null;
  console.log('\n--- Результат ---');
  console.log(JSON.stringify(result, null, 2));
  if (publishId) {
    console.log(`\npublish_id: ${publishId}`);
    try {
      const status = await fetchPostStatus(accessToken, publishId);
      console.log('\nСтатус:');
      console.log(JSON.stringify(status, null, 2));
    } catch (err) {
      console.warn('Не удалось запросить статус:', err.message);
    }
  }
  console.log(
    '\nПользователь должен завершить публикацию в приложении TikTok (уведомление в inbox).',
  );
}

async function main() {
  const prompter = createPrompter();
  try {
    console.log('Проверка access.json…');
    const client = oauthClientFromEnv();
    const access = await ensureValidAccess(client);
    const accessToken = access.access_token;
    console.log(`Токен OK (open_id: ${access.open_id || '—'}).`);

    await fs.mkdir(POSTS_DIR, { recursive: true });
    const slugs = await listPostSlugs(POSTS_DIR);
    if (slugs.length === 0) {
      console.log(
        `\nПапка posts/ пуста. Создайте posts/имя-поста/ с картинками или видео.\nПубличный URL: ${publicBaseUrl()}/posts/имя-поста/файл.jpg`,
      );
      return;
    }

    const slug = await choosePost(slugs, prompter);
    if (!slug) {
      console.log('Отмена.');
      return;
    }

    const scan = await scanPostFolder(path.join(POSTS_DIR, slug), slug);
    const classification = classifyPost(scan);

    if (classification.error) {
      throw new Error(classification.error);
    }

    console.log(`\nПост: ${slug} (${classification.type})`);
    if (classification.type === 'photo') {
      console.log(`Файлов: ${classification.images.length}`);
    }

    let result;
    if (classification.type === 'photo') {
      result = await publishPhoto(accessToken, scan, classification);
    } else if (classification.type === 'video') {
      result = await publishVideo(accessToken, scan, classification);
    }

    await printPublishResult(result, accessToken);
    console.log('\nГотово.');
  } finally {
    prompter.close();
  }
}

main().catch((err) => {
  if (err.code === 'ACCESS_MISSING' || err.code === 'REAUTH_REQUIRED') {
    console.error(err.message);
    console.error('Сначала выполните: npm start');
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

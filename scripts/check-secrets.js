'use strict';

/**
 * Проверка: в исходниках нет захардкоженных секретов TikTok и токенов.
 * Не сканирует .env, access.json, node_modules.
 */

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git']);
const SKIP_FILES = new Set([
  path.normalize('scripts/check-secrets.js'),
]);

const SCAN_EXT = new Set(['.js', '.html', '.json', '.md', '.txt', '.mjs', '.cjs']);

const PATTERNS = [
  {
    name: 'TikTok access_token',
    re: /\bact\.[A-Za-z0-9!._-]{20,}/,
  },
  {
    name: 'TikTok refresh_token',
    re: /\brft\.[A-Za-z0-9!._-]{20,}/,
  },
  {
    name: 'client_secret assignment',
    re: /client_secret\s*[:=]\s*['"][^'"]{8,}['"]/i,
  },
  {
    name: 'TIKTOK_CLIENT_SECRET assignment',
    re: /TIKTOK_CLIENT_SECRET\s*=\s*['"][^'"]+['"]/i,
  },
  {
    name: 'TIKTOK_CLIENT_KEY assignment (not env name only)',
    re: /TIKTOK_CLIENT_KEY\s*=\s*['"][a-z0-9]{10,}['"]/i,
  },
  {
    name: 'UNSPLASH_ACCESS_KEY hardcoded',
    re: /accessKey:\s*['"][A-Za-z0-9_-]{20,}['"]/,
  },
  {
    name: 'Bearer token literal',
    re: /Bearer\s+[A-Za-z0-9._-]{30,}/,
  },
];

const ALLOWLIST_LINE = [
  /process\.env/,
  /need\(['"]TIKTOK_/,
  /optional\(['"]TIKTOK_/,
  /needEnv\(['"]TIKTOK_/,
  /example12345Example/i,
  /act\.example/i,
  /rft\.example/i,
  /CLIENT_KEY['"]/,
  /CLIENT_SECRET['"]/,
  /client_key\s*\?\?/,
  /client_secret\s*\?\?/,
  /@param.*clientSecret/,
  /@param.*clientKey/,
  /placeholder=/i,
  /value=""/,
  /value="code"/,
  /user\.info\.basic/,
];

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.normalize(path.relative(ROOT, full));
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      await walk(full, files);
      continue;
    }
    if (SKIP_FILES.has(rel)) continue;
    if (rel === '.env' || rel === 'access.json') continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!SCAN_EXT.has(ext)) continue;
    files.push(full);
  }
  return files;
}

function isAllowlisted(line) {
  return ALLOWLIST_LINE.some((re) => re.test(line));
}

async function scanFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath);
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isAllowlisted(line)) continue;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        hits.push({ rel, line: i + 1, name, snippet: line.trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

async function main() {
  const files = await walk(ROOT);
  const allHits = [];
  for (const f of files) {
    allHits.push(...(await scanFile(f)));
  }

  if (allHits.length === 0) {
    console.log(`OK: секреты не найдены (${files.length} файлов).`);
    console.log('Исключены: .env, access.json, node_modules');
    return;
  }

  console.error('Найдены возможные секреты в коде:\n');
  for (const h of allHits) {
    console.error(`  ${h.rel}:${h.line} [${h.name}]`);
    console.error(`    ${h.snippet}\n`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

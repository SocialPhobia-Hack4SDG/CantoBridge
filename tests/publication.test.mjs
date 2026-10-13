import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function ignored(path) {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: root });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

test('私人记忆、账号快照、证书、环境密钥和本地产物不会被纳入仓库', () => {
  for (const path of [
    '.workbuddy-ai/memory/MEMORY.md', 'backend/.data/db.json',
    'frontend/tools/.certs/server.key', 'backend/node_modules/ws/index.js',
    '.env', 'backend/.env.production', 'frontend/.env.local',
    'backend/credentials.pem', 'backend/credentials.key',
    'frontend/debug.log', 'outputs/preview.png', '.DS_Store', 'node_modules/test/index.js',
  ]) assert.equal(ignored(path), true, path);
});

test('环境示例、运行入口、锁文件和第三方许可证仍可提交', () => {
  for (const path of [
    '.env.example', 'backend/package-lock.json',
    'backend/src/server.js', 'frontend/index.html',
    'frontend/tools/ToJyutping-LICENSE.txt',
  ]) assert.equal(ignored(path), false, path);
});

test('清理后运行所需文件和被现有测试引用的素材完整保留', () => {
  for (const path of [
    'backend/package.json', 'backend/package-lock.json', 'backend/src/server.js',
    'frontend/package.json', 'frontend/index.html', 'frontend/tools/serve.mjs',
    'frontend/assets/branding/logo.png',
    'frontend/assets/branding/candidates/01-dialogue-bridge.png',
    'frontend/assets/branding/candidates/02-conversation.png',
    'frontend/assets/branding/candidates/03-cb-monogram.png',
    'frontend/assets/branding/candidates/04-harbour-voice.png',
    'frontend/assets/avatars/neutral.svg', 'frontend/tools/ToJyutping-LICENSE.txt',
  ]) assert.equal(existsSync(new URL('../' + path, import.meta.url)), true, path);
  for (const path of ['.DS_Store', 'outputs', '.workbuddy-ai']) {
    assert.equal(existsSync(new URL('../' + path, import.meta.url)), false, path);
  }
});

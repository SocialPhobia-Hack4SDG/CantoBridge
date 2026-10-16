import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TOPIC_DATABASE } from '../backend/src/data/topicDatabase.js';
import { THEMES } from '../frontend/src/data/themes.js';
import { createSampleGenAiProvider } from '../backend/src/services/genai.js';
import { createServer } from '../backend/src/server.js';

const root = new URL('../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');

test('根README所有本地文档、部署配置及验证脚本链接都指向现有文件', () => {
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
  const local = links.filter(link => !/^(?:https?:|#)/.test(link));
  assert.ok(local.length > 0);
  for (const link of local) {
    const file = new URL(link.split('#')[0], root);
    assert.ok(file.href.startsWith(root.href), '本地链接不应越过项目根目录');
    assert.ok(existsSync(file), `失效的README链接：${link}`);
  }
});

test('根README的卡片、主题数量及GenAI示例来源与实际实现一致', () => {
  const inventory = readme.match(/(\d+) curated conversation cards across (\d+) topics and (\w+) difficulty levels/);
  assert.ok(inventory, '应说明可用的学习材料');
  assert.equal(Number(inventory[1]), TOPIC_DATABASE.length);
  assert.equal(Number(inventory[2]), new Set(TOPIC_DATABASE.map(card => card.topic)).size);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  assert.equal(words[inventory[3]], new Set(TOPIC_DATABASE.map(card => card.difficulty)).size);
  const themes = readme.match(/(\w+) colour themes/);
  assert.ok(themes); assert.equal(words[themes[1]], THEMES.length);
  const provider = createSampleGenAiProvider();
  assert.ok(readme.includes(`mode: "${provider.mode}"`));
  assert.ok(readme.includes(`provider: "${provider.name}"`));
  assert.ok(readme.includes(`model: ${provider.model}`));
  const routes = createServer({ devRoutes: false }).router.list();
  for (const [, method, path] of readme.matchAll(/`(POST|GET|PUT|DELETE) (\/api\/[^`]+)`/g)) {
    assert.ok(routes.some(route => route.method === method && route.path === path), `未实现的README接口：${method} ${path}`);
  }
});

test('根README运行和验证命令对应真实npm脚本及安装锁文件', () => {
  const scripts = { root: ['start', 'test', 'check'], frontend: ['serve'], backend: ['start'] };
  for (const [dir, names] of Object.entries(scripts)) {
    const prefix = dir === 'root' ? '' : dir + '/';
    const pkg = JSON.parse(readFileSync(new URL(prefix + 'package.json', root), 'utf8'));
    for (const name of names) assert.equal(typeof pkg.scripts[name], 'string', `${dir}缺少脚本：${name}`);
  }
  for (const path of ['package-lock.json', 'backend/package-lock.json']) assert.ok(existsSync(new URL(path, root)));
  for (const command of ['npm ci', 'npm ci --prefix backend', 'npm --prefix backend start', 'npm --prefix frontend run serve', 'npm test', 'npm run check']) {
    assert.ok(readme.includes(command), `README缺少可复现命令：${command}`);
  }
});

/**
 * 契约校验：把**后端已实现的路由**钉在 frontend/docs/10-api-v1.md 上。
 *
 * 复刻前端 check-*.mjs 的做法——文档与代码不一致就红，而不是靠人记得同步。
 * 查七件事：
 *   1. 已实现的每个路由（`contract: false` 的本地口子除外）都必须在 docs/10 的端点表里
 *   2. 已实现端点的方法 + 路径要与契约**完全一致**（含 :param 名字）
 *   3. `GET /api/tags` 的响应键 == 契约里那一行写的响应字段
 *   4. 词表逐值等于 frontend/src/data/tags.js（少一个 / 多一个都算错）
 *   5. 代码里用的每个错误码都在契约第 3.1 节声明过
 *   6. `interests` 上限与契约一致（5）
 *   7. 覆盖率：报告契约里的端点总数与已实现多少（这一阶段只做 Phase 0+1，缺的不算错）
 *
 * 端点表的解析直接复用前端那份 `endpointRows`，保证两边对文档的理解完全一样。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { endpointRows, endpointKey, extractTokens } from '../../frontend/tools/check-api.mjs';
import { createServer } from '../src/server.js';
import { createDb } from '../src/store/db.js';
import { ALL_VOCABULARIES, EXTRA_VALUE_SETS, MAX_INTERESTS } from '../src/data/vocabularies.js';
import { STATUS_BY_CODE } from '../src/http/envelope.js';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(HERE, '..');
export const API_V1_DOC = join(REPO_ROOT, 'frontend', 'docs', '10-api-v1.md');
export const FRONTEND_TAGS_MODULE = join(REPO_ROOT, 'frontend', 'src', 'data', 'tags.js');

/**
 * 两边的词表导出名一致（都是 UPPER_SNAKE），逐个比对取值。
 * 这十张就是契约第 3.6 节的表；`LANGUAGES_SPOKEN` / `direction` / `status`
 * 不在 tags.js 里导出，单独按文档比对（见 EXTRA_VALUE_SETS 的用例）。
 */
const VOCABULARY_NAMES = [
  'ROLES',
  'LEVELS',
  'NATIVE_LANGUAGES',
  'IDENTITIES',
  'INTERESTS',
  'LEARNING_GOALS',
  'BUDDY_TOPICS',
  'MATCH_INTENTS',
  'LEARNER_FEEDBACK_TAGS',
  'BUDDY_FEEDBACK_TAGS',
];

export function implementedRoutes({ devRoutes = true } = {}) {
  const app = createServer({ db: createDb(), devRoutes });
  return app.router.list().filter((route) => route.options?.contract !== false);
}

export function documentedEndpoints(docPath = API_V1_DOC) {
  if (!existsSync(docPath)) return [];
  return endpointRows(readFileSync(docPath, 'utf8'));
}

export async function checkContract({
  docPath = API_V1_DOC,
  routes = implementedRoutes(),
  vocabularies = ALL_VOCABULARIES,
  statusByCode = STATUS_BY_CODE,
  tagsResponseKeys = null,
  frontendTags = null,
} = {}) {
  const errors = [];
  const stats = {};

  const docText = existsSync(docPath) ? readFileSync(docPath, 'utf8') : null;
  if (docText === null) {
    errors.push('缺少字段级契约文档：' + docPath);
    return { errors, stats };
  }

  const endpoints = documentedEndpoints(docPath);
  const documented = new Map(endpoints.map((row) => [endpointKey(row), row]));
  stats.documentedEndpointCount = documented.size;

  /* 1 + 2. 已实现路由 ⊆ 契约，且方法 / 路径 / 参数名完全一致 */
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (!documented.has(key)) {
      errors.push(`已实现的路由在 docs/10 里没有声明：${key}（要么改代码，要么先改契约）`);
    }
  }
  stats.implementedEndpointCount = routes.length;
  stats.coverage = documented.size === 0 ? 0 : Math.round((routes.length / documented.size) * 100) + '%';

  /* 3. /api/tags 的响应键 == 契约里写的响应字段 */
  const tagsRow = documented.get('GET /api/tags');
  const tagsKeys = tagsResponseKeys ?? Object.keys((await import('../src/data/vocabularies.js')).publicTags());
  if (!tagsRow) {
    errors.push('docs/10 里找不到 GET /api/tags');
  } else {
    const declared = extractTokens(tagsRow.response).sort();
    const actual = [...tagsKeys].sort();
    for (const key of actual) if (!declared.includes(key)) errors.push(`/api/tags 下发了契约没写的字段：${key}`);
    for (const key of declared) if (!actual.includes(key)) errors.push(`/api/tags 漏了契约声明的字段：${key}`);
  }

  /* 4. 词表逐值等于前端 tags.js */
  const frontend = frontendTags ?? (await import(pathToFileURL(FRONTEND_TAGS_MODULE).href));
  for (const name of VOCABULARY_NAMES) {
    const expected = frontend[name];
    const actual = vocabularies[name];
    if (!Array.isArray(actual)) {
      errors.push(`后端词表里找不到 ${name}`);
      continue;
    }
    if (!Array.isArray(expected)) {
      errors.push(`前端 tags.js 里找不到 ${name}`);
      continue;
    }
    const actualSet = new Set(actual);
    for (const value of expected) if (!actualSet.has(value)) errors.push(`词表 ${name} 漏了取值：${value}`);
    for (const value of actualSet) if (!expected.includes(value)) errors.push(`词表 ${name} 多出前端的取值：${value}`);
  }
  stats.vocabularyCount = VOCABULARY_NAMES.length;

  /* 4b. 契约末尾补充的三组取值（languagesSpoken / direction / status）也要在文档里写出来 */
  for (const [name, values] of Object.entries(EXTRA_VALUE_SETS)) {
    for (const value of values) {
      if (!docText.includes('`' + value + '`')) errors.push(`补充取值 ${name} 的 ${value} 没在 docs/10 里写出`);
    }
  }
  stats.extraValueSetCount = Object.keys(EXTRA_VALUE_SETS).length;

  /* 5. 错误码都在契约里声明过 */
  for (const code of Object.keys(statusByCode)) {
    if (!docText.includes('`' + code + '`')) errors.push(`错误码 ${code} 没在 docs/10 里声明`);
  }
  stats.errorCodeCount = Object.keys(statusByCode).length;

  /* 6. interests 上限与契约一致 */
  if (!/兴趣标签，上限\s*5|最多\s*5/.test(docText)) {
    errors.push('契约里没有写清 interests 上限（前端 MAX_INTERESTS）');
  }
  if (MAX_INTERESTS !== 5) errors.push('MAX_INTERESTS 与契约不符：' + MAX_INTERESTS);

  return { errors, stats };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const { errors, stats } = await checkContract();
  if (errors.length > 0) {
    console.error('后端契约校验失败：');
    for (const error of errors) console.error(' - ' + error);
    process.exitCode = 1;
  } else {
    console.log('后端契约校验通过：' + JSON.stringify(stats));
  }
}

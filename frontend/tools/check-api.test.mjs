/**
 * 接口契约校验的测试。运行：node --test frontend/tools
 *
 * 除了跑真实文档的全量校验，也逐条验证每个规则**真的会拦人**——
 * 注入一处不一致之后必须报出对应的错误，避免「校验永远返回空错误」这种假绿。
 */

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  API_V1_DOC,
  VOCABULARY_EXPORTS,
  checkApi,
  endpointRows,
  expectedFieldPaths,
  extractTokens,
  fieldRows,
  jsonBlocks,
  leafPaths,
  mockMethodNames,
  tables,
  vocabularyRows,
} from './check-api.mjs';

const frontendDir = resolve(import.meta.dirname, '..');
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const FENCE = BACKTICK.repeat(3);
const tick = (value) => BACKTICK + value + BACKTICK;
const lines = (...rows) => rows.join(LF);

test('真实文档：属性汇总与接口契约零错误', () => {
  const { errors, stats } = checkApi({ frontendDir });
  assert.deepEqual(errors, [], '存在不一致：' + LF + errors.join(LF));
  assert.equal(stats.endpointCount, 39);
  assert.equal(stats.fieldCount, 54);
  assert.equal(stats.runtimeFieldCount, 7);
  assert.equal(stats.vocabularyCount, VOCABULARY_EXPORTS.length);
  assert.equal(stats.achievementCount, 14);
  assert.equal(stats.mockMethodCount, 40);
  assert.ok(stats.jsonBlockCount >= 15, '接口契约应当给出足够多的字段级示例');
});

test('expectedFieldPaths：持久化 46 条加运行时 7 条，且不重复', () => {
  const paths = expectedFieldPaths();
  assert.equal(paths.length, 54);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('settings.visibility.interests'));
  assert.ok(paths.includes('social.buddyRequests'));
  assert.ok(paths.includes('runtime.matchRequest'));
  assert.ok(paths.includes('runtime.matchPeers'), '匹配频道推来的候选人列表也是运行时属性');
});

test('leafPaths：数组整体算一个叶子，不展开元素', () => {
  assert.deepEqual(leafPaths({ a: { b: 1 }, c: [1, 2], d: null }).sort(), ['a.b', 'c', 'd']);
  assert.deepEqual(leafPaths({}), []);
});

test('endpointRows：按列名定位，方法与字段都能取到', () => {
  const markdown = lines(
    '| 接口 | 方法 | 鉴权 | 幂等 | 请求字段 | 响应字段 | 错误码 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| ' + tick('/api/auth/session') + ' | POST | 否 | 是 | ' + tick('role') + ' | ' + tick('token') + ' | 400 |',
  );
  const rows = endpointRows(markdown);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, '/api/auth/session');
  assert.equal(rows[0].method, 'POST');
  assert.deepEqual(extractTokens(rows[0].request), ['role']);
  assert.deepEqual(extractTokens(rows[0].response), ['token']);
});

test('tables：分隔行不算数据，非表格行切断表格', () => {
  const markdown = lines(
    '| 词表 | 取值 |',
    '| --- | --- |',
    '| ' + tick('ROLES') + ' | ' + tick('learner') + ' |',
    '',
    '| 成就 | 角色 |',
    '| --- | --- |',
    '| ' + tick('first_conversation') + ' | learner |',
  );
  const parsed = tables(markdown);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0][0], ['词表', '取值']);
  assert.equal(parsed[0].length, 2);
  assert.equal(parsed[1][0][0], '成就');
  assert.equal(parsed[1].length, 2);
});

test('extractTokens 只认反引号里的内容', () => {
  assert.deepEqual(extractTokens('见 ' + tick('topics') + '、裸写的 topics'), ['topics']);
  assert.deepEqual(extractTokens('无'), []);
});

test('mockMethodNames 与服务层真实暴露的方法一一对应', () => {
  const names = mockMethodNames();
  assert.equal(names.length, 40);
  assert.ok(names.includes('getMe'));
  assert.ok(names.includes('sendBuddyRequest'));
  assert.ok(names.includes('getIceServers'));
  assert.ok(names.includes('requestMatch'), '演示辅助方法也应当被登记');
  assert.ok(names.includes('listRecommendedBuddies'), 'C 的推荐读取口子');
  assert.ok(names.includes('createRoomWithBuddy'), 'C 的一键成房');
});

test('jsonBlocks 只取 json 围栏', () => {
  const markdown = lines(FENCE + 'json', '{"ok":true}', FENCE, FENCE + 'text', 'not json', FENCE);
  const blocks = jsonBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.deepEqual(JSON.parse(blocks[0]), { ok: true });
});

test('真实文档里的属性字典与词表都能解析且不留空', () => {
  const text = readFileSync(join(frontendDir, API_V1_DOC), 'utf8');
  const fields = fieldRows(text);
  assert.equal(fields.length, 54);
  assert.ok(fields.every((row) => row.type.length > 0), '每一行都要有类型');
  const vocabulary = vocabularyRows(text);
  assert.equal(vocabulary.length, VOCABULARY_EXPORTS.length);
  for (const row of vocabulary) assert.ok(row.values.length > 0, row.name + ' 没有取值');
});

/** 把真实的 frontend/ 复制到临时目录并注入一处改动，验证规则真的会拦人。 */
function withMutatedApiDoc(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'cantobridge-api-'));
  cpSync(frontendDir, dir, { recursive: true });
  const target = join(dir, API_V1_DOC);
  const before = readFileSync(target, 'utf8');
  const after = mutate(before);
  assert.notEqual(after, before, '注入的改动没有生效，锚点可能已经变了');
  writeFileSync(target, after);
  return checkApi({ frontendDir: dir }).errors;
}

test('校验规则会拦住各类不一致，而不是永远返回空错误', () => {
  const swap = (text, a, b) => text.split(a).join(b);
  const injections = [
    {
      name: '10 里多出一个 09 没声明的端点',
      mutate: (text) => swap(text, tick('/api/app/version-policy'), tick('/api/app/version-policy-x')),
      expect: '09 清单里没有的端点',
    },
    {
      name: '10 缺一个 09 已声明的端点',
      mutate: (text) => swap(text, tick('/api/rtc/ice-servers'), tick('/api/rtc/ice-servers-x')),
      expect: '缺少 09 已声明的端点',
    },
    {
      name: '属性字典漏了代码里真实存在的属性',
      mutate: (text) => swap(text, tick('progress.topicsSeen'), tick('progress.topicsSeenX')),
      expect: '属性字典漏了代码里真实存在的属性：progress.topicsSeen',
    },
    {
      name: '词表漏了一个取值',
      mutate: (text) => swap(text, tick('badminton'), ''),
      expect: '词表 INTERESTS 漏了取值：badminton',
    },
    {
      name: 'mock 对照表漏了一个方法',
      mutate: (text) => swap(text, tick('checkVersionPolicy'), tick('checkVersionPolicyX')),
      expect: 'mock 对照表漏了方法：checkVersionPolicy',
    },
    {
      name: '端点表少了请求字段列',
      mutate: (text) => swap(text, '请求字段', '请求'),
      expect: '缺少请求字段',
    },
    {
      name: 'json 示例被改坏',
      mutate: (text) => text.replace('"xp": 360,', '"xp": 360,,'),
      expect: '不是合法 JSON',
    },
  ];

  for (const { name, mutate, expect: expected } of injections) {
    const errors = withMutatedApiDoc(mutate);
    assert.ok(errors.length > 0, '注入「' + name + '」后校验竟然通过，说明规则失效');
    assert.ok(
      errors.some((message) => message.includes(expected)),
      '注入「' + name + '」后没有报出期望的错误「' + expected + '」，实际为：' + errors.join(' | '),
    );
  }
});

test('缺少 10 时直接报缺文档，而不是静默通过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cantobridge-api-'));
  cpSync(frontendDir, dir, { recursive: true });
  unlinkSync(join(dir, API_V1_DOC));
  const { errors } = checkApi({ frontendDir: dir });
  assert.ok(errors.some((message) => message.includes('缺少接口契约文档')), errors.join(' | '));
});

test('根目录 TODO.md：任务清单能对上 09 的接口清单', () => {
  const { stats, errors } = checkApi({ frontendDir });
  assert.deepEqual(errors, []);
  assert.ok(stats.rootTodoEndpointMentions >= 20, 'TODO.md 应当点名要实现的接口');
});

test('TODO.md：指向 09 未声明的接口会被拦下', () => {
  const base = mkdtempSync(join(tmpdir(), 'cantobridge-root-'));
  const dir = join(base, 'frontend');
  cpSync(frontendDir, dir, { recursive: true });
  writeFileSync(join(base, 'TODO.md'), '字段级契约见 frontend/docs/10-api-v1.md。先做 ' + tick('/api/ghost/thing') + '。');
  const { errors } = checkApi({ frontendDir: dir });
  assert.ok(errors.some((message) => message.includes('TODO.md 引用了 09 未声明的接口')), errors.join(' | '));
});

test('TODO.md：忘了指向字段级契约会被拦下', () => {
  const base = mkdtempSync(join(tmpdir(), 'cantobridge-root-'));
  const dir = join(base, 'frontend');
  cpSync(frontendDir, dir, { recursive: true });
  writeFileSync(join(base, 'TODO.md'), '先做 ' + tick('/api/tags') + '。');
  const { errors } = checkApi({ frontendDir: dir });
  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes('没有指向字段级契约'), errors.join(' | '));
});


test('TODO.md：本地专用口子（探活 / 演示重置）不会被误判成幽灵接口', () => {
  const base = mkdtempSync(join(tmpdir(), 'cantobridge-root-'));
  const dir = join(base, 'frontend');
  cpSync(frontendDir, dir, { recursive: true });
  writeFileSync(
    join(base, 'TODO.md'),
    '字段级契约见 frontend/docs/10-api-v1.md。先做 ' + tick('/api/tags') + '；本地探活 ' + tick('GET /api/health') + '；演示重置 ' + tick('POST /api/dev/reset') + '。',
  );
  const { errors, stats } = checkApi({ frontendDir: dir });
  assert.deepEqual(errors, []);
  assert.ok(stats.rootTodoEndpointMentions >= 1);
});

/** 造一个只改了 tasks/ 交接单的临时仓库。 */
function withMutatedTaskFile(content) {
  const base = mkdtempSync(join(tmpdir(), 'cantobridge-task-'));
  const dir = join(base, 'frontend');
  cpSync(frontendDir, dir, { recursive: true });
  writeFileSync(join(dir, 'tasks', 'bc-exchange-implementation.md'), content);
  return checkApi({ frontendDir: dir });
}

test('真实交接单：frontend/tasks/ 里的接口引用都在 09 里声明过', () => {
  const { stats, errors } = checkApi({ frontendDir });
  assert.deepEqual(errors, []);
  assert.ok(stats.tasksFileCount >= 1, 'tasks/ 下应当有交接提示词');
});

test('交接单：写 09 没声明的接口会被拦下', () => {
  const { errors } = withMutatedTaskFile(
    '字段级契约见 frontend/docs/10-api-v1.md。先做 ' + tick('/api/ghost/thing') + '。',
  );
  assert.ok(errors.some((message) => message.includes('引用了 09 未声明的接口')), errors.join(' | '));
});

test('交接单：提到了接口却没指向字段级契约会被拦下', () => {
  const { errors } = withMutatedTaskFile('先做 ' + tick('/api/tags') + '。');
  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes('没有指向字段级契约'), errors.join(' | '));
});

test('仓库没有 tasks/ 目录时不报错（老仓库仍然能通过）', () => {
  const base = mkdtempSync(join(tmpdir(), 'cantobridge-notasks-'));
  const dir = join(base, 'frontend');
  cpSync(frontendDir, dir, { recursive: true });
  rmSync(join(dir, 'tasks'), { recursive: true, force: true });
  const { stats, errors } = checkApi({ frontendDir: dir });
  assert.deepEqual(errors, []);
  assert.equal(stats.tasksFileCount, 0);
});

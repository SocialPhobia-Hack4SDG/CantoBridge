/**
 * 字典接口：内容必须和前端 frontend/src/data/tags.js **逐值一致**。
 * 这是「前后端词表不许漂移」的硬约束——前端那边也有脚本把文档钉在代码上，
 * 这里把后端钉在前端唯一的词表真源上。
 *
 * 双身份模型下多了一条：`/api/tags` 只下发**六张公开表**（契约 4.3）。
 * 另外四张（ROLES / MATCH_INTENTS / 两套反馈标签）是契约里声明、但不下发的取值，
 * 仍然要跟前端一致，所以放在 ALL_VOCABULARIES 里逐值比。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as FRONTEND_TAGS from '../../frontend/src/data/tags.js';
import { ALL_VOCABULARIES, EXTRA_VALUE_SETS, publicTags } from '../src/data/vocabularies.js';
import { startTestServer } from './helpers/server.mjs';

/** 契约 4.3 声明的六个响应字段，多一个少一个都算漂移。 */
const PUBLIC_TAG_KEYS = ['identities', 'interests', 'goals', 'buddyTopics', 'levels', 'nativeLanguages'];

/** 契约 3.6 的十张表：键名与前端 tags.js 的导出名一一对应。 */
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

test('GET /api/tags：六张公开词表一次全给，键名与契约一致', async () => {
  const ui = await startTestServer();
  try {
    const res = await ui.request('GET', '/api/tags');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(Object.keys(res.json.data).sort(), [...PUBLIC_TAG_KEYS].sort());
    assert.deepEqual(Object.keys(publicTags()).sort(), [...PUBLIC_TAG_KEYS].sort(), '服务端拼的字典也得是这六个');

    // 双身份模型里这几张不下发：身份取值走 /api/auth/session 的 role，教 / 学标签是派生的
    for (const hidden of ['languagesSpoken', 'speakerTypes', 'roles', 'matchIntents']) {
      assert.equal(hidden in res.json.data, false, `不该下发 ${hidden}`);
    }

    // 每张表都得是非空数组，且不带重复值
    for (const key of PUBLIC_TAG_KEYS) {
      assert.ok(Array.isArray(res.json.data[key]), `${key} 要是数组`);
      assert.ok(res.json.data[key].length > 0, `${key} 不能是空表`);
      assert.equal(new Set(res.json.data[key]).size, res.json.data[key].length, `${key} 不该有重复取值`);
    }
  } finally {
    await ui.close();
  }
});

test('词表逐值等于前端的 tags.js（少一个 / 多一个都会红）', () => {
  for (const name of VOCABULARY_NAMES) {
    assert.ok(Array.isArray(FRONTEND_TAGS[name]), `前端 tags.js 里找不到 ${name}`);
    assert.deepEqual(ALL_VOCABULARIES[name], FRONTEND_TAGS[name], `词表 ${name} 与前端不一致`);
  }
  // 公开的六张表就是上面十张里的六张，别多挂一张出去
  assert.deepEqual(Object.keys(publicTags()).sort(), [...PUBLIC_TAG_KEYS].sort());
});

test('不在十张表里、但契约点名要一致的取值也对得上', () => {
  // languagesSpoken 的元素（契约 3.6 末尾）：yue、mandarin、english，yue 是成为母语者的前提
  assert.deepEqual(EXTRA_VALUE_SETS.LANGUAGES_SPOKEN, ['yue', 'mandarin', 'english']);
  assert.ok(EXTRA_VALUE_SETS.LANGUAGES_SPOKEN.includes('yue'));
  assert.deepEqual(EXTRA_VALUE_SETS.REQUEST_DIRECTIONS, ['incoming', 'outgoing']);
  assert.deepEqual(EXTRA_VALUE_SETS.REQUEST_STATUSES, ['pending']);

  // 回礼（wantToLearn）用的是母语词表去掉 yue：三个取值都在，粤语不在
  const wantToLearnValues = ALL_VOCABULARIES.NATIVE_LANGUAGES.filter((value) => value !== 'yue');
  assert.deepEqual(wantToLearnValues, ['mandarin', 'english', 'other']);
  assert.equal(wantToLearnValues.includes('yue'), false, '回礼不能是粤语（否则退化成单向教学）');
  // 学习者母语里没有粤语——粤语是目标语言，不是「母语」选项
  assert.equal(ALL_VOCABULARIES.NATIVE_LANGUAGES.includes('yue'), false);
});

test('GET /api/tags?kind=…：只回那一张表；不认识的 kind 报 400', async () => {
  const ui = await startTestServer();
  try {
    const one = await ui.request('GET', '/api/tags?kind=interests');
    assert.equal(one.status, 200);
    assert.deepEqual(Object.keys(one.json.data), ['interests']);
    assert.deepEqual(one.json.data.interests, FRONTEND_TAGS.INTERESTS);

    // 六张公开表逐张都能单独取；取到的那张要和一次全给时逐值一致
    const all = await ui.request('GET', '/api/tags');
    for (const key of PUBLIC_TAG_KEYS) {
      const single = await ui.request('GET', `/api/tags?kind=${key}`);
      assert.equal(single.status, 200, `${key} 应当能单独取`);
      assert.deepEqual(single.json.data, { [key]: all.json.data[key] });
    }

    const bad = await ui.request('GET', '/api/tags?kind=nickname');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'bad_request');

    // 契约里存在、但不属于 /api/tags 的词表：不能靠 kind 漏出去
    const notPublic = await ui.request('GET', '/api/tags?kind=languagesSpoken');
    assert.equal(notPublic.status, 400);
    assert.equal(notPublic.json.error.code, 'bad_request');
  } finally {
    await ui.close();
  }
});

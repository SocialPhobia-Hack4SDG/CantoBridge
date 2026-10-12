/**
 * `POST /api/me/saved-phrases` —— 句型收藏（契约 4.5 节）。
 *
 * 前端本地已有兜底（接口挂了星星也要变色，见 07 的 Q-G26），所以这个接口的验收点很实际：
 *   - `cantonese` 与 `phrase` **至少给一个**，两个都不给是 400（否则收藏里会出现一条空记录）；
 *   - 收藏的新记录排在前面（与「我的」页列表一致）；
 *   - 返回的 `savedPhrase` 字段齐全，前端可以直接塞进列表，不用自己补 id 与时间。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startTestServer } from './helpers/server.mjs';

const SAVED_PHRASE_KEYS = ['cantonese', 'mandarin', 'phrase', 'roomId', 'savedAt', 'savedPhraseId'];

function savedPhrasesOf(ui) {
  return ui.db.getRelations(ui.accountIdOf()).savedPhrases;
}

test('收藏：201 + savedPhrase 字段齐全', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const res = await ui.request('POST', '/api/me/saved-phrases', {
      token,
      body: {
        cantonese: '你最近睇緊咩動漫？',
        mandarin: '你最近在看什么动漫？',
        phrase: 'What anime have you been watching lately?',
        roomId: 'r-lucas-demo',
        requestId: 'sp-1',
      },
    });

    assert.equal(res.status, 201, '收藏是新建资源');
    assert.deepEqual(Object.keys(res.json.data), ['savedPhrase']);
    const saved = res.json.data.savedPhrase;
    assert.deepEqual(Object.keys(saved).sort(), [...SAVED_PHRASE_KEYS].sort());
    assert.equal(saved.cantonese, '你最近睇緊咩動漫？');
    assert.equal(saved.mandarin, '你最近在看什么动漫？');
    assert.equal(saved.phrase, 'What anime have you been watching lately?');
    assert.equal(saved.roomId, 'r-lucas-demo');
    assert.ok(saved.savedPhraseId.startsWith('sp-'), '前端拿它做列表 key');
    assert.ok(!Number.isNaN(Date.parse(saved.savedAt)), 'savedAt 是可解析的时间');

    const stored = savedPhrasesOf(ui);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0], saved, '落库的就是返回的那一份');
  } finally {
    await ui.close();
  }
});

test('收藏：cantonese 与 phrase 至少给一个', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');

    const both = await ui.request('POST', '/api/me/saved-phrases', { token, body: { requestId: 'sp-none' } });
    assert.equal(both.status, 400);
    assert.equal(both.json.error.code, 'bad_request');
    assert.match(both.json.error.message, /cantonese or phrase/);

    const onlyPhrase = await ui.request('POST', '/api/me/saved-phrases', {
      token,
      body: { phrase: 'Thank you', requestId: 'sp-phrase' },
    });
    assert.equal(onlyPhrase.status, 201);
    assert.equal(onlyPhrase.json.data.savedPhrase.phrase, 'Thank you');
    assert.equal(onlyPhrase.json.data.savedPhrase.cantonese, null, '没给的可选字段是 null，不是 undefined');

    const onlyCantonese = await ui.request('POST', '/api/me/saved-phrases', {
      token,
      body: { cantonese: '多謝', requestId: 'sp-cantonese' },
    });
    assert.equal(onlyCantonese.status, 201);
    assert.equal(onlyCantonese.json.data.savedPhrase.cantonese, '多謝');
    assert.equal(onlyCantonese.json.data.savedPhrase.phrase, null);
  } finally {
    await ui.close();
  }
});

test('收藏：两条都在，新的排在前面', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    await ui.request('POST', '/api/me/saved-phrases', {
      token,
      body: { cantonese: '第一句', requestId: 'sp-a' },
    });
    await ui.request('POST', '/api/me/saved-phrases', {
      token,
      body: { cantonese: '第二句', requestId: 'sp-b' },
    });

    const stored = savedPhrasesOf(ui);
    assert.equal(stored.length, 2, '两条都要留下（幂等键不同就是两笔）');
    assert.equal(stored[0].cantonese, '第二句', '最新一条在最前，与「我的」页列表一致');
    assert.equal(stored[1].cantonese, '第一句');
  } finally {
    await ui.close();
  }
});

test('收藏：越界的字符串与不认识的字段一律 400', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const cases = [
      { cantonese: 'x'.repeat(201) },
      { phrase: 'x'.repeat(401) },
      { mandarin: 'x'.repeat(201) },
      { roomId: 'x'.repeat(121) },
      { cantonese: '', phrase: '' },
      { 不认识的字段: 'x', phrase: 'ok' },
    ];
    for (const body of cases) {
      const res = await ui.request('POST', '/api/me/saved-phrases', { token, body });
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 40)} 应当 400`);
      assert.equal(res.json.error.code, 'bad_request');
    }
    assert.equal(savedPhrasesOf(ui).length, 0, '400 的一律不落库');
  } finally {
    await ui.close();
  }
});

test('收藏：没令牌 401', async () => {
  const ui = await startTestServer();
  try {
    const res = await ui.request('POST', '/api/me/saved-phrases', { body: { phrase: 'hello' } });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

test('收藏：同一 requestId 幂等回放（弱网双击不会存两条）', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const body = { cantonese: '早晨', requestId: 'sp-idem' };
    const first = await ui.request('POST', '/api/me/saved-phrases', { token, body });
    const second = await ui.request('POST', '/api/me/saved-phrases', { token, body });
    assert.deepEqual(second.json, first.json);
    assert.equal(savedPhrasesOf(ui).length, 1, '回放不会再存一条');
  } finally {
    await ui.close();
  }
});

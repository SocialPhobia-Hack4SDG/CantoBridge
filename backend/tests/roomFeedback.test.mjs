/**
 * `POST /api/rooms/:roomId/feedback` —— 结算第二步的评价（契约 4.5 节）。
 *
 * 两个要点：
 *   1. **词表按被评价的人选**：对方是母语者 → 学习者给母语者的词表；对方是学习者 → 母语者给学习者的词表。
 *      跨词表的取值必须 400（否则「评价」就成了自由文本，排行榜与成就都没法算）；
 *   2. **挂到当前房间同一位伙伴的记录上**：找不到记录就是 404 —— 宁可让前端提示，
 *      也不要静默丢弃（演示时「点了没反应」最难查）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUDDY_FEEDBACK_TAGS, LEARNER_FEEDBACK_TAGS } from '../src/data/vocabularies.js';
import { registerWithProfile, seedBothSides } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

/** 母语者挑人成房并结算 —— 对方（peer）是学习者。 */
async function settledRoomWithLearner(ui, learnerId, deviceId = 'device-buddy') {
  const buddy = await registerWithProfile(ui, 'buddy', deviceId, { interests: ['movies'] });
  const created = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId } });
  assert.equal(created.status, 201);
  const roomId = created.json.data.roomId;
  const ended = await ui.request('POST', `/api/rooms/${roomId}/end`, {
    token: buddy.token,
    body: { durationSec: 60, cardsUsed: 1, requestId: 'fb-setup-' + learnerId },
  });
  assert.equal(ended.status, 200, '结算成功后才有可挂评价的记录');
  return { ...buddy, roomId, peerId: created.json.data.peer.peerId };
}

/** 学习者接受匹配成房并结算 —— 对方（peer）是母语者。 */
async function settledRoomWithBuddy(ui, deviceId = 'device-learner') {
  const learner = await registerWithProfile(ui, 'learner', deviceId, {});
  const pending = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
  assert.equal(pending.status, 201, '待接受请求是前置条件');
  const accepted = await ui.request('POST', `/api/match/requests/${pending.json.data.requestId}/accept`, {
    token: learner.token,
    body: {},
  });
  const roomId = accepted.json.data.roomId;
  await ui.request('POST', `/api/rooms/${roomId}/end`, {
    token: learner.token,
    body: { durationSec: 60, cardsUsed: 0, requestId: 'fb-setup-learner' },
  });
  return { ...learner, roomId, peerId: accepted.json.data.peer.peerId };
}

test('反馈：对方是学习者 → 用母语者给学习者的词表', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const { token, roomId } = await settledRoomWithLearner(ui, learners[0].peerId);

    const ok = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [BUDDY_FEEDBACK_TAGS[0]], requestId: 'fb-1' },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true, data: { ok: true } });

    // 跨词表：'patient' 只属于「学习者给母语者」那一套
    const crossVocabulary = BUDDY_FEEDBACK_TAGS.includes('patient') ? 'easy_to_understand' : 'patient';
    assert.ok(LEARNER_FEEDBACK_TAGS.includes(crossVocabulary), '这个取值只在前端词表里');
    const rejected = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [crossVocabulary], requestId: 'fb-2' },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.error.code, 'bad_request');
    assert.match(rejected.json.error.message, /tags/);
  } finally {
    await ui.close();
  }
});

test('反馈：对方是母语者 → 用学习者给母语者的词表', async () => {
  const ui = await startTestServer();
  try {
    await seedBothSides(ui);
    const { token, roomId } = await settledRoomWithBuddy(ui);

    const ok = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [LEARNER_FEEDBACK_TAGS[0]], requestId: 'fb-buddy-1' },
    });
    assert.equal(ok.status, 200);

    const rejected = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: ['active_learner'], requestId: 'fb-buddy-2' },
    });
    assert.equal(rejected.status, 400, '母语者侧的词表不能用于评价母语者');
  } finally {
    await ui.close();
  }
});

test('反馈：tags 空且没跳过 → 400；skipped: true 空 tags → 200', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const { token, roomId } = await settledRoomWithLearner(ui, learners[0].peerId);

    const empty = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [], requestId: 'fb-empty' },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error.code, 'bad_request');

    const missing = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { requestId: 'fb-missing' },
    });
    assert.equal(missing.status, 400, '一个都不给就等于没评价');

    const skipped = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [], skipped: true, requestId: 'fb-skipped' },
    });
    assert.equal(skipped.status, 200, '明确跳过是允许的');
  } finally {
    await ui.close();
  }
});

test('反馈：skipped 必须是布尔，字段名写错要当场发现', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const { token, roomId } = await settledRoomWithLearner(ui, learners[0].peerId);

    const notBoolean = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [BUDDY_FEEDBACK_TAGS[0]], skipped: 'yes' },
    });
    assert.equal(notBoolean.status, 400);

    const unknownKey = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tag: [BUDDY_FEEDBACK_TAGS[0]] },
    });
    assert.equal(unknownKey.status, 400);
    assert.match(unknownKey.json.error.message, /unknown field/);

    // 重复取值会被去重（先 dedupe 再判上限），所以「给两遍」不算越界
    const duplicated = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token,
      body: { tags: [...BUDDY_FEEDBACK_TAGS, ...BUDDY_FEEDBACK_TAGS], requestId: 'fb-dup' },
    });
    assert.equal(duplicated.status, 200, '重复取值去重后仍然合法');
  } finally {
    await ui.close();
  }
});

test('反馈：挂到**当前房间**同一位伙伴的记录上', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const first = await settledRoomWithLearner(ui, learners[0].peerId, 'device-buddy-a');
    // 另一条记录：验证不会挂到别人身上
    await settledRoomWithLearner(ui, learners[1].peerId, 'device-buddy-b');

    // 把历史改成「同一位伙伴两条」，新的在前，验证挂的是第一条。
    // 注意 `replace` 是**整份**替换（会清掉 sessions / rooms），所以要基于当前快照改。
    const target = learners[0].peerId;
    const relations = {
      ...ui.db.getRelations(first.accountId),
      history: [
        { sessionId: 's-new', peerId: target, role: 'buddy', durationSec: 60, cardsUsed: 1, topics: [] },
        { sessionId: first.roomId, peerId: target, role: 'buddy', durationSec: 30, cardsUsed: 0, topics: [] },
      ],
    };
    ui.db.replace({ ...ui.db.snapshot(), relations: [relations] });

    const res = await ui.request('POST', `/api/rooms/${first.roomId}/feedback`, {
      token: first.token,
      body: { tags: ['active_learner'], requestId: 'fb-newest' },
    });
    assert.equal(res.status, 200);

    const history = ui.db.getRelations(first.accountId).history;
    assert.deepEqual(history[1].feedback.tags, ['active_learner'], '挂到当前房间而非最近记录');
    assert.equal(history[0].sessionId, 's-new');
    assert.equal(history[0].feedback, undefined, '其他房间记录不动');
  } finally {
    await ui.close();
  }
});

test('反馈：没有对应记录 → 404（宁可提示，也不要静默丢弃）', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy', { interests: ['movies'] });
    const created = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: learners[0].peerId } });
    const roomId = created.json.data.roomId;

    const res = await ui.request('POST', `/api/rooms/${roomId}/feedback`, {
      token: buddy.token,
      body: { tags: ['active_learner'], requestId: 'fb-no-history' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'not_found', '还没结算过，没有可挂的记录');
  } finally {
    await ui.close();
  }
});

test('反馈：房间不存在 404 room_gone，没令牌 401', async () => {
  const ui = await startTestServer();
  try {
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', {});
    const gone = await ui.request('POST', '/api/rooms/r-nope-1/feedback', {
      token: learner.token,
      body: { tags: ['friendly'] },
    });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, 'room_gone');

    const anonymous = await ui.request('POST', '/api/rooms/r-nope-1/feedback', { body: { tags: ['friendly'] } });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

test('反馈：两套词表确实不同（除了共有的 friendly），不是同一份', () => {
  const onlyBuddy = BUDDY_FEEDBACK_TAGS.filter((tag) => !LEARNER_FEEDBACK_TAGS.includes(tag));
  const onlyLearner = LEARNER_FEEDBACK_TAGS.filter((tag) => !BUDDY_FEEDBACK_TAGS.includes(tag));
  assert.ok(onlyBuddy.length > 0 && onlyLearner.length > 0, '两套词表各有独占取值，跨词表 400 才有意义');
  assert.ok(LEARNER_FEEDBACK_TAGS.includes('friendly') && BUDDY_FEEDBACK_TAGS.includes('friendly'), 'friendly 两边都有');
});

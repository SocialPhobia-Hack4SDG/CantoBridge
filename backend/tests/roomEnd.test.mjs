/**
 * `POST /api/rooms/:roomId/end` —— 结算（契约 4.5 节）。
 *
 * 这个文件盯住三件事：
 *   1. **积分与进度按记录规则变**：逐字段断言（xp / conversations / totalMinutes /
 *      practiceMinutesThisWeek / peopleHelped / topicsSeen / distinctTopics），
 *      不是只看 xp —— 少更新一项，首页统计与排行榜就悄悄不对；
 *   2. **必须幂等**：同一 `requestId` 由外壳层回放；**换一个 `requestId` 再打也只拿同一份**
 *      （房间上存了 settlement），绝不会把 XP 加两次、也不会多写一条历史；
 *   3. `unlocked` 只含**本次新解锁**的成就（结算前还差一点 → 结算后达标）。
 *
 * 出厂进度是 0（没有演示账号了），所以「还差一点」这类场景由用例自己
 * `db.updateProgress()` 预置，而不是指望种子。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { unlockedAchievements, newlyUnlocked, xpFor } from '../src/lib/scoring.js';
import { createProgress } from '../src/store/seed.js';
import { registerWithProfile, seedBothSides } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

/** 母语者一侧成房：挑一位等待中的学习者。返回 `{ token, roomId, peerId, accountId }`。 */
async function buddyRoom(ui, learnerId, deviceId = 'device-buddy') {
  const buddy = await registerWithProfile(ui, 'buddy', deviceId, { interests: ['movies'] });
  const created = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId } });
  assert.equal(created.status, 201, '成房是前置条件');
  return { ...buddy, roomId: created.json.data.roomId, peerId: created.json.data.peer.peerId };
}

/**
 * 学习者一侧成房：**等系统匹配到一位母语者 → 接受 → 成房**（不是自己去找人）。
 * 这是学习者真实走的那条路，结算时的 `role` 是 learner。
 */
async function learnerRoom(ui, deviceId = 'device-learner') {
  const learner = await registerWithProfile(ui, 'learner', deviceId, {});
  const pending = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
  assert.equal(pending.status, 201, '待接受请求是前置条件');
  const accepted = await ui.request('POST', `/api/match/requests/${pending.json.data.requestId}/accept`, {
    token: learner.token,
    body: {},
  });
  assert.equal(accepted.status, 201, '接受之后才成房');
  return { ...learner, roomId: accepted.json.data.roomId, peerId: accepted.json.data.peer.peerId };
}

async function progressOf(ui, token) {
  const res = await ui.request('GET', '/api/me', { token });
  assert.equal(res.status, 200);
  return res.json.data.progress;
}

function historyOf(ui, accountId) {
  return ui.db.getRelations(accountId).history;
}

test('结算（学习者）：响应形状与 progress 逐字段都对', async () => {
  const ui = await startTestServer();
  try {
    await seedBothSides(ui);
    const { token, accountId, roomId, peerId } = await learnerRoom(ui);
    const before = await progressOf(ui, token);
    assert.equal(before.xp, 0, '出厂进度是 0，没有演示账号垫底');
    const durationSec = 125;
    const cardsUsed = 3;
    const topics = ['anime', 'food'];

    const res = await ui.request('POST', `/api/rooms/${roomId}/end`, {
      token,
      body: { durationSec, cardsUsed, topics, requestId: 'end-learner-1' },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), [
      'cardsUsed',
      'durationSec',
      'topics',
      'unlocked',
      'xpEarned',
    ]);
    assert.equal(res.json.data.durationSec, durationSec, '原样回传，前端不用自己记');
    assert.equal(res.json.data.cardsUsed, cardsUsed);
    assert.deepEqual(res.json.data.topics, topics);
    assert.equal(res.json.data.xpEarned, xpFor(durationSec, cardsUsed), '积分与前端 xpFor 同源');

    const minutes = Math.round(durationSec / 60);
    const after = await progressOf(ui, token);
    assert.equal(after.xp, before.xp + xpFor(durationSec, cardsUsed), 'xp 加上本次积分');
    assert.equal(after.conversations, before.conversations + 1, '会话数 +1');
    assert.equal(after.totalMinutes, before.totalMinutes + minutes, '累计分钟按四舍五入累加');
    assert.equal(
      after.practiceMinutesThisWeek,
      before.practiceMinutesThisWeek + minutes,
      '本周分钟同步累加',
    );
    assert.equal(after.peopleHelped, before.peopleHelped, '学习者身份不加「帮助过多少人」');
    assert.deepEqual(after.topicsSeen, [...(before.topicsSeen ?? []), ...topics], '见过的话题累积');
    assert.equal(
      after.distinctTopics,
      Math.max(before.distinctTopics, (before.topicsSeen ?? []).length + topics.length),
      '去重话题数取 max(旧值, 累积后长度)',
    );
    assert.deepEqual(before.achievements, after.achievements, '成就全量写在 /api/me/progress，这里不动');

    // 房间收口 + 一条历史（新的在最前）
    const room = await ui.request('GET', `/api/rooms/${roomId}`, { token });
    assert.equal(room.json.data.status, 'ended');
    assert.deepEqual(room.json.data.room.settlement, res.json.data, '结算结果留在房间上，供重放');

    const history = historyOf(ui, accountId);
    assert.equal(history.length, 1);
    assert.equal(history[0].peerId, peerId, '记的是这次匹配到的那位伙伴');
    assert.equal(history[0].role, 'learner');
    assert.equal(history[0].durationSec, durationSec);
    assert.equal(history[0].cardsUsed, cardsUsed);
    assert.deepEqual(history[0].topics, topics);
    assert.ok(history[0].peerLabel, '非匿名伙伴记下名字');
  } finally {
    await ui.close();
  }
});

test('结算（母语者）：peopleHelped +1，历史里记的是母语者身份', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const room = await buddyRoom(ui, learners[1].peerId);
    const before = await progressOf(ui, room.token);
    const res = await ui.request('POST', `/api/rooms/${room.roomId}/end`, {
      token: room.token,
      body: { durationSec: 300, cardsUsed: 2, topics: ['food'], requestId: 'end-buddy-1' },
    });
    assert.equal(res.status, 200);

    const after = await progressOf(ui, room.token);
    assert.equal(after.peopleHelped, before.peopleHelped + 1, '母语者身份才加「帮助过多少人」');
    assert.equal(after.xp, before.xp + xpFor(300, 2));
    assert.equal(after.totalMinutes, before.totalMinutes + 5);
    assert.equal(historyOf(ui, room.accountId)[0].role, 'buddy');
  } finally {
    await ui.close();
  }
});

test('unlocked 只含新增：结算前差一点、结算后达标（学习者）', async () => {
  const ui = await startTestServer();
  try {
    await seedBothSides(ui);
    const { token, accountId, roomId } = await learnerRoom(ui);
    // 预置「还差一点」：29 分钟、0 次会话 —— 结算 2 分钟就同时跨过两条线
    const preset = {
      ...createProgress(),
      conversations: 0,
      totalMinutes: 29,
      streakDays: 3,
      distinctTopics: 0,
      peopleHelped: 0,
      topicsSeen: [],
    };
    ui.db.updateProgress(accountId, preset);

    const expectedBefore = unlockedAchievements('learner', preset);
    assert.deepEqual(expectedBefore, ['three_day_streak'], '三日成就此前已解锁，结算不重复发放');

    const res = await ui.request('POST', `/api/rooms/${roomId}/end`, {
      token,
      body: { durationSec: 120, cardsUsed: 0, requestId: 'end-unlock-1' },
    });
    const after = await progressOf(ui, token);
    const expectedAfter = unlockedAchievements('learner', { ...preset, ...after });

    assert.deepEqual(res.json.data.unlocked, newlyUnlocked(expectedBefore, expectedAfter));
    assert.deepEqual(res.json.data.unlocked, ['first_conversation', 'cantonese_explorer'], '只报这两条新增');
    assert.ok(!res.json.data.unlocked.includes('seven_day_streak'), '没达标的不能混进来');
  } finally {
    await ui.close();
  }
});

test('unlocked 只含新增：母语者一次跨过三条线', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const room = await buddyRoom(ui, learners[2].peerId);
    const preset = {
      ...createProgress(),
      conversations: 0,
      totalMinutes: 59,
      peopleHelped: 2,
      streakDays: 0,
      distinctTopics: 0,
      topicsSeen: [],
    };
    ui.db.updateProgress(room.accountId, preset);
    assert.deepEqual(unlockedAchievements('buddy', preset), [], '预置状态一条都没解锁');

    const res = await ui.request('POST', `/api/rooms/${room.roomId}/end`, {
      token: room.token,
      body: { durationSec: 60, cardsUsed: 1, requestId: 'end-unlock-buddy-1' },
    });
    const after = await progressOf(ui, room.token);
    assert.deepEqual(
      res.json.data.unlocked,
      newlyUnlocked([], unlockedAchievements('buddy', { ...preset, ...after })),
    );
    assert.deepEqual(res.json.data.unlocked, [
      'first_buddy_session',
      'helpful_local',
      'culture_ambassador',
    ]);
  } finally {
    await ui.close();
  }
});

test('distinctTopics 取 max(旧值, 累积话题数)：跨两次结算累积', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const room = await buddyRoom(ui, learners[0].peerId);
    ui.db.updateProgress(room.accountId, { ...createProgress(), distinctTopics: 6, topicsSeen: [] });

    await ui.request('POST', `/api/rooms/${room.roomId}/end`, {
      token: room.token,
      body: { durationSec: 60, cardsUsed: 0, topics: ['anime', 'food', 'travel'], requestId: 'accum-1' },
    });
    let progress = await progressOf(ui, room.token);
    assert.deepEqual(progress.topicsSeen, ['anime', 'food', 'travel']);
    assert.equal(progress.distinctTopics, 6, '见过 3 个还不如原来的 6，保持 6');

    const second = await ui.request('POST', '/api/rooms', { token: room.token, body: { learnerId: learners[1].peerId } });
    await ui.request('POST', `/api/rooms/${second.json.data.roomId}/end`, {
      token: room.token,
      body: {
        durationSec: 60,
        cardsUsed: 0,
        topics: ['travel', 'music', 'sports', 'gaming', 'culture'],
        requestId: 'accum-2',
      },
    });
    progress = await progressOf(ui, room.token);
    assert.deepEqual(
      progress.topicsSeen,
      ['anime', 'food', 'travel', 'music', 'sports', 'gaming', 'culture'],
      '去重后累积：travel 不重复',
    );
    assert.equal(progress.distinctTopics, 7, '超过旧值就抬到累积长度');

    const history = historyOf(ui, room.accountId);
    assert.equal(history.length, 2, '两次结算两条记录');
    assert.equal(history[0].peerId, learners[1].peerId, '新的排在最前');
    assert.equal(history[1].peerId, learners[0].peerId);
  } finally {
    await ui.close();
  }
});

test('结算幂等：同一 requestId 原样回放，只加一次 XP、只写一条历史', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const room = await buddyRoom(ui, learners[0].peerId);
    const body = { durationSec: 180, cardsUsed: 4, topics: ['movies'], requestId: 'end-idem-same' };

    const first = await ui.request('POST', `/api/rooms/${room.roomId}/end`, { token: room.token, body });
    const afterFirst = await progressOf(ui, room.token);
    const second = await ui.request('POST', `/api/rooms/${room.roomId}/end`, { token: room.token, body });
    const afterSecond = await progressOf(ui, room.token);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.json, first.json, '同一 requestId 逐字节回放');
    assert.deepEqual(afterSecond, afterFirst, '第二次不能再加 XP');
    assert.equal(historyOf(ui, room.accountId).length, 1, '第二次不能再写一条历史');
  } finally {
    await ui.close();
  }
});

test('结算幂等（第二道保险）：换一个 requestId 也只拿同一份、progress 不变', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const room = await buddyRoom(ui, learners[1].peerId);
    const first = await ui.request('POST', `/api/rooms/${room.roomId}/end`, {
      token: room.token,
      body: { durationSec: 90, cardsUsed: 1, requestId: 'end-idem-a' },
    });
    const snapshot = await progressOf(ui, room.token);

    const again = await ui.request('POST', `/api/rooms/${room.roomId}/end`, {
      token: room.token,
      body: { durationSec: 9999, cardsUsed: 32, topics: ['被忽略了'], requestId: 'end-idem-b' },
    });
    const after = await progressOf(ui, room.token);

    assert.deepEqual(again.json, first.json, '换 requestId 也走房间上的 settlement，不重新结算');
    assert.deepEqual(after, snapshot, '弱网重试绝不能把 XP 加两次');
    assert.equal(historyOf(ui, room.accountId).length, 1, '也不该多写一条历史');
    assert.equal(again.json.data.durationSec, 90, '连入参都不采信第二次的');
  } finally {
    await ui.close();
  }
});

test('结算：入参缺省按 0 处理，越界 / 字段不认识一律 400', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const first = await buddyRoom(ui, learners[0].peerId, 'device-buddy-a');
    const empty = await ui.request('POST', `/api/rooms/${first.roomId}/end`, { token: first.token, body: {} });
    assert.equal(empty.status, 200);
    assert.equal(empty.json.data.durationSec, 0);
    assert.equal(empty.json.data.cardsUsed, 0);
    assert.equal(empty.json.data.xpEarned, 0, '空结算不给分');

    const second = await buddyRoom(ui, learners[1].peerId, 'device-buddy-b');
    const cases = [
      { durationSec: 1.5 },
      { durationSec: 86401 },
      { durationSec: -1 },
      { cardsUsed: 65 },
      { cardsUsed: '3' },
      { topics: ['ok', 42] },
      { topics: new Array(17).fill('t').map((_, index) => 'topic-' + index) },
      { 不认识的字段: 1 },
    ];
    for (const body of cases) {
      const res = await ui.request('POST', `/api/rooms/${second.roomId}/end`, { token: second.token, body });
      assert.equal(res.status, 400, `${JSON.stringify(body)} 应当 400`);
      assert.equal(res.json.error.code, 'bad_request');
    }
    assert.equal(historyOf(ui, second.accountId).length, 0, '400 的请求不该留下历史');
  } finally {
    await ui.close();
  }
});

test('结算：topics 去重且长度受限，超长话题名 400', async () => {
  const ui = await startTestServer();
  try {
    const { learners } = await seedBothSides(ui);
    const room = await buddyRoom(ui, learners[0].peerId, 'device-buddy-a');
    const res = await ui.request('POST', `/api/rooms/${room.roomId}/end`, {
      token: room.token,
      body: { durationSec: 60, cardsUsed: 0, topics: ['anime', 'anime', 'food'], requestId: 'dedupe-1' },
    });
    assert.deepEqual(res.json.data.topics, ['anime', 'food'], '响应里也去重');
    const progress = await progressOf(ui, room.token);
    assert.deepEqual(progress.topicsSeen, ['anime', 'food']);

    const other = await buddyRoom(ui, learners[1].peerId, 'device-buddy-b');
    const tooLong = await ui.request('POST', `/api/rooms/${other.roomId}/end`, {
      token: other.token,
      body: { topics: ['x'.repeat(61)] },
    });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.json.error.message, /topics/);
  } finally {
    await ui.close();
  }
});

test('结算：房间不存在 404 room_gone，没令牌 401', async () => {
  const ui = await startTestServer();
  try {
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', {});
    const gone = await ui.request('POST', '/api/rooms/r-nope-1/end', { token: learner.token, body: {} });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, 'room_gone');

    const anonymous = await ui.request('POST', '/api/rooms/r-nope-1/end', { body: {} });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

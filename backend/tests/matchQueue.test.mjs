/**
 * Phase 2 · 匹配队列（契约 4.4 节）：入队 / 取消 / 连坐作废 / 两个方向的列表。
 *
 * 这个文件盯住四条容易写错的规矩：
 *   1. 重复入队是 409 `already_queued`（前端拿它当「直接进等待面板」，不是错误）；
 *   2. **取消等待要连坐**：同一个动作里作废还没接受的匹配请求（07 Q-G15）；
 *   3. **互补只加权不筛选**：填了回礼只改顺序，谁都不从列表里消失；
 *   4. 匿名与可见范围**由服务端裁剪**，前端拿不到实名。
 *
 * 场景里的候选人不再是种子池，而是**真的注册出来的账号**：每台设备一个
 * `deviceId`，注册 → 填资料 → 入队。这正是现场两台手机的走法。
 *
 * 期望分数不抄死数字：用**前端的** matchScore / matchRank 现算（同源由 matching.test.mjs 钉住），
 * 这样「排序口径漂移」会在这里和那边同时红。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchRank, matchScore } from '../../frontend/src/lib/logic.js';
import { BUDDY_SPECS, LEARNER_SPECS, seedWaitingBuddies, seedWaitingLearners } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

/** 把自己那份母语者资料填上：造出「有分数差 + 有互补」的场景。 */
async function fillBuddyProfile(ui, token, patch = {}) {
  const body = {
    interests: ['movies', 'gaming', 'food'],
    preferredTopics: ['hong_kong_food', 'university_life'],
    wantToLearn: [],
    ...patch,
  };
  const res = await ui.request('PUT', '/api/me/profile/buddy', { token, body });
  assert.equal(res.status, 200, '准备数据：写母语者资料');
  return res.json.data.buddyProfile;
}

/** 按契约的口径算一位学习者应该拿到的分数与排序键（取前端的实现当预期值）。 */
function expectedLearnerEntry({ row, myTags, wantToLearn }) {
  const peerTags = [...(row.interests ?? []), row.goal].filter(Boolean);
  const nativeLanguages = [row.nativeLanguage].filter(Boolean);
  const score = matchScore(myTags, peerTags);
  return {
    peerId: row.userId,
    matchScore: score,
    rank: matchRank({ matchScore: score, nativeLanguages }, { wantToLearn }),
  };
}

test('POST /api/match/queue：入队回 queueEntryId + joinedAt，队列行挂在自己的账号上', async () => {
  const ui = await startTestServer();
  try {
    const session = await ui.signInAs('learner', { deviceId: 'device-a' });
    assert.equal(ui.db.count('queue'), 0, '入队前队列是空的——出厂没有编出来的人');

    const res = await ui.request('POST', '/api/match/queue', { token: session.token, body: {} });
    assert.equal(res.status, 200, '入队是「更新了状态」，按契约回 200（201 留给成房/发申请）');
    assert.equal(res.json.ok, true);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['joinedAt', 'queueEntryId']);
    assert.ok(!Number.isNaN(Date.parse(res.json.data.joinedAt)), 'joinedAt 是 ISO 时间');

    const peerId = ui.db.getProfile(session.userId, 'learner').userId;
    assert.equal(res.json.data.queueEntryId, 'q-' + peerId);
    const row = ui.db.findQueueRow(peerId);
    assert.equal(row.ownerAccountId, session.userId, '这一行属于入队的那台设备');
    assert.equal(row.claimedRoomId, null);
    assert.equal(ui.db.count('queue'), 1, '只多出这一行');
  } finally {
    await ui.close();
  }
});

test('POST /api/match/queue：重复入队 409 already_queued；同一个 requestId 则按幂等回放', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');

    // 带 requestId 的第一次入队：正常成功，并把这把键的结果记下来
    const first = await ui.request('POST', '/api/match/queue', { token, body: { requestId: 'join-1' } });
    assert.equal(first.status, 200);

    // 同一个 requestId 再打一次（弱网重试）：回放第一次的结果，而不是把 409 抛回给用户
    const replay = await ui.request('POST', '/api/match/queue', { token, body: { requestId: 'join-1' } });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json, first.json, '回放要逐字节一致');

    // 换一把新键＝真的「再排一次队」，这才是 409 already_queued
    const again = await ui.request('POST', '/api/match/queue', { token, body: {} });
    assert.equal(again.status, 409);
    assert.equal(again.json.ok, false);
    assert.equal(again.json.error.code, 'already_queued', '前端拿到它就当「直接进等待面板」');
  } finally {
    await ui.close();
  }
});

test('DELETE /api/match/queue：退自己那一行；没排过 410 queue_expired；取消后能重新入队', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const peerId = ui.db.getProfile(ui.accountIdOf(), 'learner').userId;

    await ui.request('POST', '/api/match/queue', { token, body: {} });
    assert.equal(ui.db.count('queue'), 1);

    const cancel = await ui.request('DELETE', '/api/match/queue', { token });
    assert.equal(cancel.status, 200);
    assert.deepEqual(cancel.json.data, { ok: true, invalidatedRequests: 0 });
    assert.equal(ui.db.count('queue'), 0, '只退自己那一行');
    assert.equal(ui.db.findQueueRow(peerId), null);

    // 没排过（或已经取消过）再取消：410，让前端提示「你的等待已过期」而不是弹红页
    const again = await ui.request('DELETE', '/api/match/queue', { token });
    assert.equal(again.status, 410);
    assert.equal(again.json.error.code, 'queue_expired');

    // 取消之后重新入队要能成功（取消是可逆的）
    const rejoin = await ui.request('POST', '/api/match/queue', { token, body: {} });
    assert.equal(rejoin.status, 200);
    assert.equal(ui.db.count('queue'), 1);
  } finally {
    await ui.close();
  }
});

test('取消等待不碰别人：只清自己那一行，别人的队列原样', async () => {
  const ui = await startTestServer();
  try {
    const waiting = await seedWaitingLearners(ui, LEARNER_SPECS.slice(0, 3));
    assert.equal(ui.db.count('queue'), 3);

    const mine = await ui.signInAs('learner', { deviceId: 'device-me' });
    await ui.request('POST', '/api/match/queue', { token: mine.token, body: {} });
    assert.equal(ui.db.count('queue'), 4);

    await ui.request('DELETE', '/api/match/queue', { token: mine.token });
    assert.deepEqual(
      ui.db.listQueue({ role: 'learner' }).map((row) => row.userId).sort(),
      waiting.map((item) => item.peerId).sort(),
      '一次「取消匹配」不该把别人也清掉',
    );
  } finally {
    await ui.close();
  }
});

test('取消等待要连坐：还没接受的匹配请求被作废，随后 accept 拿 410', async () => {
  const ui = await startTestServer();
  try {
    // 演示口子按「相反身份」找人配：学习者要配一位有空的母语者，所以先造一个真的
    await seedWaitingBuddies(ui, [BUDDY_SPECS[0]]);

    const token = await ui.signIn('learner');
    await ui.request('POST', '/api/match/queue', { token, body: {} });

    const created = await ui.request('POST', '/api/dev/match-request', { token, body: {} });
    assert.equal(created.status, 201, '演示口子：造一条待接受的请求（契约外，见 README）');
    const { requestId } = created.json.data;
    assert.equal(ui.db.getMatchRequest(requestId).status, 'pending');

    const cancel = await ui.request('DELETE', '/api/match/queue', { token });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json.data.invalidatedRequests, 1, '同一次动作里作废掉它，别让对面干等到倒计时结束');
    assert.equal(ui.db.getMatchRequest(requestId).status, 'invalidated');

    const accept = await ui.request('POST', `/api/match/requests/${requestId}/accept`, { token, body: {} });
    assert.equal(accept.status, 410, '作废之后再接受：410 match_request_expired');
    assert.equal(accept.json.error.code, 'match_request_expired');
  } finally {
    await ui.close();
  }
});

test('GET /api/match/queue（母语者视角）：列出真实在等的人，匿名行不下发名字', async () => {
  const ui = await startTestServer();
  try {
    const waiting = await seedWaitingLearners(ui);
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });

    const res = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data), ['entries']);

    const entries = res.json.data.entries;
    assert.deepEqual(entries.map((entry) => entry.peerId).sort(), waiting.map((item) => item.peerId).sort(), '在等的人一个不少');
    assert.ok(entries.every((entry) => entry.role === 'learner'), '这个口子给的是学习者');
    assert.ok(entries.every((entry) => entry.intent === 'learn'), '教 / 学标签由身份派生');

    for (const entry of entries) {
      const spec = waiting.find((item) => item.peerId === entry.peerId);
      if (spec.anonymous) {
        assert.equal(entry.anonymous, true);
        assert.equal(entry.displayName, null, '匿名行不给名字：文案由前端语言包兜底');
      } else {
        assert.equal(entry.anonymous, false);
        assert.ok(entry.displayName, '非匿名行至少要能显示一个称呼');
      }
      // 契约 4.4：匹配度与共同标签由服务端算好下发
      assert.equal(typeof entry.matchScore, 'number');
      assert.ok(Array.isArray(entry.matchedTags));
      assert.equal(typeof entry.complement, 'boolean');
      assert.ok('complementLanguage' in entry);
      assert.deepEqual(entry.nativeLanguages, [spec.nativeLanguage].filter(Boolean));
    }

    // 被摘走的人要从列表里消失（成房与列表读的是同一个标记位）
    const lucas = waiting.find((item) => item.key === 'lucas');
    const room = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: lucas.peerId } });
    assert.equal(room.status, 201);
    const after = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    assert.equal(after.json.data.entries.some((entry) => entry.peerId === lucas.peerId), false);
    assert.equal(after.json.data.entries.length, entries.length - 1);
  } finally {
    await ui.close();
  }
});

test('列表不含自己：同一个账号用母语者视角看时，不会把自己排的队列列出来', async () => {
  const ui = await startTestServer();
  try {
    const me = await ui.signInAs('learner', { deviceId: 'device-me' });
    await ui.request('POST', '/api/match/queue', { token: me.token, body: {} });
    // 同一台设备切到母语者身份去看列表
    const asBuddy = await ui.signInAs('buddy', { deviceId: 'device-me' });
    assert.equal(asBuddy.userId, me.userId, '同一台设备换身份还是同一个账号');

    const res = await ui.request('GET', '/api/match/queue', { token: asBuddy.token });
    assert.deepEqual(res.json.data.entries, [], '自己不该出现在自己的列表里——点下去就是自己跟自己成房');
  } finally {
    await ui.close();
  }
});

test('GET /api/match/queue：按 matchRank 降序，分数与前端算法逐个相等', async () => {
  const ui = await startTestServer();
  try {
    const waiting = await seedWaitingLearners(ui);
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });
    const profile = await fillBuddyProfile(ui, buddy.token, { wantToLearn: ['mandarin'] });
    const myTags = [...profile.interests, ...profile.preferredTopics];

    const res = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    const entries = res.json.data.entries;

    const expected = waiting.map((item) => {
      const row = ui.db.findQueueRow(item.peerId);
      return expectedLearnerEntry({ row, myTags, wantToLearn: profile.wantToLearn });
    });

    assert.deepEqual(
      Object.fromEntries(entries.map((entry) => [entry.peerId, entry.matchScore])),
      Object.fromEntries(expected.map((entry) => [entry.peerId, entry.matchScore])),
      '每个人的匹配度都要和前端算的一样',
    );
    assert.deepEqual(
      entries.map((entry) => entry.peerId),
      [...expected].sort((a, b) => b.rank - a.rank).map((entry) => entry.peerId),
      '顺序＝matchRank 降序（同分保持入队顺序）',
    );

    // 互补（+8）能翻转挨得近的两位：普通话母语者正好命中回礼里的 mandarin
    const mandarin = waiting.find((item) => item.key === 'mandarin');
    const hit = entries.find((entry) => entry.peerId === mandarin.peerId);
    assert.equal(hit.complement, true);
    assert.equal(hit.complementLanguage, 'mandarin');
    const anonEnglish = waiting.find((item) => item.key === 'anon-english');
    assert.ok(
      entries.findIndex((entry) => entry.peerId === mandarin.peerId) <
        entries.findIndex((entry) => entry.peerId === anonEnglish.peerId),
      '加成把普通话母语者顶到了前面',
    );
  } finally {
    await ui.close();
  }
});

test('互补只加权不筛选：列表长度与成员集合都不变，只是顺序变了', async () => {
  const ui = await startTestServer();
  try {
    const waiting = await seedWaitingLearners(ui);
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });

    const before = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    const beforeIds = before.json.data.entries.map((entry) => entry.peerId).sort();
    assert.equal(before.json.data.entries.length, waiting.length);
    assert.ok(before.json.data.entries.every((entry) => entry.complement === false), '没填回礼 = 谁都不命中');

    await fillBuddyProfile(ui, buddy.token, { wantToLearn: ['mandarin'] });
    const after = await ui.request('GET', '/api/match/queue', { token: buddy.token });

    assert.equal(after.json.data.entries.length, before.json.data.entries.length, '一个候选都不能少');
    assert.deepEqual(after.json.data.entries.map((entry) => entry.peerId).sort(), beforeIds, '成员集合完全一致');
    assert.equal(after.json.data.entries.filter((entry) => entry.complement).length, 1, '只有普通话母语者命中');
  } finally {
    await ui.close();
  }
});

test('GET /api/match/queue：limit 与 interests 查询参数生效', async () => {
  const ui = await startTestServer();
  try {
    await seedWaitingLearners(ui);
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });
    await fillBuddyProfile(ui, buddy.token);

    const all = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    const limited = await ui.request('GET', '/api/match/queue?limit=2', { token: buddy.token });
    assert.equal(limited.json.data.entries.length, 2);
    assert.deepEqual(
      limited.json.data.entries.map((entry) => entry.peerId),
      all.json.data.entries.slice(0, 2).map((entry) => entry.peerId),
      'limit 是「取前 N 个」，不是重新排序',
    );

    // interests 覆盖看的人的标签：只按 anime 找，分数应当按 anime 现算
    const override = await ui.request('GET', '/api/match/queue?interests=anime', { token: buddy.token });
    for (const entry of override.json.data.entries) {
      const row = ui.db.findQueueRow(entry.peerId);
      const peerTags = [...row.interests, row.goal].filter(Boolean);
      assert.equal(entry.matchScore, matchScore(['anime'], peerTags), `${entry.peerId} 应当按 anime 现算`);
    }
  } finally {
    await ui.close();
  }
});

test('匹配相关的接口都要 Bearer：无令牌一律 401 not_authorized', async () => {
  const ui = await startTestServer();
  try {
    const calls = [
      ['POST', '/api/match/queue'],
      ['DELETE', '/api/match/queue'],
      ['GET', '/api/match/queue'],
      ['GET', '/api/match/recommendations'],
      ['PUT', '/api/match/criteria'],
      ['GET', '/api/match/candidates/u-nobody'],
      ['POST', '/api/match/requests/req-nope/accept'],
      ['POST', '/api/match/requests/req-nope/decline'],
      ['POST', '/api/rooms'],
      ['GET', '/api/rooms/r-nope'],
    ];
    for (const [method, path] of calls) {
      const res = await ui.request(method, path, { body: method === 'GET' || method === 'DELETE' ? undefined : {} });
      assert.equal(res.status, 401, `${method} ${path} 没令牌要 401`);
      assert.equal(res.json.error.code, 'not_authorized', `${method} ${path}`);
    }
  } finally {
    await ui.close();
  }
});

/**
 * Phase 2 · 房间与匹配请求（契约 4.4 / 4.5 节）：成房 / 接受 / 不接受 / 房间读取。
 *
 * 这个文件盯住三条硬要求：
 *   1. **成房必须原子**：`POST /api/rooms` 与 `accept` 都成房，同一个伙伴只能被摘走一次，
 *      第二位必须 409 `room_taken`——不能靠前端把列表项删掉来假装；
 *   2. **不接受 ≠ 退出匹配**：`decline` 之后人还在队列里，别人还能挑走他；
 *   3. **过期与作废走同一条 410**：倒计时到点 / 已被处理 / 不是自己的请求，都别让前端卡住。
 *
 * 「倒计时到点」用注入的 `now` 测：把时钟拨快，而不是真的等 5 秒。
 *
 * 候选人来自 `helpers/scenario.mjs` 造出来的真实设备，不是种子池。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ACCEPT_SECONDS } from '../src/domain/rooms.js';
import { seedBothSides, seedWaitingLearners } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

test('POST /api/rooms：母语者传 learnerId，第二次同一个人 409 room_taken', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedWaitingLearners(ui);
    const target = learners.find((item) => item.key === 'lucas');
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });

    const first = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: target.peerId } });
    assert.equal(first.status, 201, '成房是新建资源，按契约回 201');
    assert.deepEqual(Object.keys(first.json.data).sort(), ['expiresAt', 'peer', 'roomId']);
    assert.match(first.json.data.roomId, new RegExp('^r-' + target.peerId));
    assert.equal(first.json.data.peer.peerId, target.peerId);
    assert.equal(typeof first.json.data.peer.matchScore, 'number', '成房响应里的 peer 与列表里同一套字段');
    assert.equal(first.json.data.expiresAt, null, '房间不是请求：没有倒计时');

    const second = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: target.peerId } });
    assert.equal(second.status, 409);
    assert.equal(second.json.error.code, 'room_taken');

    // 被摘走之后从列表里消失，但预览页仍然打得开（见 matchCandidates 的用例）
    const list = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    assert.equal(list.json.data.entries.some((entry) => entry.peerId === target.peerId), false);
  } finally {
    await ui.close();
  }
});

test('POST /api/rooms：学习者在首页点「直接聊」传 buddyId，同样原子', async () => {
  const ui = await startTestServer();
  try {
    const { buddies } = await seedBothSides(ui);
    const target = buddies.find((item) => item.key === 'ka-ho');
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });

    const first = await ui.request('POST', '/api/rooms', { token: learner.token, body: { buddyId: target.peerId } });
    assert.equal(first.status, 201);
    assert.equal(first.json.data.peer.peerId, target.peerId);
    assert.equal(first.json.data.peer.intent, 'teach');

    const second = await ui.request('POST', '/api/rooms', { token: learner.token, body: { buddyId: target.peerId } });
    assert.equal(second.status, 409);
    assert.equal(second.json.error.code, 'room_taken');
  } finally {
    await ui.close();
  }
});

test('POST /api/rooms：两个 id 都没传 400，人不存在 404', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedWaitingLearners(ui);
    const target = learners[0];
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });

    const missing = await ui.request('POST', '/api/rooms', { token: buddy.token, body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, 'bad_request');

    const unknown = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: 'u-nobody' } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.error.code, 'not_found');

    const unknownKey = await ui.request('POST', '/api/rooms', {
      token: buddy.token,
      body: { learner: target.peerId },
    });
    assert.equal(unknownKey.status, 400, '字段名写错要当场发现');
  } finally {
    await ui.close();
  }
});

test('accept：成房 201，同一条请求第二次处理拿 410', async () => {
  const ui = await startTestServer();
  try {
    const { buddies } = await seedBothSides(ui);
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });

    const created = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
    assert.equal(created.status, 201);
    const { requestId, peer } = created.json.data;
    assert.ok(buddies.some((item) => item.peerId === peer.peerId), '匹配到的应当是真的在等的人');

    const accepted = await ui.request('POST', `/api/match/requests/${requestId}/accept`, {
      token: learner.token,
      body: {},
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(Object.keys(accepted.json.data).sort(), ['expiresAt', 'peer', 'roomId']);
    assert.equal(accepted.json.data.peer.peerId, peer.peerId);
    assert.equal(ui.db.getMatchRequest(requestId).status, 'accepted');
    assert.ok(ui.db.getRoom(accepted.json.data.roomId), '房间真的落库了');

    const again = await ui.request('POST', `/api/match/requests/${requestId}/accept`, {
      token: learner.token,
      body: {},
    });
    assert.equal(again.status, 410);
    assert.equal(again.json.error.code, 'match_request_expired', '已经处理过的请求不再有效');

    const unknown = await ui.request('POST', '/api/match/requests/req-nope/accept', { token: learner.token, body: {} });
    assert.equal(unknown.status, 410, '不认识的请求号同样走 410，前端只需一种兜底');
  } finally {
    await ui.close();
  }
});

test('accept：不是自己的请求 / 人已经离开队列，都拿 410', async () => {
  const ui = await startTestServer();
  try {
    const { buddies } = await seedBothSides(ui);
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });

    // 直接塞一条属于别人的请求：契约要求「不是自己的」按过期处理，不泄露它存在
    ui.db.createMatchRequest({
      requestId: 'req-someone-else',
      accountId: 'someone-else',
      role: 'learner',
      peerUserId: buddies[0].peerId,
      peerRole: 'buddy',
      roomId: 'r-x',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const foreign = await ui.request('POST', '/api/match/requests/req-someone-else/accept', {
      token: learner.token,
      body: {},
    });
    assert.equal(foreign.status, 410);

    // 人离开队列之后，手里那条请求也就没意义了
    const created = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
    assert.equal(created.status, 201);
    const { requestId, peer } = created.json.data;
    ui.db.removeQueueRow(peer.peerId);
    const gone = await ui.request('POST', `/api/match/requests/${requestId}/accept`, {
      token: learner.token,
      body: {},
    });
    assert.equal(gone.status, 410);
    assert.equal(gone.json.error.code, 'match_request_expired');
  } finally {
    await ui.close();
  }
});

test('成房原子：先被别人摘走之后，手里那条请求 accept 拿 409 room_taken', async () => {
  const ui = await startTestServer();
  try {
    const { buddies } = await seedBothSides(ui);
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });
    const other = await ui.signInAs('learner', { deviceId: 'device-other' });

    const created = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
    assert.equal(created.status, 201);
    const { requestId, peer } = created.json.data;
    assert.ok(buddies.some((item) => item.peerId === peer.peerId));

    // 另一个入口（另一位学习者直接挑人）先把这位摘走
    const taken = await ui.request('POST', '/api/rooms', { token: other.token, body: { buddyId: peer.peerId } });
    assert.equal(taken.status, 201);

    const accept = await ui.request('POST', `/api/match/requests/${requestId}/accept`, {
      token: learner.token,
      body: {},
    });
    assert.equal(accept.status, 409, '同一个人只能被摘走一次');
    assert.equal(accept.json.error.code, 'room_taken');
    assert.equal(ui.db.getMatchRequest(requestId).status, 'taken', '被抢走的请求也要落一个终态');
  } finally {
    await ui.close();
  }
});

test('decline：不接受 ≠ 退出匹配——人还在队列里，别人照样能摘走', async () => {
  const ui = await startTestServer();
  try {
    await seedBothSides(ui);
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });
    const other = await ui.signInAs('learner', { deviceId: 'device-other' });

    const created = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
    assert.equal(created.status, 201);
    const { requestId, peer } = created.json.data;

    const declined = await ui.request('POST', `/api/match/requests/${requestId}/decline`, {
      token: learner.token,
      body: { reason: 'demo' },
    });
    assert.equal(declined.status, 200);
    assert.deepEqual(declined.json.data, { ok: true });
    const request = ui.db.getMatchRequest(requestId);
    assert.equal(request.status, 'declined');
    assert.equal(request.reason, 'demo');

    // 队列行原封不动：还能被别人挑走
    const stillWaiting = ui.db.listQueue({ role: 'buddy', unclaimedOnly: true }).some((row) => row.userId === peer.peerId);
    assert.equal(stillWaiting, true, 'decline 绝不碰队列行');
    const claimed = await ui.request('POST', '/api/rooms', { token: other.token, body: { buddyId: peer.peerId } });
    assert.equal(claimed.status, 201, '拒绝过的人仍然是可匹配的');

    const again = await ui.request('POST', `/api/match/requests/${requestId}/decline`, { token: learner.token, body: {} });
    assert.equal(again.status, 410, '已经拒绝过的请求再拒一次也是 410');
  } finally {
    await ui.close();
  }
});

test('倒计时：到点之后再 accept 拿 410，请求落成 expired', async () => {
  let clock = Date.now();
  const ui = await startTestServer({ now: () => clock });
  try {
    await seedBothSides(ui);
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });
    const created = await ui.request('POST', '/api/dev/match-request', {
      token: learner.token,
      body: { acceptSeconds: 5 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.acceptSeconds, 5);
    assert.equal(Date.parse(created.json.data.expiresAt), clock + 5_000, 'expiresAt = 现在 + 倒计时');

    clock += 5_001;
    const late = await ui.request('POST', `/api/match/requests/${created.json.data.requestId}/accept`, {
      token: learner.token,
      body: {},
    });
    assert.equal(late.status, 410);
    assert.equal(late.json.error.code, 'match_request_expired');
    assert.equal(ui.db.getMatchRequest(created.json.data.requestId).status, 'expired');
  } finally {
    await ui.close();
  }
});

test('dev/match-request：倒计时上限/默认值有夹取；没有可匹配的人时 404', async () => {
  const ui = await startTestServer();
  try {
    const { buddies } = await seedBothSides(ui);
    const learner = await ui.signInAs('learner', { deviceId: 'device-learner' });

    const huge = await ui.request('POST', '/api/dev/match-request', {
      token: learner.token,
      body: { acceptSeconds: 999 },
    });
    assert.equal(huge.json.data.acceptSeconds, 60, '上限 60 秒：现场不至于挂着不管');
    const zero = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: { acceptSeconds: 0 } });
    assert.equal(zero.json.data.acceptSeconds, DEFAULT_ACCEPT_SECONDS, '非法值回默认值');
    const plain = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
    assert.equal(plain.json.data.acceptSeconds, DEFAULT_ACCEPT_SECONDS);

    // 把三位母语者都摘走：学习者这边就没有可匹配的人了
    for (const buddy of buddies) {
      await ui.request('POST', '/api/rooms', { token: learner.token, body: { buddyId: buddy.peerId } });
    }
    const empty = await ui.request('POST', '/api/dev/match-request', { token: learner.token, body: {} });
    assert.equal(empty.status, 404);
    assert.equal(empty.json.error.code, 'not_found');
  } finally {
    await ui.close();
  }
});

test('GET /api/rooms/:roomId：拿得到房间状态；房间不存在 404 room_gone', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedWaitingLearners(ui);
    const target = learners.find((item) => item.key === 'mandarin');
    const buddy = await ui.signInAs('buddy', { deviceId: 'device-buddy' });

    const created = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: target.peerId } });
    const { roomId } = created.json.data;

    const res = await ui.request('GET', `/api/rooms/${roomId}`, { token: buddy.token });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['peer', 'room', 'startedAt', 'status']);
    assert.equal(res.json.data.status, 'active');
    assert.equal(res.json.data.room.roomId, roomId);
    assert.equal(res.json.data.peer.peerId, target.peerId);
    assert.equal(res.json.data.startedAt, res.json.data.room.createdAt);

    const gone = await ui.request('GET', '/api/rooms/r-nope', { token: buddy.token });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, 'room_gone', '前端据此回匹配大厅 + 一次性提示');
  } finally {
    await ui.close();
  }
});

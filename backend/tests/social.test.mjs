/**
 * Phase 4 · 伙伴关系与沉淀（契约 4.6 / 4.7 节）。
 *
 * 出厂**没有任何预置关系**：没有伙伴、没有申请、没有历史、进度是 0。
 * 「收到的申请」由契约外的演示口子 `POST /api/dev/buddy-request` 现场造，
 * 或者干脆由另一台真实设备发起——两条路在下面都有覆盖。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANONYMOUS_LABEL } from '../src/data/leaderboard.js';
import { createProgress } from '../src/store/seed.js';
import { registerWithProfile, seedWaitingBuddies } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

async function withServer(run, options = {}) {
  const ui = await startTestServer(options);
  try {
    await run(ui);
  } finally {
    await ui.close();
  }
}

/** 造一位「对方」并把他的 userId 拿到手（发申请要发给一个真实在队列里的人）。 */
async function aPeer(ui, role = 'buddy', deviceId = 'device-peer') {
  const patch = role === 'buddy' ? { interests: ['movies'] } : { interests: ['anime'] };
  const person = await registerWithProfile(ui, role, deviceId, patch);
  await ui.request('POST', '/api/match/queue', { token: person.token, body: {} });
  return person;
}

test('Phase 4 所有接口：没有 Bearer 都统一 401 not_authorized', async () => {
  await withServer(async (ui) => {
    const calls = [
      ['GET', '/api/me/buddies'],
      ['DELETE', '/api/me/buddies/u-nobody'],
      ['GET', '/api/me/buddy-requests'],
      ['POST', '/api/me/buddy-requests'],
      ['POST', '/api/me/buddy-requests/u-nobody/accept'],
      ['POST', '/api/me/buddy-requests/u-nobody/decline'],
      ['DELETE', '/api/me/buddy-requests/u-nobody'],
      ['GET', '/api/me/progress'],
      ['GET', '/api/me/history'],
      ['GET', '/api/leaderboard'],
    ];
    for (const [method, path] of calls) {
      const res = await ui.request(method, path, { body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json.error.code, 'not_authorized');
    }
  });
});

test('出厂没有任何申请；direction/status 可过滤，坏取值 400', async () => {
  await withServer(async (ui) => {
    const token = await ui.signIn();
    const all = await ui.request('GET', '/api/me/buddy-requests', { token });
    assert.equal(all.status, 200);
    assert.deepEqual(all.json.data.requests, [], '出厂是空的：不该有编出来的「收到的申请」');

    const incoming = await ui.request('GET', '/api/me/buddy-requests?direction=incoming&status=pending', { token });
    assert.deepEqual(incoming.json.data.requests, []);
    const outgoing = await ui.request('GET', '/api/me/buddy-requests?direction=outgoing', { token });
    assert.deepEqual(outgoing.json.data.requests, []);

    const badDirection = await ui.request('GET', '/api/me/buddy-requests?direction=sideways', { token });
    assert.equal(badDirection.status, 400);
    assert.equal(badDirection.json.error.code, 'bad_request');
    const badStatus = await ui.request('GET', '/api/me/buddy-requests?status=declined', { token });
    assert.equal(badStatus.status, 400);
  });
});

test('接受收到的申请：申请直接移除、伙伴出现；重复 requestId 幂等回放', async () => {
  await withServer(async (ui) => {
    const peer = await aPeer(ui);
    const token = await ui.signIn();

    const incoming = await ui.request('POST', '/api/dev/buddy-request', {
      token,
      body: { peerId: peer.peerId, requestId: 'dev-incoming-setup' },
    });
    assert.equal(incoming.status, 201);

    const body = { requestId: 'accept-peer-1' };
    const first = await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/accept`, { token, body });
    assert.equal(first.status, 200);
    assert.equal(first.json.data.buddy.peerId, peer.peerId);
    assert.ok(first.json.data.buddy.label, '伙伴要有一个可显示的称呼');
    assert.equal(first.json.data.request, null);

    const replay = await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/accept`, { token, body });
    assert.deepEqual(replay.json, first.json, '同一个 requestId 回放第一次响应');

    const requests = await ui.request('GET', '/api/me/buddy-requests', { token });
    assert.deepEqual(requests.json.data.requests, []);
    const buddies = await ui.request('GET', '/api/me/buddies', { token });
    assert.equal(buddies.json.data.buddies.length, 1);
    assert.equal(buddies.json.data.buddies[0].peerId, peer.peerId);

    const secondAction = await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/accept`, {
      token,
      body: { requestId: 'accept-peer-2' },
    });
    assert.equal(secondAction.status, 404, '申请已经移除，换 requestId 再接受应为不存在');
  });
});

test('拒绝收到的申请：申请直接移除、不成为伙伴；不存在 404', async () => {
  await withServer(async (ui) => {
    const peer = await aPeer(ui);
    const token = await ui.signIn();
    const accountId = ui.accountIdOf();
    await ui.request('POST', '/api/dev/buddy-request', { token, body: { peerId: peer.peerId } });

    const declined = await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/decline`, {
      token,
      body: { requestId: 'decline-peer' },
    });
    assert.equal(declined.status, 200);
    assert.deepEqual(declined.json.data, { ok: true });
    assert.deepEqual(ui.db.getRelations(accountId).buddyRequests, []);
    assert.deepEqual(ui.db.getRelations(accountId).buddies, []);

    const missing = await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/decline`, {
      token,
      body: { requestId: 'decline-peer-again' },
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not_found');
  });
});

test('发出申请：pending、重复提交幂等、撤回后移除；未知人/坏字段 404/400', async () => {
  await withServer(async (ui) => {
    const peer = await aPeer(ui);
    const token = await ui.signIn();
    const accountId = ui.accountIdOf();

    const first = await ui.request('POST', '/api/me/buddy-requests', {
      token,
      body: { peerId: peer.peerId, roomId: 'r-social-1', requestId: 'send-peer-1' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.data.status, 'pending');
    assert.equal(first.json.data.request.direction, 'outgoing');
    assert.equal(first.json.data.request.roomId, 'r-social-1');

    const repeated = await ui.request('POST', '/api/me/buddy-requests', {
      token,
      body: { peerId: peer.peerId, roomId: 'r-other', requestId: 'send-peer-2' },
    });
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.json.data.request, first.json.data.request);
    assert.equal(ui.db.listBuddyRequests(accountId, { direction: 'outgoing' }).length, 1);

    const cancelled = await ui.request('DELETE', `/api/me/buddy-requests/${peer.peerId}`, {
      token,
      body: { requestId: 'cancel-peer' },
    });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(ui.db.listBuddyRequests(accountId, { direction: 'outgoing' }), []);

    const missing = await ui.request('DELETE', `/api/me/buddy-requests/${peer.peerId}`, {
      token,
      body: { requestId: 'cancel-peer-again' },
    });
    assert.equal(missing.status, 404);

    const unknown = await ui.request('POST', '/api/me/buddy-requests', {
      token,
      body: { peerId: 'u-nobody', requestId: 'send-nobody' },
    });
    assert.equal(unknown.status, 404);
    const bad = await ui.request('POST', '/api/me/buddy-requests', {
      token,
      body: { peerId: peer.peerId, surprise: true },
    });
    assert.equal(bad.status, 400);
  });
});

test('双向申请自动成伙伴；已经是伙伴再发返回 200 status=buddy', async () => {
  await withServer(async (ui) => {
    const peer = await aPeer(ui);
    const token = await ui.signIn();
    const accountId = ui.accountIdOf();

    // 先造一条「对方发给我」的 incoming，我再向他发起 = 双方都同意
    await ui.request('POST', '/api/dev/buddy-request', { token, body: { peerId: peer.peerId } });
    const mutual = await ui.request('POST', '/api/me/buddy-requests', {
      token,
      body: { peerId: peer.peerId, requestId: 'mutual-peer' },
    });
    assert.equal(mutual.status, 200);
    assert.deepEqual(mutual.json.data, { request: null, status: 'accepted' });
    assert.equal(ui.db.listBuddies(accountId).length, 1);
    assert.deepEqual(ui.db.listBuddyRequests(accountId), []);

    const already = await ui.request('POST', '/api/me/buddy-requests', {
      token,
      body: { peerId: peer.peerId, requestId: 'already-peer' },
    });
    assert.equal(already.status, 200);
    assert.deepEqual(already.json.data, { request: null, status: 'buddy' });
    assert.equal(ui.db.listBuddies(accountId).length, 1, '幂等：不重复写伙伴');
  });
});

test('解除伙伴只删关系，历史与进度保留；不存在 404', async () => {
  await withServer(async (ui) => {
    const peer = await aPeer(ui);
    const token = await ui.signIn();
    const accountId = ui.accountIdOf();
    await ui.request('POST', '/api/dev/buddy-request', { token, body: { peerId: peer.peerId } });
    await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/accept`, {
      token,
      body: { requestId: 'accept-remove-test' },
    });
    ui.db.appendHistory(accountId, {
      sessionId: 's-keep', peerId: peer.peerId, peerLabel: peer.peerId, role: 'learner',
      startedAt: '2026-09-29T08:00:00.000Z', durationSec: 600, cardsUsed: 2, topics: ['food'],
    });
    const progressBefore = ui.db.getProgress(accountId);

    const removed = await ui.request('DELETE', `/api/me/buddies/${peer.peerId}`, {
      token,
      body: { requestId: 'remove-peer' },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(ui.db.listBuddies(accountId), []);
    assert.equal(ui.db.listHistory(accountId).length, 1);
    assert.deepEqual(ui.db.getProgress(accountId), progressBefore);

    const missing = await ui.request('DELETE', `/api/me/buddies/${peer.peerId}`, {
      token,
      body: { requestId: 'remove-peer-again' },
    });
    assert.equal(missing.status, 404);
  });
});

test('GET /api/me/progress：扁平全量、当前身份成就、buddyLevel 服务端计算', async () => {
  await withServer(async (ui) => {
    const session = await ui.signInAs('learner');
    const learner = await ui.request('GET', '/api/me/progress', { token: session.token });
    assert.equal(learner.status, 200);
    assert.equal(learner.json.data.xp, 0, '出厂进度是 0：没有演示账号垫底');
    assert.equal(learner.json.data.buddyLevel, 'newcomer', '刚注册的人还没帮过谁：从最低一级开始');
    assert.deepEqual(learner.json.data.achievements, [], '没练过就没有成就');
    assert.equal(Object.hasOwn(learner.json.data, 'topicsSeen'), false, '契约响应不下发内部 topicsSeen');

    // 攒够一场：成就跟着出来（同一台设备换身份，进度是账号级的）
    ui.db.updateProgress(session.userId, { ...createProgress(), xp: 360, totalMinutes: 46, conversations: 2, distinctTopics: 6 });
    const after = await ui.request('GET', '/api/me/progress', { token: session.token });
    assert.deepEqual(after.json.data.achievements.sort(), [
      'cantonese_explorer', 'culture_explorer', 'first_conversation',
    ]);
    assert.equal(after.json.data.buddyLevel, 'helper');
  });
});

test('GET /api/me/history：全量、buddyOnly、limit 与坏 limit', async () => {
  await withServer(async (ui) => {
    const peer = await aPeer(ui);
    const token = await ui.signIn();
    const accountId = ui.accountIdOf();
    ui.db.appendHistory(accountId, {
      sessionId: 's-other', peerId: 'u-other', peerLabel: 'u-other', role: 'learner',
      startedAt: '2026-09-28T08:00:00.000Z', durationSec: 300, cardsUsed: 1, topics: [],
    });
    ui.db.appendHistory(accountId, {
      sessionId: 's-buddy', peerId: peer.peerId, peerLabel: peer.peerId, role: 'learner',
      startedAt: '2026-09-29T08:00:00.000Z', durationSec: 600, cardsUsed: 2, topics: ['food'],
    });
    await ui.request('POST', '/api/dev/buddy-request', { token, body: { peerId: peer.peerId } });
    await ui.request('POST', `/api/me/buddy-requests/${peer.peerId}/accept`, {
      token,
      body: { requestId: 'accept-history' },
    });

    const all = await ui.request('GET', '/api/me/history', { token });
    assert.equal(all.status, 200);
    assert.deepEqual(all.json.data.entries.map((item) => item.sessionId), ['s-buddy', 's-other']);
    const buddyOnly = await ui.request('GET', '/api/me/history?buddyOnly=true', { token });
    assert.deepEqual(buddyOnly.json.data.entries.map((item) => item.sessionId), ['s-buddy']);
    const limited = await ui.request('GET', '/api/me/history?limit=1', { token });
    assert.equal(limited.json.data.entries.length, 1);
    const bad = await ui.request('GET', '/api/me/history?limit=nope', { token });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'bad_request');
  });
});

test('GET /api/leaderboard：榜上只有真实账号，名次连续，匿名连 userId 都裁剪', async () => {
  await withServer(async (ui) => {
    const me = await ui.signInAs('learner', { deviceId: 'device-a' });
    const other = await ui.signInAs('learner', { deviceId: 'device-b' });
    ui.db.updateProgress(me.userId, { ...createProgress(), xp: 9999, practiceMinutesThisWeek: 321, totalMinutes: 654 });
    ui.db.updateProgress(other.userId, { totalMinutes: 6 });
    ui.db.updateSettings(me.userId, { anonymous: true });

    for (const period of ['weekly', 'monthly']) {
      for (const role of ['learner', 'buddy']) {
        const res = await ui.request('GET', `/api/leaderboard?period=${period}&role=${role}`, { token: me.token });
        assert.equal(res.status, 200, `${period}/${role}`);
        assert.equal(res.json.data.entries.length, 2, '只有这两个真实账号，没有编出来的人');
        assert.deepEqual(res.json.data.entries.map((item) => item.rank), [1, 2]);
        const mine = res.json.data.entries.find((item) => item.isMe);
        assert.equal(mine.rank, 1, '实时 xp 最高，排名应重算到第一');
        assert.equal(mine.xp, 9999);
        assert.equal(mine.userId, ANONYMOUS_LABEL);
        for (const entry of res.json.data.entries.filter((item) => item.anonymous)) {
          assert.equal(entry.userId, ANONYMOUS_LABEL, '匿名行不得泄漏原 userId');
        }
      }
    }

    // 另一位没开匿名：榜上显示的是可读的称呼，而不是内部 id
    const publicView = await ui.request('GET', '/api/leaderboard?role=learner', { token: other.token });
    const otherRow = publicView.json.data.entries.find((item) => item.userId !== ANONYMOUS_LABEL);
    assert.equal(otherRow.userId, ui.db.getUser(other.userId).displayName, '非匿名行给可读称呼');

    const badPeriod = await ui.request('GET', '/api/leaderboard?period=daily', { token: me.token });
    assert.equal(badPeriod.status, 400);
    const badRole = await ui.request('GET', '/api/leaderboard?role=admin', { token: me.token });
    assert.equal(badRole.status, 400);
  });
});

test('POST /api/dev/buddy-request：可造收到的申请，同一人重复调用不重复写', async () => {
  await withServer(async (ui) => {
    const buddies = await seedWaitingBuddies(ui);
    const token = await ui.signIn();
    const accountId = ui.accountIdOf();
    const target = buddies[0];

    const first = await ui.request('POST', '/api/dev/buddy-request', {
      token,
      body: { peerId: target.peerId, requestId: 'dev-incoming-1' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.data.request.direction, 'incoming');
    const repeated = await ui.request('POST', '/api/dev/buddy-request', {
      token,
      body: { peerId: target.peerId, requestId: 'dev-incoming-2' },
    });
    assert.equal(repeated.status, 200);
    assert.equal(
      ui.db.listBuddyRequests(accountId).filter((item) => item.peerId === target.peerId).length,
      1,
    );
  });
});

test('两台设备互相发申请：对方的申请是真的从另一台设备来的', async () => {
  await withServer(async (ui) => {
    const a = await ui.signInAs('learner', { deviceId: 'device-a' });
    const b = await ui.signInAs('buddy', { deviceId: 'device-b' });
    // 两个人都在队列里，才发得出申请（服务端只允许发给真实存在的人）
    await ui.request('POST', '/api/match/queue', { token: a.token, body: {} });
    await ui.request('POST', '/api/match/queue', { token: b.token, body: {} });

    const aPeerId = ui.db.getProfile(a.userId, 'learner').userId;
    const bPeerId = ui.db.getProfile(b.userId, 'buddy').userId;

    // B 向 A 发申请 → 两边各留一行：B 那边是「我发出的」，A 那边是「收到的」
    const sent = await ui.request('POST', '/api/me/buddy-requests', {
      token: b.token,
      body: { peerId: aPeerId, requestId: 'cross-1' },
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.json.data.request.direction, 'outgoing');
    const mirrored = ui.db.listBuddyRequests(a.userId);
    assert.equal(mirrored.length, 1, '申请要真的落到对面那张表里，否则 A 永远点不了接受');
    assert.equal(mirrored[0].direction, 'incoming');
    assert.equal(mirrored[0].peerId, bPeerId, '镜像行的 peerId 是「发申请的人」');

    // A 也向 B 发 → 双方都申请过 = 自动成为伙伴
    const back = await ui.request('POST', '/api/me/buddy-requests', {
      token: a.token,
      body: { peerId: bPeerId, requestId: 'cross-2' },
    });
    assert.equal(back.status, 200);
    assert.equal(back.json.data.status, 'accepted');
    assert.deepEqual(ui.db.listBuddyRequests(a.userId), [], '确认之后两边的申请都收掉');
    assert.deepEqual(ui.db.listBuddyRequests(b.userId), [], '对面那条「我发出的」也要一起收掉');
    assert.equal(ui.db.listBuddies(a.userId).length, 1);
    assert.equal(ui.db.listBuddies(b.userId).length, 1, '互相确认是两边同时成伙伴');
  });
});

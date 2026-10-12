/**
 * httpApi：40 个方法与 mock 同名同参，真接口走 HTTP、未实现的降级到 mock，
 * 并且**写成功之后照旧同步 store**（页面代码一行都不用改）。
 *
 * 全程不联网：假 fetch 回放后端真实响应片段。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoryStorage, createStore } from '../../src/app/store.js';
import { BACKEND_PORT, resolveApiOptions, resolveSignalMode } from '../../src/services/index.js';
import { ApiError, createMockApi } from '../../src/services/mockApi.js';
import { FALLBACK_METHODS, HTTP_METHODS, createHttpApi, toProfileFields } from '../../src/services/httpApi.js';
import { createFetchStub, fail, ok, routeTable } from '../helpers/http-stub.mjs';

const BASE = 'http://localhost:8787';

/**
 * 取出请求体里除 `requestId` 之外的部分，并顺手断言幂等键确实带上了。
 * 写接口的 `requestId` 由 http.js 自动生成，所以断言请求体时要把它排除掉。
 */
function bodyOf(call) {
  const { requestId, ...rest } = call.body ?? {};
  assert.ok(typeof requestId === 'string' && requestId.length > 0, '写请求必须自动带 requestId');
  return rest;
}

function setup({ routes = {}, role = 'learner' } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  store.saveSettings({ mockDelayMs: 0 }); // 降级到 mock 时不要人为延迟，否则用例会等 400ms
  if (role) store.setRole(role);
  const fallback = createMockApi({ store, sleep: () => Promise.resolve() });
  const fetchImpl = createFetchStub(routeTable(routes));
  const api = createHttpApi({ baseUrl: BASE, store, fallback, fetchImpl });
  return { store, api, fetchImpl, fallback };
}

test('档位开关：默认走真后端，?api=mock 才是纯 mock；后端地址与信令地址都默认同源', () => {
  // 默认档位是真后端：mock 自带的假人没有设备在对面等着，两台真设备会互相看不见
  assert.deepEqual(resolveApiOptions('', 'localhost'), {
    useMock: false,
    baseUrl: '',
    signalUrl: 'ws://localhost/ws',
  });
  // 想在没有后端时看界面，显式加 ?api=mock
  assert.deepEqual(resolveApiOptions('?api=mock', 'localhost'), {
    useMock: true,
    baseUrl: '',
    signalUrl: 'ws://localhost/ws',
  });
  // ?api=http 与不带参数等价：保留给既有文档、脚本与书签
  assert.deepEqual(resolveApiOptions('?api=http', 'localhost'), {
    useMock: false,
    baseUrl: '',
    signalUrl: 'ws://localhost/ws',
  });
  // 默认同源：https 页面才不会撞 mixed content（手机开麦克风的前提），信令同时升到 wss
  assert.deepEqual(resolveApiOptions('', '192.168.1.5', { protocol: 'https:' }), {
    useMock: false,
    baseUrl: '',
    signalUrl: 'wss://192.168.1.5/ws',
  });
  // location.host 带端口：同源信令必须跟着带上，否则会连到 80 端口
  assert.deepEqual(resolveApiOptions('', '192.168.1.5', { protocol: 'https:', host: '192.168.1.5:4173' }), {
    useMock: false,
    baseUrl: '',
    signalUrl: 'wss://192.168.1.5:4173/ws',
  });

  // 退路一：&direct 按当前主机名直连后端（没走 serve.mjs 反代时用）；信令跟着换协议与端口
  assert.deepEqual(resolveApiOptions('&direct', '192.168.1.5'), {
    useMock: false,
    baseUrl: `http://192.168.1.5:${BACKEND_PORT}`,
    signalUrl: `ws://192.168.1.5:${BACKEND_PORT}/ws`,
  });
  assert.deepEqual(resolveApiOptions('&direct', '192.168.1.5', { protocol: 'https:' }), {
    useMock: false,
    baseUrl: `https://192.168.1.5:${BACKEND_PORT}`,
    signalUrl: `wss://192.168.1.5:${BACKEND_PORT}/ws`,
  });

  // 退路二：&backend 指到任意后端，结尾斜杠会被吃掉
  assert.deepEqual(resolveApiOptions('?backend=http://10.0.0.2:9999/', 'localhost'), {
    useMock: false,
    baseUrl: 'http://10.0.0.2:9999',
    signalUrl: 'ws://10.0.0.2:9999/ws',
  });

  // 退路三：&signal 单独把信令指走（REST 仍走同源），结尾斜杠同样会被吃掉
  assert.deepEqual(resolveApiOptions('?signal=wss://signal.example.com/ws/', 'localhost'), {
    useMock: false,
    baseUrl: '',
    signalUrl: 'wss://signal.example.com/ws',
  });

  assert.equal(BACKEND_PORT, 8787, '端口与 backend/README.md 的约定一致');
});

test('通话档位默认值：真后端档位把出厂的 sim 升到 remote，mock 档位原样保留', () => {
  // 出厂值 + 真后端 → 升到远端信令。两台设备都不用手动去 /dev/mock 切，
  // 这是「两台真机能听到对方声音」这条演示路径上最容易漏掉的一步。
  assert.equal(resolveSignalMode('sim', { useMock: false }), 'remote');
  // 纯 mock 档位没有后端，remote 连不上，必须保留 sim
  assert.equal(resolveSignalMode('sim', { useMock: true }), 'sim');
  assert.equal(resolveSignalMode('sim'), 'sim', '不传 useMock 时按 mock 处理（安全默认）');

  // 用户主动选过的档位一律尊重，不被默认值覆盖
  for (const useMock of [true, false]) {
    assert.equal(resolveSignalMode('local', { useMock }), 'local');
    assert.equal(resolveSignalMode('remote', { useMock }), 'remote');
  }
});

test('方法名同构：httpApi 与 mockApi 的键集合完全一致（40 个）', () => {
  const store = createStore({ storage: createMemoryStorage() });
  const mock = createMockApi({ store });
  const http = createHttpApi({ baseUrl: BASE, store, fallback: mock, fetchImpl: createFetchStub(() => ok({})) });

  assert.deepEqual(Object.keys(http).sort(), Object.keys(mock).sort());
  assert.equal(Object.keys(mock).length, 40, '契约钉住的 mock 方法数是 40');
  assert.equal(HTTP_METHODS.length + FALLBACK_METHODS.length, 40, '两半加起来必须正好 40');
  assert.deepEqual(
    [...HTTP_METHODS, ...FALLBACK_METHODS].sort(),
    Object.keys(mock).sort(),
    '走 HTTP 的和降级的加起来 = 全部方法，既不漏也不重',
  );
});

test('toProfileFields：请求侧只送服务端认识的资料字段', () => {
  assert.deepEqual(
    toProfileFields('learner', {
      userId: 'learner-demo-01',
      onboarded: true,
      nativeLanguage: 'english',
      cantoneseLevel: 'beginner',
      learningGoal: 'daily_conversation',
      identity: 'exchange_student',
      interests: ['anime'],
      preferredTopics: ['hong_kong_food'],
    }),
    {
      nativeLanguage: 'english',
      cantoneseLevel: 'beginner',
      learningGoal: 'daily_conversation',
      identity: 'exchange_student',
      interests: ['anime'],
    },
  );
  assert.deepEqual(
    toProfileFields('buddy', { userId: 'x', languagesSpoken: ['yue'], identity: null, wantToLearn: ['english'], interests: [] }),
    { languagesSpoken: ['yue'], identity: null, wantToLearn: ['english'], interests: [] },
  );
});

test('signIn：POST /api/auth/session（不带令牌）→ 存令牌 + 切身份', async () => {
  const { store, api, fetchImpl } = setup({
    routes: { 'POST /api/auth/session': ok({ token: 't-1', expiresAt: '2026-09-29T18:00:00.000Z', userId: 'demo-01', role: 'buddy' }) },
    role: null,
  });
  const result = await api.signIn('buddy');

  const call = fetchImpl.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, BASE + '/api/auth/session');
  assert.equal(call.body.role, 'buddy');
  // **必须带 deviceId**：它是账号的钥匙，服务端按它决定「复用还是新建账号」。
  // 漏了它，两台设备会被当成同一个人——「两台设备连不上」的根因就是这个。
  assert.equal(call.body.deviceId, store.deviceId(), '登录要带上本机设备 id');
  assert.equal(call.headers.authorization, undefined, '登录时还没有令牌');
  assert.equal(result.userId, 'demo-01');
  assert.equal(result.role, 'buddy');
  assert.equal(store.getState().role, 'buddy', '身份要跟着切');
});

test('signOut：先让服务端作废会话、再清本地令牌（顺序反了服务端只会回 401）', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'POST /api/auth/session': ok({ token: 't-1', expiresAt: '2026-09-29T18:00:00.000Z', userId: 'demo-01', role: 'learner' }),
      'POST /api/auth/logout': ok({ ok: true }),
      'GET /api/tags': ok({ kinds: [] }),
    },
  });
  await api.signIn('learner');
  await api.signOut();

  const logout = fetchImpl.calls.find((call) => call.url === BASE + '/api/auth/logout');
  assert.ok(logout, '退出必须真的打到 /api/auth/logout，而不是只清本地');
  assert.equal(logout.method, 'POST');
  assert.equal(logout.headers.authorization, 'Bearer t-1', '清令牌之前必须带着它去请求，否则服务端认不出这条会话');
  assert.ok(typeof logout.body.requestId === 'string', '写请求自动带幂等键');

  // 退出之后令牌必须已经清掉：下一个请求不该再带 Authorization
  await api.getTags();
  assert.equal(fetchImpl.calls[fetchImpl.calls.length - 1].headers.authorization, undefined, '退出之后不该再攥着旧令牌');
});

test('signOut：请求失败也照样清本地令牌（否则会一直攥着一个死令牌）', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'POST /api/auth/session': ok({ token: 't-1', expiresAt: '2026-09-29T18:00:00.000Z', userId: 'demo-01', role: 'learner' }),
      'POST /api/auth/logout': fail('internal', 'backend down', { status: 500 }),
      'GET /api/tags': ok({ kinds: [] }),
    },
  });
  await api.signIn('learner');
  // 失败照常往上抛（由 app/session.js 决定吞掉），但本地令牌必须已经在 finally 里清干净
  await assert.rejects(() => api.signOut(), '服务端出错时 signOut 不该假装成功');

  await api.getTags();
  assert.equal(fetchImpl.calls[fetchImpl.calls.length - 1].headers.authorization, undefined, '服务端不认账也要把本地令牌清干净');
});

test('getMe：返回三件套，并把服务端资料灌回本地 store（但不推进 onboarded）', async () => {
  const { store, api } = setup({
    routes: {
      'GET /api/me': ok({
        userId: 'demo-01',
        learnerProfile: { userId: 'learner-demo-01', nativeLanguage: 'english', interests: ['anime'], onboarded: false },
        buddyProfile: { userId: 'buddy-demo-01', languagesSpoken: [], onboarded: false },
        settings: { interfaceLanguage: 'zh-Hant', anonymous: false, visibility: { interests: false, level: true, identity: true }, leaderboardVisible: true },
        progress: { xp: 360 },
      }),
    },
  });
  const me = await api.getMe();

  assert.deepEqual(Object.keys(me).sort(), ['buddyProfile', 'learnerProfile', 'settings']);
  const state = store.getState();
  assert.equal(state.learnerProfile.nativeLanguage, 'english', '资料要灌进 store（「我的」页读的是 store）');
  assert.deepEqual(state.learnerProfile.interests, ['anime']);
  assert.equal(state.settings.anonymous, false);
  assert.equal(state.settings.interfaceLanguage, 'zh-Hant');
  assert.equal(state.settings.visibility.interests, false);
  assert.equal(state.learnerProfile.onboarded, false, '同步资料不该把没走完注册的人标成已填完');
  assert.equal(state.settings.mockDelayMs, 0, '前端本地偏好不能被服务端响应清掉');
});

test('saveLearnerProfile / saveBuddyProfile / saveSettings：解包 + 回写 store + 请求侧过滤', async () => {
  const { store, api, fetchImpl } = setup({
    routes: {
      'PUT /api/me/profile/learner': ok({ learnerProfile: { userId: 'learner-demo-01', nativeLanguage: 'mandarin', interests: ['food'] } }),
      'PUT /api/me/profile/buddy': ok({ buddyProfile: { userId: 'buddy-demo-01', wantToLearn: ['english'] } }),
      'PUT /api/me/settings': ok({ settings: { anonymous: false, interfaceLanguage: 'en' } }),
    },
  });

  const learner = await api.saveLearnerProfile({ userId: 'learner-demo-01', onboarded: true, nativeLanguage: 'mandarin', interests: ['food'] });
  assert.equal(learner.nativeLanguage, 'mandarin', '返回的是资料本身（与 mock 同形状）');
  assert.deepEqual(bodyOf(fetchImpl.calls[0]), { nativeLanguage: 'mandarin', interests: ['food'] }, '本地字段不进请求体');
  assert.equal(store.getState().learnerProfile.nativeLanguage, 'mandarin');

  await api.saveBuddyProfile({ userId: 'buddy-demo-01', wantToLearn: ['english'] });
  assert.deepEqual(store.getState().buddyProfile.wantToLearn, ['english']);

  await api.saveSettings({ locale: 'en', anonymous: false, theme: 'warm' });
  assert.deepEqual(bodyOf(fetchImpl.calls[2]), { anonymous: false, interfaceLanguage: 'en' }, 'theme 这类本地偏好不发上去');
  assert.equal(store.getState().settings.anonymous, false);
  assert.equal(store.getState().settings.theme, 'mint', '本地主题不该被服务端响应覆盖成 undefined');
});

test('getTags：直接透传六张公开词表', async () => {
  const tags = { identities: ['a'], interests: ['b'], goals: ['c'], buddyTopics: ['d'], levels: ['e'], nativeLanguages: ['f'] };
  const { api } = setup({ routes: { 'GET /api/tags': ok(tags) } });
  assert.deepEqual(await api.getTags(), tags);
});

test('joinQueue：成功入队；409 already_queued 也当成功（契约 4.4）', async () => {
  const store = createStore({ storage: createMemoryStorage() });
  store.saveSettings({ mockDelayMs: 0 });
  const fallback = createMockApi({ store, sleep: () => Promise.resolve() });

  const first = createFetchStub(routeTable({ 'POST /api/match/queue': ok({ queueEntryId: 'q-1', joinedAt: '2026-09-29T06:00:00.000Z' }) }));
  const api = createHttpApi({ baseUrl: BASE, store, fallback, fetchImpl: first });
  const entry = await api.joinQueue();
  assert.equal(entry.queueEntryId, 'q-1');
  assert.equal(entry.joinedAt, Date.parse('2026-09-29T06:00:00.000Z'), 'joinedAt 转成毫秒（与 mock 同口径）');
  assert.notEqual(store.getState().runtime.queue, null, '入队要同步 store，页面才知道自己在等');

  const already = createHttpApi({
    baseUrl: BASE,
    store,
    fallback,
    fetchImpl: createFetchStub(routeTable({ 'POST /api/match/queue': fail('already_queued', 'already in queue', { status: 409 }) })),
  });
  await already.joinQueue(); // 不抛错
  assert.notEqual(store.getState().runtime.queue, null);
});

test('leaveQueue：成功取消；410 queue_expired 也当成功（用户的目的已经达到）', async () => {
  const store = createStore({ storage: createMemoryStorage() });
  store.saveSettings({ mockDelayMs: 0 });
  const fallback = createMockApi({ store, sleep: () => Promise.resolve() });
  store.startQueue({ anonymous: true });

  const gone = createHttpApi({
    baseUrl: BASE,
    store,
    fallback,
    fetchImpl: createFetchStub(routeTable({ 'DELETE /api/match/queue': fail('queue_expired', 'no queue', { status: 410 }) })),
  });
  const result = await gone.leaveQueue();
  assert.deepEqual(result, { ok: true, invalidatedRequests: 0 });
  assert.equal(store.getState().runtime.queue, null, '本地队列也要清掉');
});

test('listWaitingLearners / listRecommendedBuddies：{entries} → 裸数组', async () => {
  const { api } = setup({
    routes: {
      'GET /api/match/queue': ok({ entries: [{ peerId: 'lucas', matchScore: 68 }] }),
      'GET /api/match/recommendations': ok({ entries: [{ peerId: 'ka-ho', matchScore: 68 }, { peerId: 'wai-ling', matchScore: 54 }] }),
    },
  });
  const learners = await api.listWaitingLearners();
  assert.ok(Array.isArray(learners), '页面要裸数组');
  assert.equal(learners[0].peerId, 'lucas');

  const buddies = await api.listRecommendedBuddies();
  assert.equal(buddies.length, 2);
  assert.equal(buddies[0].peerId, 'ka-ho');
});

test('getCandidate：摊平 + reason + roomAvailable 在人对象里', async () => {
  const { api } = setup({
    routes: {
      'GET /api/match/candidates/lucas': ok({
        candidate: { peerId: 'lucas', interests: ['movies'], matchScore: 68, roomAvailable: undefined },
        matchedTags: ['movies'],
        matchScore: 68,
        reasons: ['movies'],
        roomAvailable: false,
      }),
    },
  });
  const candidate = await api.getCandidate('lucas');
  assert.equal(candidate.peerId, 'lucas');
  assert.deepEqual(candidate.reason, ['movies']);
  assert.equal(candidate.roomAvailable, false, '预览页读的是 candidate.roomAvailable');
});

test('updateMatchCriteria：topics 送上去，回写 store.settings.matchCriteria', async () => {
  const { store, api, fetchImpl } = setup({
    // 后端会把「应用后的条件」回显出来：传 null / [] 就回 null
    routes: { 'PUT /api/match/criteria': (call) => ok({ ok: true, criteria: call.body.topics }) },
  });
  const result = await api.updateMatchCriteria(['anime', 'food']);
  assert.deepEqual(bodyOf(fetchImpl.calls[0]), { topics: ['anime', 'food'] });
  assert.deepEqual(result.criteria, ['anime', 'food']);
  assert.deepEqual(store.getState().settings.matchCriteria, ['anime', 'food']);

  const cleared = await api.updateMatchCriteria(null);
  assert.deepEqual(bodyOf(fetchImpl.calls[1]), { topics: null });
  assert.equal(cleared.criteria, null);
});

test('createRoom / createRoomWithBuddy：同一个端点，发起人身份不同', async () => {
  const { store, api, fetchImpl } = setup({
    role: 'buddy',
    routes: { 'POST /api/rooms': ok({ roomId: 'r-lucas-1', peer: { peerId: 'lucas' }, expiresAt: null }) },
  });
  const room = await api.createRoom('lucas');
  assert.deepEqual(bodyOf(fetchImpl.calls[0]), { learnerId: 'lucas' });
  assert.equal(room.roomId, 'r-lucas-1');
  assert.equal(store.getState().runtime.room.roomId, 'r-lucas-1', '成房要同步 store');
  assert.equal(store.getState().runtime.room.role, 'buddy');

  store.setRole('learner');
  await api.createRoomWithBuddy('ka-ho');
  assert.deepEqual(bodyOf(fetchImpl.calls[1]), { buddyId: 'ka-ho' });
  assert.equal(store.getState().runtime.room.role, 'learner');
});

test('requestMatch：走演示口子 → store 里出现待接受请求（expiresAt 是毫秒）', async () => {
  const { store, api, fetchImpl } = setup({
    routes: {
      'POST /api/dev/match-request': ok({
        requestId: 'req-1',
        roomId: 'r-ka-ho-1',
        peer: { peerId: 'ka-ho' },
        expiresAt: '2026-09-29T06:00:10.000Z',
        acceptSeconds: 10,
      }),
    },
  });
  const result = await api.requestMatch({ reason: 'demo' });
  assert.equal(result.status, 'pending');
  assert.equal(result.expiresAt, Date.parse('2026-09-29T06:00:10.000Z'));

  const pending = store.getState().runtime.matchRequest;
  assert.equal(pending.roomId, 'r-ka-ho-1');
  assert.equal(pending.expiresAt, Date.parse('2026-09-29T06:00:10.000Z'), '弹窗倒计时要用毫秒数');

  // 已经有一条待接受请求时不再打服务端（否则后台引擎每轮都会产出一个新房间号）
  await api.requestMatch({ reason: 'background' });
  assert.equal(fetchImpl.calls.length, 1);
});

test('acceptMatchRequest：用服务端 requestId 成房 → store 从「待接受」切到「房间」', async () => {
  const { store, api, fetchImpl } = setup({
    routes: {
      'POST /api/dev/match-request': ok({ requestId: 'req-7', roomId: 'r-ka-ho-7', peer: { peerId: 'ka-ho' }, expiresAt: null, acceptSeconds: 10 }),
      'POST /api/match/requests/req-7/accept': ok({ roomId: 'r-ka-ho-7', peer: { peerId: 'ka-ho' }, expiresAt: null }),
    },
  });
  await api.requestMatch({});
  const result = await api.acceptMatchRequest();

  assert.equal(fetchImpl.calls[1].url, BASE + '/api/match/requests/req-7/accept');
  assert.equal(result.status, 'accepted');
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.equal(store.getState().runtime.room.roomId, 'r-ka-ho-7');
});

test('acceptMatchRequest：服务端说房间被抢走 → 按「不接受」处理，不抛错', async () => {
  const { store, api } = setup({
    routes: {
      'POST /api/dev/match-request': ok({ requestId: 'req-9', roomId: 'r-x-9', peer: { peerId: 'x' }, expiresAt: null }),
      'POST /api/match/requests/req-9/accept': fail('room_taken', 'room already claimed', { status: 409 }),
    },
  });
  await api.requestMatch({});
  const result = await api.acceptMatchRequest();
  assert.equal(result.status, 'declined', '演示路径上的正常分支：收起弹窗、人留在队列');
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.equal(store.getState().runtime.room, null, '没有房间');
});

test('acceptMatchRequest：没有服务端请求号时回落到 mock 语义', async () => {
  const { api } = setup({ routes: {} });
  const result = await api.acceptMatchRequest();
  assert.equal(result.status, 'none', 'mock 在没有待接受请求时就是 none');
});

test('declineMatchRequest：通知服务端 + 清掉本地待接受请求；410 也容忍', async () => {
  const { store, api, fetchImpl } = setup({
    routes: {
      'POST /api/dev/match-request': ok({ requestId: 'req-3', roomId: 'r-3', peer: { peerId: 'ka-ho' }, expiresAt: null }),
      'POST /api/match/requests/req-3/decline': ok({ ok: true }),
    },
  });
  await api.requestMatch({});
  const result = await api.declineMatchRequest({ expired: false });
  assert.equal(result.status, 'declined');
  assert.equal(fetchImpl.calls[1].url, BASE + '/api/match/requests/req-3/decline');
  assert.equal(store.getState().runtime.matchRequest, null, '人留在队列，但弹窗收起');
});

test('getCards：真房间走 HTTP（带 level 与 interests），假房间号（预览）降级到演示卡池', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'GET /api/rooms/r-real-1/cards': ok({ roomId: 'r-real-1', level: 'beginner', cards: [{ id: 'anime-beginner-01' }] }),
    },
  });

  const real = await api.getCards('r-real-1', { level: 'beginner', interests: ['anime', 'food'] });
  assert.equal(real.cards.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes('level=beginner'));
  assert.ok(fetchImpl.calls[0].url.includes('interests=anime%2Cfood'));

  const preview = await api.getCards('preview-lucas', { level: 'beginner', interests: ['anime'] });
  assert.equal(fetchImpl.calls.length, 1, '预览用的假房间号不该打服务端');
  assert.ok(Array.isArray(preview.cards) && preview.cards.length > 0, '降级到演示卡池，仍要有卡可滑');
  assert.ok(preview.roomId.startsWith('preview-'));
});

test('endRoom：服务端结算是权威值，同时本地也记一笔（我的页/成就页读本地）', async () => {
  const { store, api, fetchImpl } = setup({
    routes: {
      'POST /api/rooms/r-1/end': ok({ durationSec: 90, cardsUsed: 5, xpEarned: 34, unlocked: ['first_conversation'], topics: ['anime', 'food'] }),
    },
  });
  const reward = await api.endRoom('r-1', { durationSec: 90, cardsUsed: 5, topics: ['anime', 'food'], peerId: 'ka-ho', peerLabel: 'ka-ho' });

  assert.deepEqual(bodyOf(fetchImpl.calls[0]), { durationSec: 90, cardsUsed: 5, topics: ['anime', 'food'] });
  assert.equal(reward.xpEarned, 34);
  assert.deepEqual(reward.unlocked, ['first_conversation']);
  assert.equal(store.getState().progress.xp, 34, '本地进度也要动（统计页读的是它）');
  assert.equal(store.getState().social.history.length, 1, '本地也记一条通话记录');
});

test('sendFeedback / savePhrase：写成功顺手把本地状态也同步好', async () => {
  const { store, api, fetchImpl } = setup({
    routes: {
      'POST /api/rooms/r-1/feedback': ok({ ok: true }),
      'POST /api/me/saved-phrases': ok({ savedPhrase: { savedPhraseId: 'sp-1', cantonese: '你最近睇緊咩動漫？' } }),
    },
  });

  await api.sendFeedback('r-1', { tags: ['active_learner'] });
  assert.equal(store.getState().runtime.notice.kind, 'feedback');

  // 卡片里的短语是 {cantonese, mandarin, english}：english 要折成契约里的 phrase
  const result = await api.savePhrase({ cantonese: '你最近睇緊咩動漫？', mandarin: '你最近在看什么动漫？', english: 'What anime?' });
  assert.deepEqual(bodyOf(fetchImpl.calls[1]), {
    cantonese: '你最近睇緊咩動漫？',
    mandarin: '你最近在看什么动漫？',
    phrase: 'What anime?',
  }, '没给 roomId 就不发这个键');
  assert.equal(result.savedPhrase.savedPhraseId, 'sp-1');
  assert.equal(store.getState().social.savedPhrases.length, 1, '本地也记下（星星立刻点亮）');
});

test('endRoom：服务端说「已经结算过」时，本地也不能再记一遍（幂等要对齐）', async () => {
  const { store, api } = setup({
    routes: {
      // 后端对重复结算会回放同一份 settlement（同一个房间不会加两次 XP）
      'POST /api/rooms/r-1/end': ok({ durationSec: 90, cardsUsed: 5, xpEarned: 34, unlocked: [], topics: ['anime'] }),
    },
  });

  const first = await api.endRoom('r-1', { durationSec: 90, cardsUsed: 5, topics: ['anime'] });
  assert.equal(store.getState().progress.xp, 34);
  assert.equal(store.getState().social.history.length, 1);

  const second = await api.endRoom('r-1', { durationSec: 90, cardsUsed: 5, topics: ['anime'] });
  assert.deepEqual(second, first, '重打返回同一份结算');
  assert.equal(store.getState().progress.xp, 34, '本地绝不能记第二遍（否则进度比服务端多一场）');
  assert.equal(store.getState().social.history.length, 1);
});

test('savePhrase：没给的字段不出现在请求体里（发 null 会被后端判 400）', async () => {
  const { api, fetchImpl } = setup({ routes: { 'POST /api/me/saved-phrases': ok({ savedPhrase: { savedPhraseId: 'sp-2' } }) } });
  await api.savePhrase({ cantonese: '你最近睇緊咩動漫？' });
  const body = bodyOf(fetchImpl.calls[0]);
  assert.deepEqual(body, { cantonese: '你最近睇緊咩動漫？' });
  assert.equal('roomId' in body, false, 'roomId 缺省时整个键都不该出现');

  await api.savePhrase({ phrase: 'Lately I have been watching…', roomId: 'r-9' });
  assert.deepEqual(bodyOf(fetchImpl.calls[1]), { phrase: 'Lately I have been watching…', roomId: 'r-9' });
});

test('getRoom：把房间元信息摊成前端形状', async () => {
  const { api } = setup({
    routes: {
      'GET /api/rooms/r-1': ok({
        room: { roomId: 'r-1', peerUserId: 'lucas', peerRole: 'learner', status: 'active', createdAt: '2026-09-29T06:00:00.000Z' },
        peer: { peerId: 'lucas' },
        status: 'active',
        startedAt: '2026-09-29T06:00:00.000Z',
      }),
    },
  });
  const result = await api.getRoom('r-1');
  assert.equal(result.room.roomId, 'r-1');
  assert.equal(result.room.role, 'buddy');
  assert.equal(result.startedAt, Date.parse('2026-09-29T06:00:00.000Z'));
});

test('降级：后端还没做的 3 个方法原样转发给 mock（页面在「半真」档位下全程可用）', async () => {
  const { api, fetchImpl } = setup({ routes: {} });
  assert.deepEqual(
    [...FALLBACK_METHODS].sort(),
    ['checkVersionPolicy', 'refreshToken', 'signInWithCredentials'],
    '降级清单就剩这 3 个：正式登录 / 刷新 / 版本策略（signOut 已接上真接口）',
  );
  const policy = await api.checkVersionPolicy();
  assert.equal(typeof policy.minVersion, 'string');
  assert.equal(fetchImpl.calls.length, 0, '降级的方法一个请求都不该发');
});

test('getIceServers：走真接口并归一化成与 mock 同形状（远端信令靠它拿 STUN / TURN）', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'GET /api/rtc/ice-servers': ok({
        iceServers: [{ urls: 'stun:stun.example.com:3478' }, { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }],
        expiresAt: '2026-09-29T07:00:00.000Z',
      }),
    },
  });
  const result = await api.getIceServers();
  assert.equal(result.iceServers.length, 2);
  assert.equal(result.iceServers[0].urls, 'stun:stun.example.com:3478');
  assert.equal(result.expiresAt, '2026-09-29T07:00:00.000Z');
  assert.equal(fetchImpl.calls.length, 1, '不再降级到 mock，必须真的发请求');
  assert.equal(fetchImpl.calls[0].method, 'GET');
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/rtc/ice-servers'));
});

test('getIceServers：503 turn_unavailable 原样抛 ApiError（由 rtc.js 的兜底 STUN 接住）', async () => {
  const { api } = setup({ routes: { 'GET /api/rtc/ice-servers': fail('turn_unavailable', 'no turn', { status: 503 }) } });
  await assert.rejects(() => api.getIceServers(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'turn_unavailable');
    return true;
  });
});

test('鉴权：401 抛 not_authorized（令牌被清掉，由上层引导回落地页）', async () => {
  const { api } = setup({ routes: { 'GET /api/me': fail('not_authorized', 'expired', { status: 401 }) } });
  await assert.rejects(() => api.getMe(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'not_authorized');
    return true;
  });
});

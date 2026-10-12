/**
 * 伙伴关系 / 沉淀（契约 4.6 / 4.7 节）：11 个方法从「降级到 mock」改成走真后端。
 *
 * 盯住三件事：
 *   1. **请求形状**：URL / 方法 / query / body（尤其是 `sendBuddyRequest` 的 body 里**不能有 `label`**，
 *      契约的请求字段只有 `peerId` / `roomId`，多送一个会被后端判 400——真联调时抓到过）；
 *   2. **返回形状**：`{buddies}` / `{requests}` / `{entries}` 都要摊成**裸数组**，页面读法不变；
 *   3. **本地镜像**：写成功后照旧调 store 的同名方法（`/dev/mock` 与历史页读的是本地 `social`），
 *      但**返回值以服务端为准**。
 *
 * 全程不联网：假 fetch 回放后端真实响应片段。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoryStorage, createStore } from '../../src/app/store.js';
import { ApiError, createMockApi } from '../../src/services/mockApi.js';
import { createHttpApi } from '../../src/services/httpApi.js';
import { createFetchStub, fail, ok, routeTable } from '../helpers/http-stub.mjs';

const BASE = 'http://localhost:8787';

/** 请求体去掉自动生成的 `requestId`（写接口由 http.js 补）。 */
function bodyOf(call) {
  const { requestId, ...rest } = call.body ?? {};
  assert.ok(typeof requestId === 'string' && requestId.length > 0, '写请求必须自动带 requestId');
  return rest;
}

function setup({ routes = {}, role = 'learner' } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  store.saveSettings({ mockDelayMs: 0 });
  if (role) store.setRole(role);
  const fallback = createMockApi({ store, sleep: () => Promise.resolve() });
  const fetchImpl = createFetchStub(routeTable(routes));
  const api = createHttpApi({ baseUrl: BASE, store, fallback, fetchImpl });
  return { store, api, fetchImpl };
}

const social = (store) => store.getState().social ?? {};
const peerIds = (rows) => (rows ?? []).map((row) => row.peerId);

test('listBuddies：GET /api/me/buddies，{buddies} 摊成裸数组', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'GET /api/me/buddies': ok({ buddies: [{ peerId: 'ka-ho', label: 'ka-ho', since: '2026-09-20T10:00:00+08:00' }] }),
    },
  });
  const buddies = await api.listBuddies();
  assert.deepEqual(peerIds(buddies), ['ka-ho']);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/me/buddies'));
  assert.equal(fetchImpl.calls[0].method, 'GET');
});

test('listBuddyRequests：GET /api/me/buddy-requests，{requests} 摊成裸数组；direction / status 可选', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'GET /api/me/buddy-requests': ok({
        requests: [
          {
            requestId: 'req-1',
            peerId: 'wai-ling',
            label: 'wai-ling',
            direction: 'incoming',
            status: 'pending',
            roomId: null,
            createdAt: '2026-09-29T10:00:00+08:00',
            respondedAt: null,
          },
        ],
      }),
    },
  });
  const requests = await api.listBuddyRequests();
  assert.deepEqual(peerIds(requests), ['wai-ling']);
  assert.equal(requests[0].direction, 'incoming');
  const filtered = await api.listBuddyRequests({ direction: 'outgoing', status: 'pending' });
  assert.equal(filtered.length, 1);
  assert.ok(fetchImpl.calls[1].url.includes('direction=outgoing'), 'direction 要进 query');
  assert.ok(fetchImpl.calls[1].url.includes('status=pending'), 'status 要进 query');
});

test('sendBuddyRequest：body 只有 peerId / roomId（**绝不能带 label**），status 原样回给页面', async () => {
  // 用 siu-fung：出厂数据里 ka-ho 已经是伙伴、wai-ling 已有一条「收到的」申请，
  // 拿它们测「新发一条申请」会被本地关系短路（那是另一条用例的场景）
  const { api, store, fetchImpl } = setup({
    routes: { 'POST /api/me/buddy-requests': ok({ request: { requestId: 'req-9', peerId: 'siu-fung', label: '小凤', direction: 'outgoing', status: 'pending', roomId: 'r-1', createdAt: '2026-09-29T10:00:00+08:00', respondedAt: null }, status: 'pending' }) },
  });
  const result = await api.sendBuddyRequest('siu-fung', '小凤', { roomId: 'r-1' });
  assert.equal(result.status, 'pending');
  const body = bodyOf(fetchImpl.calls[0]);
  assert.deepEqual(body, { peerId: 'siu-fung', roomId: 'r-1' }, 'label 是本地显示用的，不能进请求体');
  assert.equal('label' in body, false);
  // 本地镜像：多了一条「我发出的」申请
  const outgoing = social(store).buddyRequests.filter((row) => row.peerId === 'siu-fung');
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].direction, 'outgoing');
  assert.equal(outgoing[0].label, '小凤', '本地镜像保留 label 供显示');
});

test('sendBuddyRequest：没有房间时 roomId 不进请求体（发 null 会被后端判 400）', async () => {
  const { api, fetchImpl } = setup({
    routes: { 'POST /api/me/buddy-requests': ok({ request: null, status: 'buddy' }) },
  });
  const result = await api.sendBuddyRequest('ka-ho', '阿豪');
  assert.equal(result.status, 'buddy', '已经是伙伴：服务端 200 + status buddy，不是错误');
  assert.deepEqual(bodyOf(fetchImpl.calls[0]), { peerId: 'ka-ho' });
});

test('sendBuddyRequest：对方也申请过我（status accepted）→ 本地直接变成伙伴', async () => {
  const { api, store } = setup({
    routes: { 'POST /api/me/buddy-requests': ok({ request: { requestId: 'req-2', peerId: 'wai-ling' }, status: 'accepted' }) },
  });
  store.receiveBuddyRequest('wai-ling', 'wai-ling'); // 本地先有「收到的」申请
  const result = await api.sendBuddyRequest('wai-ling', 'wai-ling');
  assert.equal(result.status, 'accepted');
  assert.ok(peerIds(social(store).buddies).includes('wai-ling'), '双向申请 ⇒ 本地也直接成伙伴');
  assert.equal(social(store).buddyRequests.some((row) => row.peerId === 'wai-ling'), false, '待处理申请要清掉');
});

test('sendBuddyRequest：本地预置关系与服务端不一致时，镜像以**服务端**为准（回归）', async () => {
  // 真联调踩到的坑：本地记着对面是「收到的申请」，服务端却说「我发出的待处理」。
  // 早先按 store 的粒度动作做镜像时，本地会把它错误地变成伙伴（界面出现服务端并没有的伙伴）。
  const { api, store } = setup({
    routes: {
      'POST /api/me/buddy-requests': ok({
        request: {
          requestId: 'req-11',
          peerId: 'wai-ling',
          label: 'wai-ling',
          direction: 'outgoing',
          status: 'pending',
          roomId: null,
          createdAt: '2026-09-29T10:00:00+08:00',
          respondedAt: null,
        },
        status: 'pending',
      }),
    },
  });
  // 本地先造一条「收到的申请」（演示辅助接口；出厂三张表都是空的）
  store.receiveBuddyRequest('wai-ling', 'wai-ling');
  assert.ok(
    (social(store).buddyRequests ?? []).some((row) => row.peerId === 'wai-ling' && row.direction === 'incoming'),
    '本地认为 wai-ling 是「收到的申请」',
  );

  const result = await api.sendBuddyRequest('wai-ling', 'wai-ling');
  assert.equal(result.status, 'pending', '服务端说是待处理，本地就不能自说自话当成伙伴');
  const rows = social(store).buddyRequests.filter((row) => row.peerId === 'wai-ling');
  assert.equal(rows.length, 1, '同一个 peer 只留一行');
  assert.equal(rows[0].direction, 'outgoing', '方向以服务端为准');
  assert.equal(rows[0].requestId, 'req-11');
  assert.equal(peerIds(social(store).buddies).includes('wai-ling'), false, '不该凭空多出伙伴');
});

test('listBuddies / listBuddyRequests：读回来的列表会覆盖本地镜像（/dev/mock 读的就是它）', async () => {
  const { api, store } = setup({
    routes: {
      'GET /api/me/buddies': ok({ buddies: [{ peerId: 'lucas', label: 'lucas', since: '2026-09-29T10:00:00+08:00' }] }),
      'GET /api/me/buddy-requests': ok({ requests: [] }),
    },
  });
  await api.listBuddies();
  assert.deepEqual(peerIds(social(store).buddies), ['lucas'], '以服务端那一份为准（清掉了出厂预置的 ka-ho）');
  await api.listBuddyRequests();
  assert.deepEqual(social(store).buddyRequests, []);
});

test('sendBuddyRequest：409 already_buddy 也当成功（契约给这条留了口子）', async () => {
  const { api } = setup({
    routes: { 'POST /api/me/buddy-requests': fail('already_buddy', 'already buddy', { status: 409 }) },
  });
  const result = await api.sendBuddyRequest('ka-ho', '阿豪');
  assert.equal(result.status, 'buddy');
});

test('acceptBuddyRequest：POST .../:peerId/accept → 本地把申请换成伙伴', async () => {
  const { api, store, fetchImpl } = setup({
    routes: {
      'POST /api/me/buddy-requests/wai-ling/accept': ok({
        buddy: { peerId: 'wai-ling', label: 'wai-ling', since: '2026-09-29T10:00:00+08:00' },
        request: { requestId: 'req-3', peerId: 'wai-ling' },
      }),
    },
  });
  store.receiveBuddyRequest('wai-ling', 'wai-ling'); // 造一条「收到的」申请
  const result = await api.acceptBuddyRequest('wai-ling');
  assert.equal(result.status, 'accepted');
  assert.equal(result.buddy.peerId, 'wai-ling');
  assert.ok(peerIds(social(store).buddies).includes('wai-ling'));
  assert.equal(social(store).buddyRequests.some((row) => row.peerId === 'wai-ling'), false);
  // 申请里带特殊字符的 id 要编码
  assert.ok(fetchImpl.calls[0].url.includes('/api/me/buddy-requests/wai-ling/accept'));
});

test('acceptBuddyRequest：404（申请已经不在了）不报错，回 status none', async () => {
  const { api } = setup({
    routes: { 'POST /api/me/buddy-requests/gone/accept': fail('not_found', 'no such request', { status: 404 }) },
  });
  const result = await api.acceptBuddyRequest('gone');
  assert.equal(result.status, 'none');
});

test('declineBuddyRequest / cancelBuddyRequest：各自打对端点，并把本地那条申请清掉', async () => {
  const { api, store, fetchImpl } = setup({
    routes: {
      'POST /api/me/buddy-requests/wai-ling/decline': ok({ ok: true }),
      'DELETE /api/me/buddy-requests/ka-ho': ok({ ok: true }),
    },
  });
  store.receiveBuddyRequest('wai-ling', 'wai-ling');
  store.sendBuddyRequest('ka-ho', 'ka-ho');

  const declined = await api.declineBuddyRequest('wai-ling');
  assert.equal(declined.status, 'declined');
  assert.equal(social(store).buddyRequests.some((row) => row.peerId === 'wai-ling'), false);

  const cancelled = await api.cancelBuddyRequest('ka-ho');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(social(store).buddyRequests.some((row) => row.peerId === 'ka-ho'), false);

  assert.equal(fetchImpl.calls[0].method, 'POST');
  assert.ok(fetchImpl.calls[0].url.endsWith('/decline'));
  assert.equal(fetchImpl.calls[1].method, 'DELETE');
  assert.ok(fetchImpl.calls[1].url.endsWith('/api/me/buddy-requests/ka-ho'));
});

test('decline / cancel / remove：404 都容忍（目的已经达到，不给用户红页）', async () => {
  const { api } = setup({
    routes: {
      'POST /api/me/buddy-requests/gone/decline': fail('not_found', 'gone', { status: 404 }),
      'DELETE /api/me/buddy-requests/gone': fail('not_found', 'gone', { status: 404 }),
      'DELETE /api/me/buddies/gone': fail('not_found', 'gone', { status: 404 }),
    },
  });
  assert.equal((await api.declineBuddyRequest('gone')).status, 'declined');
  assert.equal((await api.cancelBuddyRequest('gone')).status, 'cancelled');
  assert.equal((await api.removeBuddy('gone')).status, 'removed');
});

test('removeBuddy：DELETE /api/me/buddies/:peerId，本地伙伴列表同步移除', async () => {
  const { api, store, fetchImpl } = setup({
    routes: { 'DELETE /api/me/buddies/ka-ho': ok({ ok: true }) },
  });
  store.receiveBuddyRequest('ka-ho', 'ka-ho');
  store.acceptBuddyRequest('ka-ho');
  assert.ok(peerIds(social(store).buddies).includes('ka-ho'));

  const result = await api.removeBuddy('ka-ho');
  assert.equal(result.status, 'removed');
  assert.equal(peerIds(social(store).buddies).includes('ka-ho'), false);
  assert.equal(fetchImpl.calls[0].method, 'DELETE');
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/me/buddies/ka-ho'));
});

test('receiveBuddyRequest：走契约外演示口子，本地多一条「收到的」申请', async () => {
  const { api, store, fetchImpl } = setup({
    routes: { 'POST /api/dev/buddy-request': ok({ request: { requestId: 'req-5', peerId: 'siu-fung', direction: 'incoming' } }) },
  });
  const result = await api.receiveBuddyRequest('siu-fung', '小凤');
  assert.equal(result.status, 'pending-in');
  const incoming = social(store).buddyRequests.filter((row) => row.peerId === 'siu-fung');
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].direction, 'incoming');
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/dev/buddy-request'));
  assert.deepEqual(fetchImpl.calls[0].body.peerId, 'siu-fung');
});

test('getProgress：GET /api/me/progress，键集合与 mock 一致，直接透传', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'GET /api/me/progress': ok({
        xp: 394,
        streakDays: 3,
        totalMinutes: 48,
        conversations: 3,
        peopleHelped: 1,
        distinctTopics: 6,
        practiceMinutesThisWeek: 48,
        achievements: ['first_buddy_session'],
        buddyLevel: 'helper',
      }),
    },
  });
  const progress = await api.getProgress();
  assert.equal(progress.xp, 394);
  assert.equal(progress.buddyLevel, 'helper');
  assert.deepEqual(progress.achievements, ['first_buddy_session']);
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/me/progress'));
});

test('getProgress：成就字段缺失 / 不是数组时兜底成空数组（页面会 map 它）', async () => {
  const { api } = setup({ routes: { 'GET /api/me/progress': ok({ xp: 10 }) } });
  const progress = await api.getProgress();
  assert.deepEqual(progress.achievements, []);
});

test('getHistory：GET /api/me/history，{entries} 摊成裸数组（新的在最前）', async () => {
  const { api } = setup({
    routes: {
      'GET /api/me/history': ok({
        entries: [
          { sessionId: 's-2', peerId: 'ka-ho', role: 'buddy', durationSec: 90, cardsUsed: 5, topics: ['anime'] },
          { sessionId: 's-1', peerId: 'wai-ling', role: 'buddy', durationSec: 60, cardsUsed: 3, topics: [] },
        ],
      }),
    },
  });
  const history = await api.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].sessionId, 's-2');
});

test('getLeaderboard：GET /api/leaderboard?period=&role=，{entries} 摊成裸数组', async () => {
  const { api, fetchImpl } = setup({
    routes: {
      'GET /api/leaderboard': ok({
        entries: [{ rank: 1, userId: 'lucas', anonymous: false, minutes: 120, xp: 700, isMe: false }],
      }),
    },
  });
  const rows = await api.getLeaderboard('monthly', 'buddy');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rank, 1);
  assert.ok(fetchImpl.calls[0].url.includes('period=monthly'));
  assert.ok(fetchImpl.calls[0].url.includes('role=buddy'));

  // 缺省口径：周榜 × 学习者
  await api.getLeaderboard();
  assert.ok(fetchImpl.calls[1].url.includes('period=weekly'));
  assert.ok(fetchImpl.calls[1].url.includes('role=learner'));
});

test('这些方法现在都要求登录：无令牌时 401 会照常抛出', async () => {
  const { api } = setup({
    routes: { 'GET /api/me/buddies': fail('not_authorized', 'missing token', { status: 401 }) },
  });
  await assert.rejects(() => api.listBuddies(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'not_authorized');
    return true;
  });
});

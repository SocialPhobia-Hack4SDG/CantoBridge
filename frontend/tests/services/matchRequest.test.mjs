/**
 * 真数据链路的两处回归（都是 `tools/e2e-real.mjs` 第一次跑真后端时抓到的）：
 *
 *   1. **并发造匹配请求**：页面的「使用演示伙伴」与外壳的后台匹配引擎会同时调
 *      `requestMatch()`，两次都看到"store 里还没有请求"→ 各发一条给服务端 →
 *      本地只认先到的那条 → 「接受的是第二条、进的是第一条的房间」→ 房间 404。
 *   2. **pendingRequestId 必须以 store 为准**：store 里现存的那条请求才是弹窗与房间号
 *      的真源；闭包里的 id 一旦与它不一致，接受就会打错请求。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoryStorage, createStore } from '../../src/app/store.js';
import { createMockApi } from '../../src/services/mockApi.js';
import { createHttpApi } from '../../src/services/httpApi.js';
import { createFetchStub, ok, routeTable } from '../helpers/http-stub.mjs';

const BASE = 'http://localhost:8787';
const PEER = { peerId: 'ka-ho', anonymous: false, displayName: 'ka-ho' };

function matchRequestPayload(roomId, requestId) {
  return {
    requestId,
    roomId,
    peer: PEER,
    expiresAt: '2026-09-29T09:00:00.000Z',
    acceptSeconds: 10,
  };
}

function setup({ onMatchRequest = null } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  store.saveSettings({ mockDelayMs: 0 });
  let seq = 0;
  const routes = {
    'POST /api/dev/match-request': (call) => {
      seq += 1;
      const payload = matchRequestPayload('r-ka-ho-' + seq, 'req-' + seq);
      // 允许用例在"服务端返回之前"塞一条别的请求进 store（模拟并发的另一个生产者）
      onMatchRequest?.(store, payload);
      return ok(payload);
    },
    'POST /api/match/requests/': () => ok({ roomId: 'r-ka-ho-1', peer: PEER, expiresAt: null }),
  };
  const fetchImpl = createFetchStub(routeTable(routes));
  const api = createHttpApi({
    baseUrl: BASE,
    store,
    fallback: createMockApi({ store, sleep: () => Promise.resolve() }),
    fetchImpl,
  });
  return { store, api, fetchImpl, callsTo: (path) => fetchImpl.calls.filter((call) => call.url.includes(path)) };
}

test('并发 requestMatch：只向服务端发一次，两个调用方拿到同一条请求', async () => {
  const { store, api, callsTo } = setup();

  const [first, second] = await Promise.all([api.requestMatch({ reason: 'demo' }), api.requestMatch({ reason: 'background' })]);

  assert.equal(callsTo('/api/dev/match-request').length, 1, '并发调用只能造一条请求（否则服务端留下孤儿、本地只认一条）');
  assert.equal(first.roomId, second.roomId, '两个调用方必须拿到同一个房间号');
  assert.equal(first.requestId, second.requestId, 'requestId 也要一致');
  assert.equal(store.getState().runtime.matchRequest.requestId, first.requestId, 'store 里的那条要带 requestId');
});

test('已有待接受请求时：不再造新的，且把仍然生效的那条原样报回去', async () => {
  const { store, api, callsTo } = setup();
  store.receiveMatchRequest({ requestId: 'req-existing', roomId: 'r-existing', peer: PEER });

  const result = await api.requestMatch({ reason: 'demo' });

  assert.equal(callsTo('/api/dev/match-request').length, 0, '已有请求就不该再打服务端');
  assert.equal(result.roomId, 'r-existing');
  assert.equal(result.requestId, 'req-existing', '要把生效的那条连 requestId 一起报回去');
});

test('回归：服务端返回期间 store 被别的生产者占位 → 接受必须打**store 里那条**请求', async () => {
  // 模拟并发：服务端这次返回 req-1/r-ka-ho-1，但 store 已经被另一条（req-racer）占住
  const { store, api, callsTo } = setup({
    onMatchRequest: (target) => {
      target.receiveMatchRequest({ requestId: 'req-racer', roomId: 'r-racer', peer: PEER });
    },
  });

  const result = await api.requestMatch({ reason: 'demo' });
  assert.equal(result.roomId, 'r-racer', '返回的房间号要以 store 里实际生效的那条为准');
  assert.equal(result.requestId, 'req-racer');

  await api.acceptMatchRequest();
  const acceptCalls = callsTo('/api/match/requests/');
  assert.equal(acceptCalls.length, 1, '接受应当打一次 accept');
  assert.ok(
    acceptCalls[0].url.includes('req-racer'),
    '接受必须用 store 里那条请求的 id（否则服务端建的是另一个房间 → 进房 404）：' + acceptCalls[0].url,
  );
});

/**
 * 匹配频道（`/ws/match`）客户端：把服务端推送接进 store。
 *
 * 这一层是「我点了对面，对面没反应」那个 bug 的修复本体，所以每条口径都要钉住：
 *   - 缺令牌 / 缺信令地址 = 无害旁路（纯 mock 档位与未登录都靠它）
 *   - `queue:updated` → 候选人列表；`match:taken` → 摘掉一位
 *   - `match:matched` 的两种形状：`requestId` 为 null = 直接进房；带 id = 弹接受框
 *   - 断线要按退避重连，`close()` 之后不再重连
 *
 * 服务端那一半（谁该收到什么）在 `backend/tests/ws.test.mjs` 与 `signaling.test.mjs`，
 * 这里只喂**后端真实会发的载荷形状**（见 `backend/src/ws/signaling.js` 的事件桥）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RETRY_DELAYS_MS, createMatchSync } from '../src/app/matchSync.js';
import { createMemoryStorage, createStore } from '../src/app/store.js';
import { createClock, createWebSocketStub } from './helpers/rtc-stub.mjs';

const SIGNAL = 'wss://localhost:4173/ws';
const PEER = { peerId: 'learner-u-1', role: 'learner', displayName: '小明', interests: ['anime'] };

/** 装配一套：真 store + 假 WebSocket + 虚拟时钟。`socket()` 拿最近一条连接。 */
function setup({ token = 'tok-1', signalUrl = SIGNAL, role = 'learner', onEnterRoom = null } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  if (role) store.setRole(role);
  const { FakeWebSocket, sockets } = createWebSocketStub();
  const clock = createClock();
  const entered = [];
  const sync = createMatchSync({
    store,
    signalUrl,
    getToken: () => token,
    WebSocketImpl: FakeWebSocket,
    onEnterRoom: onEnterRoom ?? ((roomId) => entered.push(roomId)),
    setTimer: clock.win.setTimeout,
    clearTimer: clock.win.clearTimeout,
  });
  return { store, sockets, clock, sync, entered, socket: () => sockets[sockets.length - 1] };
}

test('缺令牌 / 缺信令地址 / 没有 WebSocket 实现：一律不开连接，也不抛错', () => {
  const noToken = setup({ token: null });
  assert.equal(noToken.sync.open(), false);
  assert.equal(noToken.sockets.length, 0, '没令牌连上去只会被 401 踢掉');
  assert.equal(noToken.sync.isConnected(), false);

  const noUrl = setup({ signalUrl: '' });
  assert.equal(noUrl.sync.open(), false);
  assert.equal(noUrl.sockets.length, 0);

  // 老浏览器 / 单测环境里可能根本没有 WebSocket 构造器
  const bare = createMatchSync({
    store: createStore({ storage: createMemoryStorage() }),
    signalUrl: SIGNAL,
    getToken: () => 'tok-1',
    WebSocketImpl: null,
  });
  assert.equal(bare.open(), false);
});

test('open()：连到 <信令基址>/match，令牌只能走查询串（浏览器不允许自定义头）', () => {
  const { sync, socket, sockets } = setup({ token: 'tok a/b' });
  assert.equal(sync.open(), true);
  assert.equal(sockets.length, 1);
  assert.equal(socket().url, 'wss://localhost:4173/ws/match?token=tok%20a%2Fb');
  assert.equal(sync.isConnected(), true);
});

test('open() 幂等：已经在连同一个地址就不再挂第二条', () => {
  const { sync, sockets } = setup();
  assert.equal(sync.open(), true);
  assert.equal(sync.open(), false);
  assert.equal(sockets.length, 1);
});

test('queue:updated：把推送来的候选人列表灌进 store（母语者挑人靠它）', () => {
  const { store, sync, socket } = setup({ role: 'buddy' });
  sync.open();
  socket().message({ type: 'queue:updated', entries: [{ peerId: 'learner-u-9', displayName: '阿华' }] });
  assert.deepEqual(store.getState().runtime.matchPeers, [{ peerId: 'learner-u-9', displayName: '阿华' }]);
});

test('match:taken：从推送列表里摘掉被挑走的那位（载荷字段是 learnerId）', () => {
  const { store, sync, socket } = setup({ role: 'buddy' });
  sync.open();
  socket().message({ type: 'queue:updated', entries: [{ peerId: 'a' }, { peerId: 'b' }] });
  socket().message({ type: 'match:taken', learnerId: 'a' });
  assert.deepEqual(
    store.getState().runtime.matchPeers.map((row) => row.peerId),
    ['b'],
  );
});

test('match:matched（requestId 为 null）：对方已开好房，不弹接受框、直接进房', () => {
  const { store, sync, socket, entered } = setup({ role: 'learner' });
  sync.open();
  socket().message({ type: 'match:matched', requestId: null, roomId: 'r-1', peer: PEER, expiresAt: null });

  assert.deepEqual(entered, ['r-1'], '外壳层据此跳房间页');
  assert.equal(store.getState().runtime.room.roomId, 'r-1');
  assert.deepEqual(store.getState().runtime.room.peer, PEER);
  assert.equal(store.getState().runtime.matchRequest, null, '不能当成「待接受请求」弹窗');
});

test('match:matched（带 requestId）：变成待接受请求，并把 ISO 时间转成倒计时用的毫秒数', () => {
  const { store, sync, socket, entered } = setup({ role: 'learner' });
  sync.open();
  const expiresAt = new Date(Date.now() + 10_000).toISOString();
  socket().message({ type: 'match:matched', requestId: 'req-1', roomId: 'r-2', peer: PEER, expiresAt });

  const request = store.getState().runtime.matchRequest;
  assert.equal(request.requestId, 'req-1');
  assert.equal(request.roomId, 'r-2');
  assert.equal(request.reason, 'server');
  assert.deepEqual(request.peer, PEER);
  assert.equal(request.expiresAt, Date.parse(expiresAt), '适配层要把 ISO 转成毫秒');
  assert.deepEqual(entered, [], '有 requestId 时要等用户点「接受」，不能直接进房');
});

test('已经在同一间房里：重复的 match:matched 不会把房间重建一遍（重连补发）', () => {
  const { sync, socket, entered } = setup({ role: 'learner' });
  sync.open();
  socket().message({ type: 'match:matched', requestId: null, roomId: 'r-1', peer: PEER });
  socket().message({ type: 'match:matched', requestId: null, roomId: 'r-1', peer: PEER });
  assert.deepEqual(entered, ['r-1'], '只应进房一次');
});

test('坏消息一律忽略：非法 JSON / 缺 type / 未知 type 都不能把连接搞崩', () => {
  const { store, sync, socket } = setup();
  sync.open();
  const before = store.getState().runtime.matchPeers;

  assert.doesNotThrow(() => {
    socket().raw('这不是 JSON');
    socket().raw(undefined);
    socket().message({ type: '' });
    socket().message(null);
    socket().message({ type: 'pong', at: '2026-10-01T00:00:00.000Z' });
    socket().message({ type: 'room:ready', peerReady: true });
  });
  assert.equal(store.getState().runtime.matchPeers, before, '坏消息不该改状态');
});

test('服务端断开后按退避序列重连（1s → 2s → …），不是立刻重连', () => {
  const { sync, sockets, clock } = setup();
  sync.open();
  assert.equal(sockets.length, 1);

  sockets[0].serverClose();
  assert.equal(sockets.length, 1, '要等退避时间，不能立刻重连');
  clock.tick(RETRY_DELAYS_MS[0] - 1);
  assert.equal(sockets.length, 1, '差 1ms 也还不连');
  clock.tick(1);
  assert.equal(sockets.length, 2, '第一档 1s 之后重连');

  sockets[1].serverClose();
  clock.tick(RETRY_DELAYS_MS[1] - 1);
  assert.equal(sockets.length, 2);
  clock.tick(1);
  assert.equal(sockets.length, 3, '第二档 2s');
});

test('连上之后退避计数归零：下一次断线又从最短的一档开始', () => {
  const { sync, sockets, clock } = setup();
  sync.open();
  sockets[0].open();
  sockets[0].serverClose();
  clock.tick(RETRY_DELAYS_MS[0]);
  assert.equal(sockets.length, 2);

  sockets[1].open(); // 这次连上了 → onopen 把 attempt 清零
  sockets[1].serverClose();
  clock.tick(RETRY_DELAYS_MS[0]);
  assert.equal(sockets.length, 3, '不该因为前面失败过就越等越久');
});

test('close()：主动断开之后不再重连，也不再挂新连接', () => {
  const { sync, sockets, clock } = setup();
  sync.open();
  sync.close();
  assert.equal(sockets[0].closed, true, 'socket 要真的关掉');
  assert.equal(sync.isConnected(), false);

  clock.tick(60_000);
  assert.equal(sockets.length, 1, '主动关闭之后不该再长出新连接');
});

test('构造 socket 就抛错（地址不可用）：退避重试而不是把整个 app 拖崩', () => {
  const store = createStore({ storage: createMemoryStorage() });
  const clock = createClock();
  let attempts = 0;
  class ExplodingSocket {
    constructor() {
      attempts += 1;
      throw new Error('bad url');
    }
  }
  const sync = createMatchSync({
    store,
    signalUrl: SIGNAL,
    getToken: () => 'tok-1',
    WebSocketImpl: ExplodingSocket,
    setTimer: clock.win.setTimeout,
    clearTimer: clock.win.clearTimeout,
  });

  assert.equal(sync.open(), false);
  assert.equal(attempts, 1);
  clock.tick(RETRY_DELAYS_MS[0]);
  assert.equal(attempts, 2, '退避之后会再试一次');
});

test('restart()：令牌变了就换一条连接（换身份＝换令牌），同一个令牌是空操作', () => {
  let token = 'tok-1';
  const store = createStore({ storage: createMemoryStorage() });
  const { FakeWebSocket, sockets } = createWebSocketStub();
  const sync = createMatchSync({
    store,
    signalUrl: SIGNAL,
    getToken: () => token,
    WebSocketImpl: FakeWebSocket,
  });

  sync.open();
  assert.equal(sockets.length, 1);
  assert.match(sockets[0].url, /tok-1/);

  assert.equal(sync.restart(), false, '同一个令牌：什么都不用做');
  assert.equal(sockets.length, 1);

  token = 'tok-2';
  assert.equal(sync.restart(), true);
  assert.equal(sockets.length, 2, '换令牌要重连');
  assert.match(sockets[1].url, /tok-2/);
  assert.equal(sockets[0].closed, true, '旧连接要收干净，不能同时挂两条');
});

test('restart()：令牌没了就断开（退出登录）', () => {
  let token = 'tok-1';
  const store = createStore({ storage: createMemoryStorage() });
  const { FakeWebSocket, sockets } = createWebSocketStub();
  const sync = createMatchSync({
    store,
    signalUrl: SIGNAL,
    getToken: () => token,
    WebSocketImpl: FakeWebSocket,
  });

  sync.open();
  token = null;
  assert.equal(sync.restart(), false);
  assert.equal(sync.isConnected(), false);
  assert.equal(sockets[0].closed, true);
});

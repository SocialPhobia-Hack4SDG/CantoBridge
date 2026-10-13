/**
 * 通话会话（rtc.js）：信令传输的抽取与三档降级。
 *
 * 全程不联网、不碰真 WebRTC / WebSocket / BroadcastChannel —— 用替身把「谁发了什么、
 * 谁收到了什么」摊开断言（替身在 `tests/helpers/rtc-stub.mjs`，与双端彩排共用一套）。
 * 真握手（Origin / 令牌 / 房间号）在 `backend/tests/ws.test.mjs`，
 * 真浏览器路径在 `backend/tools/smoke-ws.mjs`，双端彩排在 `backend/tools/rehearse-rtc.mjs`。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRtcHarness } from '../helpers/rtc-stub.mjs';
import {
  CALL_MODES,
  DEFAULT_ICE_SERVERS,
  createCallSession,
  createLocalTransport,
  createRemoteTransport,
  normalizeIceServers,
} from '../../src/services/rtc.js';

/* ------------------------------------------------------------------ *
 * 传输层
 * ------------------------------------------------------------------ */

test('createLocalTransport：同频道的两条传输互通，自己发的不回自己，关掉后不再收', () => {
  const harness = createRtcHarness();
  const seenA = [];
  const seenB = [];
  const win = harness.win;
  const a = createLocalTransport({ win, roomId: 'r-1', onMessage: (message) => seenA.push(message) });
  const b = createLocalTransport({ win, roomId: 'r-1', onMessage: (message) => seenB.push(message) });

  assert.equal(a.kind, 'local');
  a.post({ type: 'offer', from: 'peer-a' });
  assert.deepEqual(seenB, [{ type: 'offer', from: 'peer-a' }]);
  assert.deepEqual(seenA, [], '自己发的不该回到自己');

  b.post({ type: 'answer', from: 'peer-b' });
  assert.deepEqual(seenA, [{ type: 'answer', from: 'peer-b' }]);

  // 房间号不同 = 频道不同，互不串台
  const other = createLocalTransport({ win, roomId: 'r-2', onMessage: (message) => seenA.push(message) });
  other.post({ type: 'ice' });
  assert.equal(seenA.length, 1);

  a.close();
  b.post({ type: 'ice' });
  assert.equal(seenA.length, 1, '关掉之后不再收');

  assert.equal(createLocalTransport({ win: {}, roomId: 'r-1' }), null, '浏览器不支持时返回 null');
});

test('createRemoteTransport：令牌走 ?token=，内部词汇与线上词汇互译，白名单之外丢弃', () => {
  const harness = createRtcHarness();
  const inbox = [];
  const peers = [];
  const statuses = [];
  const transport = createRemoteTransport({
    win: harness.win,
    url: 'wss://localhost:4173/ws/rooms/r-1',
    token: 'demo-token',
    onMessage: (message) => inbox.push(message),
    onPeer: (event) => peers.push(event),
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(transport.kind, 'remote');
  assert.equal(harness.sockets.length, 1);
  // 浏览器 WebSocket 不能自定义请求头，令牌只能挂在查询串上
  assert.equal(harness.sockets[0].url, 'wss://localhost:4173/ws/rooms/r-1?token=demo-token');

  // open 之前发的先入队；`hello` 是同浏览器档位专用，不上线
  transport.post({ type: 'hello', from: 'peer-a' });
  transport.post({ type: 'offer', from: 'peer-a', sdp: { type: 'offer' } });
  transport.post({ type: 'ice', from: 'peer-a', candidate: { candidate: 'c' } });
  assert.deepEqual(harness.sockets[0].sent, [], '还没 open，一条都不该发');
  harness.sockets[0].open();
  assert.deepEqual(harness.sockets[0].sent, [
    { type: 'rtc:offer', from: 'peer-a', sdp: { type: 'offer' } },
    { type: 'rtc:ice', from: 'peer-a', candidate: { candidate: 'c' } },
  ]);

  // 下行：`rtc:*` 翻译回内部词汇
  harness.sockets[0].message({ type: 'rtc:answer', from: 'peer-b', sdp: { type: 'answer' } });
  harness.sockets[0].message({ type: 'rtc:level', from: 'peer-b', value: 0.5 });
  assert.deepEqual(inbox, [
    { type: 'answer', from: 'peer-b', sdp: { type: 'answer' } },
    { type: 'level', from: 'peer-b', value: 0.5 },
  ]);

  // 坏 JSON / 非对象 / 白名单之外的事件一律丢弃，不打扰上层
  harness.sockets[0].raw('{oops');
  harness.sockets[0].message(null);
  harness.sockets[0].message('just a string');
  harness.sockets[0].message({ type: 'queue:updated' });
  assert.equal(inbox.length, 2);

  // 话题卡同步也是双向翻译：上行 `card` → `room:card`，下行反过来
  transport.post({ type: 'card', from: 'peer-a', cardId: 'anime-beginner-01', index: 2, round: 1 });
  assert.deepEqual(harness.sockets[0].sent.at(-1), {
    type: 'room:card',
    from: 'peer-a',
    cardId: 'anime-beginner-01',
    index: 2,
    round: 1,
  });
  harness.sockets[0].message({ type: 'room:card', from: 'peer-b', cardId: 'food-beginner-01', index: 1, round: 2 });
  assert.deepEqual(inbox.at(-1), { type: 'card', from: 'peer-b', cardId: 'food-beginner-01', index: 1, round: 2 });

  // 第一条 room:ready 的 peerReady 决定谁是发起方
  harness.sockets[0].message({ type: 'room:ready', peerReady: false });
  assert.deepEqual(peers, [], '只有我一个人在房里，什么都不用做');
  harness.sockets[0].message({ type: 'room:ready', peerReady: true });
  assert.deepEqual(peers, [{ present: true, offerer: true }], '我先到 → 我发起');

  harness.sockets[0].message({ type: 'room:peer-left', reason: 'disconnected' });
  assert.deepEqual(peers.at(-1), { present: false });
  harness.sockets[0].message({ type: 'room:ended', durationSec: 600 });
  assert.equal(peers.length, 3, '房间结束也走「对方不在了」这条路径');

  harness.sockets[0].message({ type: 'error', error: { code: 'bad_request' } });
  assert.deepEqual(statuses, ['open', 'error']);

  transport.close();
  assert.equal(harness.sockets[0].closed, true);
  assert.deepEqual(statuses, ['open', 'error', 'closed']);

  // 后到的一方（第一条 room:ready 就是 peerReady:true）不当发起方
  const latePeers = [];
  createRemoteTransport({
    win: harness.win,
    url: 'wss://localhost:4173/ws/rooms/r-1',
    onPeer: (event) => latePeers.push(event),
  });
  harness.sockets[1].open();
  harness.sockets[1].message({ type: 'room:ready', peerReady: true });
  assert.deepEqual(latePeers, [{ present: true, offerer: false }], '我后到 → 我等对方的 offer');
  // 没给令牌就不拼 `?token=`
  assert.equal(harness.sockets[1].url, 'wss://localhost:4173/ws/rooms/r-1');

  assert.equal(createRemoteTransport({ win: harness.win, url: '' }), null, '没有地址就返回 null');
  assert.equal(createRemoteTransport({ win: {}, url: 'wss://x/ws' }), null, '浏览器不支持 WebSocket 就返回 null');
});

/* ------------------------------------------------------------------ *
 * 会话：远端档位
 * ------------------------------------------------------------------ */

test('远端档位：信令全程走 WebSocket，offer 由「先到的那一方」发起', async () => {
  const harness = createRtcHarness();
  const a = harness.session({ peerId: 'peer-a' });
  await a.start();

  assert.equal(a.snapshot().mode, 'remote');
  assert.equal(a.snapshot().hasMic, true);
  assert.equal(harness.sockets.length, 1);
  assert.equal(harness.sockets[0].url, 'wss://localhost:4173/ws/rooms/r-1?token=demo-token');

  // A 先到：收到 peerReady:false，什么都不用做（`hello` 这类内部握手不上线）
  harness.sockets[0].open();
  harness.sockets[0].message({ type: 'room:ready', peerReady: false });
  assert.equal(a.snapshot().peerPresent, false);
  assert.deepEqual(harness.sockets[0].sent, []);

  // B 后到：peerReady:true 说明房里已经有人 → B 等对方的 offer
  const b = harness.session({ peerId: 'peer-b' });
  await b.start();
  harness.sockets[1].open();
  harness.sockets[1].message({ type: 'room:ready', peerReady: true });
  assert.equal(b.snapshot().peerPresent, true);
  assert.deepEqual(harness.sockets[1].sent, [], '后到的一方不发起 offer');

  // 后端把 peerReady:true 广播给房里所有人 → A 才发起
  harness.sockets[0].message({ type: 'room:ready', peerReady: true });
  await harness.settle();
  assert.deepEqual(harness.sockets[0].sent, [
    { type: 'rtc:offer', from: 'peer-a', sdp: { type: 'offer', sdp: 'v=0-offer' } },
  ]);

  // offer 到 B → B 回 answer
  harness.sockets[1].message(harness.sockets[0].sent[0]);
  await harness.settle();
  assert.deepEqual(harness.connections[1].remoteDescriptions, [{ type: 'offer', sdp: 'v=0-offer' }]);
  assert.deepEqual(harness.sockets[1].sent, [
    { type: 'rtc:answer', from: 'peer-b', sdp: { type: 'answer', sdp: 'v=0-answer' } },
  ]);

  // answer 回到 A → A 设成 remoteDescription
  harness.sockets[0].message(harness.sockets[1].sent[0]);
  await harness.settle();
  assert.deepEqual(harness.connections[0].remoteDescriptions, [{ type: 'answer', sdp: 'v=0-answer' }]);

  // ICE 双向原样转发
  harness.connections[0].onicecandidate({ candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0' } });
  assert.deepEqual(harness.sockets[0].sent.at(-1), {
    type: 'rtc:ice',
    from: 'peer-a',
    candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0' },
  });
  harness.sockets[1].message(harness.sockets[0].sent.at(-1));
  await harness.settle();
  assert.deepEqual(harness.connections[1].candidates, [{ candidate: 'candidate:1 1 udp', sdpMid: '0' }]);

  // 对方的音轨到达 → 建一个远端播放元素
  harness.connections[1].remoteTrack(harness.stream);
  assert.equal(harness.audioElements.length, 1);
  assert.equal(harness.audioElements[0].srcObject, harness.stream);
  assert.equal(harness.audioElements[0].played, true);

  // 协商完成 → live
  harness.connections[0].connected();
  assert.equal(a.snapshot().status, 'live');

  // 本端音量来自 analyser（不是模拟波形）
  harness.clock.tick(50);
  assert.ok(a.levels().self > 0.4, '非模拟档位的本端音量应当来自麦克风：' + a.levels().self);

  // 音量同步：跨设备档位靠 rtc:level 把对方的波形画出来
  harness.sockets[1].message({ type: 'rtc:level', from: 'peer-a', value: 0.75 });
  await harness.settle();
  harness.clock.tick(50);
  assert.ok(b.levels().peer > 0.4, '对方的音量应当被平滑成非零值：' + b.levels().peer);

  // 话题卡同步：跨设备「双方看同一张」全靠这条转发（线上叫 room:card，内部叫 card）
  const cards = [];
  const offCard = a.onCard((payload) => cards.push(payload));
  harness.sockets[0].message({ type: 'room:card', from: 'peer-b', cardId: 'food-beginner-01', index: 2, round: 1 });
  await harness.settle();
  assert.deepEqual(cards, [{ cardId: 'food-beginner-01', index: 2, round: 1 }], '载荷原样交给订阅者');

  a.sendCard({ cardId: 'anime-beginner-01', index: 0, round: 3 });
  assert.deepEqual(harness.sockets[0].sent.at(-1), {
    type: 'room:card',
    from: 'peer-a',
    cardId: 'anime-beginner-01',
    index: 0,
    round: 3,
  });
  a.sendCard();
  assert.deepEqual(
    harness.sockets[0].sent.at(-1),
    { type: 'room:card', from: 'peer-a', cardId: null, index: 0, round: 0 },
    '缺参数也不炸（第几叠缺省是第 0 叠）',
  );

  offCard();
  harness.sockets[0].message({ type: 'room:card', from: 'peer-b', cardId: 'music-beginner-01', index: 1, round: 1 });
  await harness.settle();
  assert.equal(cards.length, 1, '退订之后不再收');

  // 对方掉线 → 立刻进降级态，不用等 8 秒超时
  harness.sockets[0].serverClose();
  assert.equal(a.snapshot().status, 'degraded');

  // 对方离开 / 房间结束 → 直接进结算态
  harness.sockets[1].message({ type: 'room:peer-left', reason: 'disconnected' });
  await harness.settle();
  assert.equal(b.snapshot().peerLeft, true);
  assert.equal(b.snapshot().status, 'ended');

  await a.hangup();
  await b.hangup();
  assert.equal(harness.clock.pending(), 0, '挂断之后一个定时器都不该留着');
  assert.equal(harness.track.stopped, true, '麦克风轨道要关掉');
});

test('远端声音被自动播放策略拒掉：要如实标记 + 挂手势重试（「第一次通话听不见」的根因）', async () => {
  const harness = createRtcHarness({ rejectRemotePlay: true });
  const a = harness.session();
  assert.equal(typeof a.resumeAudio, 'function', '页面要能主动重试出声');
  await a.start();

  harness.connections[0].remoteTrack(harness.stream);
  await harness.settle();

  const element = harness.audioElements[0];
  assert.equal(harness.audioElements.length, 1);
  assert.equal(element.played, false, '被拒了就是没出声');
  assert.equal(
    a.snapshot().audioBlocked,
    true,
    '必须把「没出声」如实报给界面——以前这里 `void play()` 静默吞掉，界面还显示已接通',
  );
  assert.equal(harness.document.body.children.length, 1, '播放元素要挂进 DOM，否则 iOS 上根本不播');
  assert.ok(harness.document.has('pointerdown'), '被拒之后必须有手势监听兜住');

  // 用户点一下屏幕：这一次浏览器放行了
  element.rejectPlay = false;
  assert.equal(harness.document.fire('pointerdown'), true, '手势要有人接');
  await harness.settle();
  assert.equal(element.played, true, '手势之后要真的重试成功');
  assert.equal(a.snapshot().audioBlocked, false, '出声之后标记要清掉');
  assert.equal(harness.document.has('pointerdown'), false, '出声之后监听要摘掉');

  await a.hangup();
});

test('手势监听从进房就挂着：音轨到达之前的那一次点击不算白费', async () => {
  const harness = createRtcHarness({ rejectRemotePlay: true });
  const a = harness.session();
  await a.start();

  // 进房就挂上。以前要等 play() 被拒才挂，于是「用户先点了一下、音轨随后才到」这一点被吃掉。
  assert.ok(harness.document.has('pointerdown'), '进房就要挂手势监听，不能等被拒之后才挂');

  // 音轨还没到（播放元素都还没有），用户先点了一下
  assert.equal(harness.audioElements.length, 0, '前提：这一刻音轨还没到');
  assert.equal(harness.document.fire('pointerdown'), true, '这一下要有人接');
  await harness.settle();
  assert.equal(harness.document.has('pointerdown'), true, '还没出声，监听不能被消耗掉');

  // 音轨到了：play() 被拒 → 如实标记 + 继续等手势
  harness.connections[0].remoteTrack(harness.stream);
  await harness.settle();
  const element = harness.audioElements[0];
  assert.equal(a.snapshot().audioBlocked, true, '没出声要如实标记');

  // 用户再点一下，这次浏览器放行
  element.rejectPlay = false;
  harness.document.fire('pointerdown');
  await harness.settle();
  assert.equal(element.played, true, '音轨到达前的那次点击不能白费：再点一下必须能出声');
  assert.equal(a.snapshot().audioBlocked, false, '出声之后标记要清掉');
  assert.equal(harness.document.has('pointerdown'), false, '真正出声之后监听才摘');

  await a.hangup();
});

test('远端声音：一个会话只建一个播放元素，第二次 ontrack 只换 srcObject', async () => {
  const harness = createRtcHarness();
  const a = harness.session();
  await a.start();

  harness.connections[0].remoteTrack(harness.stream);
  const renegotiated = { getTracks: () => [] };
  harness.connections[0].remoteTrack(renegotiated);
  await harness.settle();

  assert.equal(harness.audioElements.length, 1, '重协商不该把正在出声的那个元素换掉');
  assert.equal(harness.audioElements[0].srcObject, renegotiated, '只换音源');

  await a.hangup();
});

test('麦克风波形：AudioContext 起在 suspended 时要 resume（否则自己的音量恒为 0）', async () => {
  const harness = createRtcHarness({ audioContextSuspended: true });
  const a = harness.session();
  await a.start();

  assert.equal(harness.audioContexts[0].resumeCalls, 1, '启动时就要试着恢复上下文');
  assert.equal(harness.audioContexts[0].state, 'running');
  harness.clock.tick(50);
  assert.ok(a.levels().self > 0.4, '恢复之后本端音量才拿得到：' + a.levels().self);

  await a.hangup();
});

test('挂断：播放元素与手势监听一起收掉，不留给下一个房间', async () => {
  const harness = createRtcHarness({ rejectRemotePlay: true });
  const a = harness.session();
  await a.start();
  harness.connections[0].remoteTrack(harness.stream);
  await harness.settle();
  assert.ok(harness.document.has('pointerdown'), '前提：先挂上了手势监听');

  await a.hangup();
  assert.equal(harness.document.has('pointerdown'), false, '手势监听要摘掉');
  assert.equal(harness.audioElements[0].removed, true, '播放元素要从 DOM 上摘掉');
  assert.equal(a.snapshot().audioBlocked, false, '状态也要跟着清掉');
});

test('远端档位拿不到信令地址：退到同浏览器双标签页并挂提示，通话不中断', async () => {
  const harness = createRtcHarness();
  const a = harness.session({ signalUrl: '', peerId: 'peer-a' });
  await a.start();

  assert.equal(a.snapshot().mode, 'local', '实际档位如实反映在状态里');
  assert.equal(a.snapshot().warning, 'remote-signal-missing');
  assert.equal(a.snapshot().hasMic, true);
  assert.equal(harness.sockets.length, 0, '没有地址就不该去连 WebSocket');
  assert.equal(harness.channels.size, 1, '退到 BroadcastChannel');

  await a.hangup();
  assert.equal(harness.clock.pending(), 0);
});

test('远端档位：浏览器不支持 WebSocket 时同样退到同浏览器档位', async () => {
  const harness = createRtcHarness();
  const win = { ...harness.win, WebSocket: undefined };
  const a = createCallSession({
    roomId: 'r-1',
    mode: 'remote',
    win,
    signalUrl: 'wss://localhost:4173/ws/rooms/r-1',
    peerId: 'peer-a',
  });
  await a.start();
  assert.equal(a.snapshot().mode, 'local');
  assert.equal(a.snapshot().warning, 'remote-signal-missing');
  await a.hangup();
});

/* ------------------------------------------------------------------ *
 * 会话：同浏览器档位（回归护栏）
 * ------------------------------------------------------------------ */

test('同浏览器档位：两条会话经 BroadcastChannel 完成 offer / answer', async () => {
  const harness = createRtcHarness();
  // 让 a 的 id 更大：同浏览器档位靠 id 比大小定发起方（远端档位靠 room:ready）
  const a = harness.session({ mode: 'local', peerId: 'peer-b' });
  const b = harness.session({ mode: 'local', peerId: 'peer-a' });
  await a.start();
  await b.start();
  await harness.settle();

  assert.equal(a.snapshot().mode, 'local');
  assert.equal(a.snapshot().peerPresent, true);
  assert.equal(b.snapshot().peerPresent, true);
  assert.equal(harness.sockets.length, 0, '同浏览器档位不该开 WebSocket');
  assert.equal(harness.connections[0].remoteDescriptions.length, 1, 'a 应当收到 answer');
  assert.deepEqual(harness.connections[0].remoteDescriptions[0], { type: 'answer', sdp: 'v=0-answer' });
  assert.deepEqual(harness.connections[1].remoteDescriptions[0], { type: 'offer', sdp: 'v=0-offer' });

  await a.hangup();
  await b.hangup();
  assert.equal(harness.clock.pending(), 0);
});

/* ------------------------------------------------------------------ *
 * 会话：降级与兜底
 * ------------------------------------------------------------------ */

test('浏览器不支持 WebRTC：整场退到模拟通话，并挂上原因', async () => {
  const harness = createRtcHarness();
  const win = { ...harness.win, RTCPeerConnection: undefined };
  const a = createCallSession({ roomId: 'r-1', mode: 'local', win, peerId: 'peer-a' });
  await a.start();

  assert.equal(a.snapshot().mode, 'sim');
  assert.equal(a.snapshot().warning, 'webrtc-unsupported');
  harness.clock.tick(1000);
  assert.equal(a.snapshot().status, 'live', '模拟通话照样能演');

  await a.hangup();
});

test('拒绝麦克风：挂 mic-unavailable，但通话继续（只听不说）', async () => {
  const harness = createRtcHarness({ media: false });
  const a = harness.session({ mode: 'local', peerId: 'peer-a' });
  await a.start();

  assert.equal(a.snapshot().hasMic, false);
  assert.equal(a.snapshot().warning, 'mic-unavailable');
  assert.equal(a.snapshot().mode, 'local', '麦克风拿不到不等于要退到模拟通话');

  await a.hangup();
});

test('用户点了「拒绝」：同样挂 mic-unavailable，连接照常建', async () => {
  const harness = createRtcHarness({ media: 'denied' });
  const a = harness.session({ peerId: 'peer-a' });
  await a.start();

  assert.equal(a.snapshot().hasMic, false);
  assert.equal(a.snapshot().warning, 'mic-unavailable');
  assert.equal(a.snapshot().mode, 'remote');
  assert.equal(harness.connections.length, 1, '没有麦克风也要把连接建起来，才能听对方');

  await a.hangup();
});

test('STUN / TURN 配置：注入的优先，其次是 /api/rtc/ice-servers，最后退到写死的 STUN', async () => {
  const harness = createRtcHarness();

  const injected = harness.session({ iceServers: [{ urls: 'stun:injected.example.com:3478' }] });
  await injected.start();
  assert.deepEqual(harness.connections[0].config.iceServers, [{ urls: 'stun:injected.example.com:3478' }]);
  await injected.hangup();

  let calls = 0;
  const fetched = harness.session({
    loadIceServers: async () => {
      calls += 1;
      return { iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }], expiresAt: null };
    },
  });
  await fetched.start();
  assert.deepEqual(harness.connections[1].config.iceServers, [
    { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' },
  ]);
  assert.equal(calls, 1, '注入的没有才去拉接口');
  await fetched.hangup();

  // 503 / 抛异常 / 空数组都算「没拿到」→ 写死 STUN，通话照起
  const failed = harness.session({
    loadIceServers: async () => {
      throw new Error('503 turn_unavailable');
    },
  });
  await failed.start();
  assert.deepEqual(harness.connections[2].config.iceServers, DEFAULT_ICE_SERVERS);
  await failed.hangup();
});

test('normalizeIceServers：裸数组与信封都接受，空 / 缺 urls 一律算没拿到', () => {
  assert.deepEqual(normalizeIceServers([{ urls: 'stun:x' }]), [{ urls: 'stun:x' }]);
  assert.deepEqual(normalizeIceServers({ iceServers: [{ url: 'stun:y' }] }), [{ url: 'stun:y' }]);
  assert.deepEqual(normalizeIceServers({ iceServers: [{ urls: 'stun:x' }, null] }), [{ urls: 'stun:x' }]);
  assert.equal(normalizeIceServers([]), null);
  assert.equal(normalizeIceServers({ iceServers: [] }), null);
  assert.equal(normalizeIceServers({ iceServers: [{ username: 'u' }] }), null);
  assert.equal(normalizeIceServers(null), null);
  assert.equal(normalizeIceServers(undefined), null);
});

test('档位常量与设置项一致（sim / local / remote）', () => {
  assert.deepEqual(CALL_MODES, ['sim', 'local', 'remote']);
  assert.deepEqual(DEFAULT_ICE_SERVERS, [{ urls: 'stun:stun.l.google.com:19302' }]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRtcHarness } from '../frontend/tests/helpers/rtc-stub.mjs';
import { ChatRoomPage } from '../frontend/src/pages/room.js';
import { createMemoryStorage, createStore } from '../frontend/src/app/store.js';
import { createTranslator } from '../frontend/src/i18n/i18n.js';
import { installDom } from '../frontend/tests/helpers/dom-stub.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('麦克风授权期间收到的 offer 与 ICE 必须等连接准备好再处理', async () => {
  const harness = createRtcHarness();
  const permission = deferred();
  harness.win.navigator.mediaDevices.getUserMedia = () => permission.promise;
  const call = harness.session();
  const starting = call.start();
  const socket = harness.sockets[0];
  socket.open();
  socket.message({ type: 'room:ready', peerReady: true });
  socket.message({ type: 'rtc:offer', from: 'peer-b', sdp: { type: 'offer', sdp: 'early-offer' } });
  socket.message({ type: 'rtc:ice', from: 'peer-b', candidate: { candidate: 'early-candidate' } });
  permission.resolve(harness.stream);
  await starting;
  await harness.settle();
  assert.deepEqual(harness.connections[0].remoteDescriptions, [{ type: 'offer', sdp: 'early-offer' }]);
  assert.deepEqual(harness.connections[0].candidates, [{ candidate: 'early-candidate' }]);
  assert.equal(socket.sent.filter(message => message.type === 'rtc:answer').length, 1);
  await call.hangup();
});

test('ICE 在远端 SDP 之前到达时不能被浏览器拒绝后静默丢失', async () => {
  const harness = createRtcHarness();
  const Base = harness.win.RTCPeerConnection;
  harness.win.RTCPeerConnection = class extends Base {
    async addIceCandidate(candidate) {
      if (!this.remoteDescriptions.length) throw Object.assign(Error('No remote SDP'), { name: 'InvalidStateError' });
      return super.addIceCandidate(candidate);
    }
  };
  const call = harness.session(); await call.start();
  const socket = harness.sockets[0]; socket.open();
  socket.message({ type: 'rtc:ice', from: 'peer-b', candidate: { candidate: 'ice-first' } });
  await harness.settle();
  assert.equal(harness.connections[0].candidates.length, 0);
  socket.message({ type: 'rtc:offer', from: 'peer-b', sdp: { type: 'offer', sdp: 'later-offer' } });
  await harness.settle();
  assert.deepEqual(harness.connections[0].candidates, [{ candidate: 'ice-first' }]);
  await call.hangup();
});

test('远端 SDP 异步应用时，后续 ICE 不能抢先调用浏览器', async () => {
  const harness = createRtcHarness();
  const applied = deferred();
  const Base = harness.win.RTCPeerConnection;
  harness.win.RTCPeerConnection = class extends Base {
    async setRemoteDescription(sdp) { await applied.promise; return super.setRemoteDescription(sdp); }
    async addIceCandidate(candidate) {
      if (!this.remoteDescriptions.length) throw Object.assign(Error('SDP still pending'), { name: 'InvalidStateError' });
      return super.addIceCandidate(candidate);
    }
  };
  const call = harness.session(); await call.start();
  const socket = harness.sockets[0]; socket.open();
  socket.message({ type: 'rtc:offer', from: 'peer-b', sdp: { type: 'offer', sdp: 'slow-sdp' } });
  socket.message({ type: 'rtc:ice', from: 'peer-b', candidate: { candidate: 'during-sdp' } });
  await harness.settle(); applied.resolve(); await harness.settle();
  assert.deepEqual(harness.connections[0].candidates, [{ candidate: 'during-sdp' }]);
  await call.hangup();
});

test('不带 streams 的远端音轨仍能进入持久音频播放器', async () => {
  const harness = createRtcHarness();
  harness.win.MediaStream = class {
    constructor(tracks = []) { this.tracks = [...tracks]; }
    addTrack(track) { this.tracks.push(track); }
    getTracks() { return [...this.tracks]; }
  };
  const call = harness.session(); await call.start();
  const track = { kind: 'audio', id: 'remote-track' };
  harness.connections[0].ontrack({ streams: [], track });
  await harness.settle();
  assert.deepEqual(harness.audioElements[0].srcObject.getTracks(), [track]);
  assert.equal(harness.audioElements[0].played, true);
  await call.hangup();
});

test('授权未完成时挂断，迟到的麦克风不能继续占用或新建连接', async () => {
  const harness = createRtcHarness();
  const permission = deferred();
  harness.win.navigator.mediaDevices.getUserMedia = () => permission.promise;
  const call = harness.session();
  const starting = call.start();
  await call.hangup();
  permission.resolve(harness.stream);
  await starting; await harness.settle();
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.connections.length, 0);
  assert.equal(harness.clock.pending(), 0);
  assert.equal(call.snapshot().status, 'ended');
});

test('真实通话禁用模拟后，不支持 WebRTC 或手动模拟均不能显示已接通', async () => {
  const harness = createRtcHarness();
  delete harness.win.RTCPeerConnection;
  const call = harness.session({ allowSimulation: false });
  await call.start(); harness.clock.tick(10_000);
  assert.equal(call.snapshot().mode, 'remote');
  assert.equal(call.snapshot().status, 'degraded');
  await call.fallbackToSim();
  assert.equal(call.snapshot().mode, 'remote');
  assert.equal(call.snapshot().status, 'degraded');
  await call.hangup();
});

test('重连由最先到达的一方发起，后到的一方只发送重连请求', async () => {
  const firstHarness = createRtcHarness();
  const first = firstHarness.session({ allowSimulation: false }); await first.start();
  const firstSocket = firstHarness.sockets[0]; firstSocket.open();
  firstSocket.message({ type: 'room:ready', peerReady: false });
  firstSocket.message({ type: 'room:ready', peerReady: true });
  await firstHarness.settle();
  const options = [];
  firstHarness.connections[0].createOffer = async value => { options.push(value); return { type: 'offer', sdp: 'restart-offer' }; };
  firstSocket.message({ type: 'rtc:retry', from: 'peer-b' }); await firstHarness.settle();
  assert.deepEqual(options, [{ iceRestart: true }]);
  assert.equal(firstSocket.sent.at(-1).type, 'rtc:offer');

  const laterHarness = createRtcHarness();
  const later = laterHarness.session({ allowSimulation: false }); await later.start();
  const laterSocket = laterHarness.sockets[0]; laterSocket.open();
  laterSocket.message({ type: 'room:ready', peerReady: true }); await laterHarness.settle();
  await later.retryConnection();
  assert.equal(laterSocket.sent.at(-1).type, 'rtc:retry');
  assert.equal(laterSocket.sent.filter(message => message.type === 'rtc:offer').length, 0);
  await first.hangup(); await later.hangup();
});

test('通话检查能区分信令、中继、音轨和收发流量，绝不包含凭证或网络地址', async () => {
  const harness = createRtcHarness();
  const call = harness.session({ token: 'private-token', iceServers: [{ urls: 'turns:private-relay.example:443', username: 'private-user', credential: 'private-password' }] });
  await call.start(); harness.sockets[0].open();
  const pc = harness.connections[0]; pc.connected(); pc.remoteTrack(harness.stream); await harness.settle();
  pc.getStats = async () => new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { type: 'local-candidate', candidateType: 'relay', address: 'private-address' }],
    ['remote', { type: 'remote-candidate', candidateType: 'host', address: 'private-address' }],
    ['sent', { type: 'outbound-rtp', kind: 'audio', bytesSent: 12000 }],
    ['received', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 8000 }],
  ]);
  const report = await call.diagnostics();
  assert.equal(report.signalState, 'open');
  assert.equal(report.turnServers, 1);
  assert.equal(report.remoteTracks, 1);
  assert.equal(report.bytesSent, 12000);
  assert.equal(report.bytesReceived, 8000);
  assert.equal(report.relay, true);
  for (const privateValue of ['private-token', 'private-password', 'private-user', 'private-relay', 'private-address']) assert.equal(JSON.stringify(report).includes(privateValue), false);
  await call.hangup();
});

test('公网房间忽略旧模拟设置，失败按钮重连真实连接并显示安全检查信息', async () => {
  installDom();
  const harness = createRtcHarness();
  const store = createStore({ storage: createMemoryStorage() });
  store.saveSettings({ signalMode: 'sim' });
  store.startRoom({ roomId: 'r-check', role: 'learner', peer: { peerId: 'peer-b', displayName: 'Buddy' } });
  const t = createTranslator('zh-Hans');
  const banners = [];
  const ctx = { store, getState: store.getState, win: harness.win, signalUrl: 'wss://test/ws', allowSimulation: false, demo: false,
    rooms: new Map(), view: {}, api: { getCards: async () => ({ cards: [] }), getIceServers: async () => ({ iceServers: [{ urls: 'turns:example.test:443', username: 'test', credential: 'test' }] }) },
    t, label: (_group, value) => value ?? '', paint() {}, setBanner: banner => banners.push(banner), onCleanup() {},
  };
  ctx.view.data = await ChatRoomPage.load(ctx);
  const call = ctx.view.call;
  assert.equal(call.snapshot().mode, 'remote');
  harness.sockets[0].open();
  harness.sockets[0].message({ type: 'room:ready', peerReady: false });
  harness.sockets[0].message({ type: 'room:ready', peerReady: true }); await harness.settle();
  harness.connections[0].connectionState = 'failed'; harness.connections[0].onconnectionstatechange();
  const banner = banners.at(-1);
  assert.ok(banner.textContent.includes(t('room.reconnect')));
  assert.equal(banner.textContent.includes(t('room.simulated')), false);
  banner.walk().find(node => node.tagName === 'BUTTON').click(); await harness.settle();
  assert.equal(call.snapshot().mode, 'remote');
  const rendered = ChatRoomPage.render(ctx, ctx.view);
  assert.ok(rendered.textContent.includes(t('room.check')));
  rendered.walk().find(node => node.tagName === 'BUTTON' && node.textContent === t('room.checkRefresh')).click(); await harness.settle();
  assert.ok(ctx.view.local.diagnosticsReport.includes('rtc-2026-10-13-2'));
  await call.hangup();
});

test('移动浏览器手势解锁先调用 play，不能等待音频上下文后丢失手势', async () => {
  const harness = createRtcHarness({ rejectRemotePlay: true });
  const call = harness.session(); await call.start();
  harness.connections[0].remoteTrack(harness.stream); await harness.settle();
  assert.equal(call.snapshot().audioBlocked, true);
  const resumed = deferred();
  harness.audioContexts[0].state = 'suspended';
  harness.audioContexts[0].resume = () => resumed.promise;
  let inGesture = true;
  let playedInGesture = false;
  harness.audioElements[0].play = () => {
    playedInGesture = inGesture;
    return inGesture ? Promise.resolve() : Promise.reject(Error('gesture lost'));
  };
  harness.document.fire('pointerdown');
  inGesture = false;
  assert.equal(playedInGesture, true);
  resumed.resolve(); await harness.settle();
  assert.equal(call.snapshot().audioBlocked, false);
  await call.hangup();
});

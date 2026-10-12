/**
 * 房间页 × 通话会话的接线回归。两条都是现场真机踩过的：
 *
 *   1. **通话状态变了，房间页必须重绘** —— 以前订阅回调只在「对方离开 / 降级」时重绘，
 *      于是接通之后界面一直停在「正在建立连接……」，被自动播放策略挡下时那条警告也永远
 *      画不出来：用户既不知道已经接通，也不知道要再点一下才出声。
 *   2. **翻话题卡不能动到通话** —— 滑卡音效自己 `new AudioContext()` 的话，移动端会重新
 *      协商音频会话、把正在播的远端人声打断（「一翻卡声音就断」）。所以音效必须复用通话
 *      那条上下文。
 *
 * 用真 `app` + 真房间页 + 替身 WebRTC：只有媒体栈是假的（Node 里没有 WebRTC）。
 */

import assert from 'node:assert/strict';
import { test, after } from 'node:test';

import { createApp } from '../src/app/app.js';
import { STORAGE_KEY, STORAGE_VERSION, createMemoryStorage, createStore } from '../src/app/store.js';
import { createTranslator } from '../src/i18n/i18n.js';
import { roomStatusKey } from '../src/lib/viewModel.js';
import { createMockApi } from '../src/services/mockApi.js';
import { flush, createWindowStub, installGlobalTimers, restoreGlobalTimers } from './helpers/app-harness.mjs';
import { DEMO_POOL } from './helpers/demoPool.mjs';
import { installDom, StubElement } from './helpers/dom-stub.mjs';
import { createRtcHarness } from './helpers/rtc-stub.mjs';

after(() => restoreGlobalTimers());

const t = createTranslator('zh-Hans');

test('声音开关控制真实远端播放，关闭不影响麦克风，换音轨仍保持关闭', async () => {
  const room = await enterRoom();
  const soundButton = () => room.root.walk().find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === t('room.speaker'));
  soundButton().click(); await flush();
  assert.equal(room.session.snapshot().speakerOn, false);
  room.conn.remoteTrack({ id: 'remote-stream' }); await flush();
  const audio = room.rtc.audioElements[0];
  assert.equal(audio.muted, true, '先关闭再接通也不能突然出声');
  assert.equal(room.rtc.track.enabled, true, '声音开关不关闭自己的麦克风');
  assert.ok(soundButton().textContent.includes(t('room.playbackOff')));
  soundButton().click(); await flush();
  assert.equal(audio.muted, false);
  assert.ok(audio.playCalls >= 2);
  assert.ok(soundButton().textContent.includes(t('room.playbackOn')));
  soundButton().click(); await flush();
  room.conn.remoteTrack({ id: 'replacement-stream' }); await flush();
  assert.equal(room.rtc.audioElements.length, 1);
  assert.equal(audio.muted, true);
  await room.session.hangup();
});

/** 真 app 进一间真房；WebRTC 那一层换成替身，其余（页面 / store / 路由）全是真的。 */
async function enterRoom({ rejectRemotePlay = false } = {}) {
  const doc = installDom();
  const root = new StubElement('div');
  root.setAttribute('id', 'app');
  doc.getElementById = (id) => (id === 'app' ? root : null);

  const win = createWindowStub('#/match');
  installGlobalTimers(win);

  const rtc = createRtcHarness({ mode: 'remote', rejectRemotePlay });
  // 房间页拿的是 ctx.win，`rtc.js` 的媒体能力都挂在它上面；document 也要换成能挂手势监听的那个
  Object.assign(win, {
    WebSocket: rtc.win.WebSocket,
    RTCPeerConnection: rtc.win.RTCPeerConnection,
    Audio: rtc.win.Audio,
    AudioContext: rtc.win.AudioContext,
    navigator: rtc.win.navigator,
    document: rtc.document,
  });

  const storage = createMemoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: STORAGE_VERSION,
      learnerProfile: { onboarded: true },
      buddyProfile: { onboarded: true },
      settings: { signalMode: 'remote' },
    }),
  );
  const store = createStore({ storage });
  store.saveSettings({ mockDelayMs: 0 });
  const app = createApp({
    store,
    api: createMockApi({ store, candidates: DEMO_POOL }),
    doc,
    win,
    signalUrl: 'ws://test/ws',
    webSocket: rtc.win.WebSocket,
  });
  app.start();
  await flush();

  store.startRoom({
    roomId: 'r-1',
    peer: { peerId: 'p-1', displayName: 'Ka-ho', anonymous: false, interests: ['anime'] },
    role: 'learner',
  });
  win.location.hash = '#/room/r-1';
  await flush();

  const session = app.rooms.get('r-1');
  const socket = rtc.sockets.at(-1);
  socket?.open();
  await flush();
  // 对面进来了：远端档位的发起方由后端这条 `room:ready` 决定
  socket?.message({ type: 'room:ready', peerReady: true });
  await flush();

  return { app, store, win, root, rtc, session, socket, conn: rtc.connections.at(-1) };
}

test('通话状态变了房间页就要重绘：接通不再是「正在建立连接」，被挡下要升级成警告', async () => {
  const connecting = t(roomStatusKey({ status: 'connecting', mode: 'remote', hasMic: true, peerLeft: false }));
  const live = t(roomStatusKey({ status: 'live', mode: 'remote', hasMic: true, peerLeft: false }));
  const room = await enterRoom({ rejectRemotePlay: true });
  const statusNode = () => room.root.querySelector('.room-header-meta small')?.textContent;

  assert.equal(statusNode(), connecting, '进房时是「正在建立连接……」');

  room.conn.connected();
  await flush();
  assert.equal(statusNode(), live, '接通之后状态文案要跟着变（这条以前是坏的）');

  room.conn.remoteTrack({ id: 'remote-stream' });
  await flush();
  assert.equal(room.session.snapshot().audioBlocked, true, '前提：play() 被自动播放策略拒了');
  const warning = room.root.querySelector('.call-warning');
  assert.ok(warning, '被挡下时要有警告——只留一句普通提示等于没说');
  assert.ok(warning.textContent.includes(t('room.gesture')), '警告要说清「点一下」这个动作');
});

test('翻话题卡不能动到通话：不挂断、不换播放元素、也不另起一条 AudioContext', async () => {
  const room = await enterRoom();
  room.conn.connected();
  room.conn.remoteTrack({ id: 'remote-stream' });
  await flush();

  const element = room.rtc.audioElements[0];
  assert.equal(element.played, true, '前提：远端声音已经在播');
  const contextCount = room.rtc.audioContexts.length;

  let hangups = 0;
  const original = room.session.hangup.bind(room.session);
  room.session.hangup = async (...args) => {
    hangups += 1;
    return original(...args);
  };

  room.root.querySelectorAll('.stack-nav .btn')[1].click();
  await flush();

  assert.equal(hangups, 0, '翻卡不能把通话挂断');
  assert.equal(room.app.rooms.get('r-1'), room.session, '会话必须还是同一个');
  assert.equal(room.rtc.audioElements[0], element, '播放元素不能换');
  assert.equal(element.removed, undefined, '播放元素不能被摘掉');
  assert.equal(element.paused, false, '翻卡之后远端声音不能停');
  assert.equal(
    room.rtc.audioContexts.length,
    contextCount,
    '滑卡音效必须复用通话那条 AudioContext——新建一条会打断远端人声',
  );
  assert.ok(room.rtc.audioContexts[0].sources.length > 0, '音效要真的播出来，而且走的就是同一条上下文');
});

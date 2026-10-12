#!/usr/bin/env node
/**
 * 双端彩排：把「两台设备真实联通」在 Node 里能验的那一半全验掉。
 *
 *   cd backend && npm run rehearse:rtc          # 默认走局域网地址（最接近手机）
 *   cd backend && npm run rehearse:rtc -- --base https://localhost:4173
 *
 * 不给 `--base` 时的兜底顺序：局域网 `https` → `https://localhost:4173` → `http://localhost:4173`
 * （最后这条是给 Windows 用的：那边找不到 openssl 时 `serve.mjs` 会退回 HTTP）。
 *
 * 与 `smoke:ws` 的区别：smoke 只验「信令通不通」，这个脚本跑的是**两条真的 `rtc.js` 会话**，
 * 各拿一个真 WebSocket 经前端反代连到后端，走完 offer / answer / ICE，并断言两边都进 `live`。
 * 也就是说：除了媒体栈（Node 没有 WebRTC），**两台设备之间会发生的每一步都跑了**。
 *
 * 媒体栈用替身是刻意的取舍：`RTCPeerConnection` 在 Node 里要么装原生依赖、要么装 `wrtc`，
 * 为了一个彩排脚本不值得。真正只有真机才能验的是「浏览器之间能不能打通 P2P」——
 * 那一条只能靠 `npm run preflight:lan` + 两台设备实测。
 *
 * 前置（两个都要在跑）：
 *   cd backend  && npm start                 # 8787
 *   cd frontend && npm run serve             # 4173（HTTPS + /api 反代 + /ws 隧道）
 *
 * 覆盖 `docs/09` 第 4.7 节：步骤 5（实时信令 + ICE）与步骤 7 的兜底项
 * （拒麦克风 / 拔网线 / 对方中途退出 / 刷新丢房 / 令牌失效）。
 */

import './insecure-tls.mjs';

import { WebSocket as NodeWS } from 'ws';

import { createRtcHarness } from '../../frontend/tests/helpers/rtc-stub.mjs';
import { lanAddresses } from '../../frontend/tools/serve.mjs';

const argv = process.argv.slice(2);
function argValue(flag) {
  const at = argv.indexOf(flag);
  if (at >= 0) return argv[at + 1] ?? null;
  const prefixed = argv.find((item) => item.startsWith(flag + '='));
  return prefixed ? prefixed.slice(flag.length + 1) : null;
}

const EXPLICIT_BASE = argValue('--base') ?? process.env.E2E_BASE_URL ?? null;
const WAIT_TIMEOUT_MS = 6000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(ok, label, detail = '') {
  results.push({ ok, label, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '\n        ' + detail : ''));
  return ok;
}

/** 轮询等待：真链路是异步的，固定 sleep 不是太短就是太慢。 */
async function waitFor(label, predicate, { timeoutMs = WAIT_TIMEOUT_MS, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = predicate();
    } catch (error) {
      last = 'predicate 抛了：' + error.message;
    }
    if (last) return last;
    await sleep(intervalMs);
  }
  return check(false, label, '等待超时（' + timeoutMs + 'ms），最后看到：' + JSON.stringify(last));
}

async function request(base, path, { method = 'GET', token = null, body = null } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === null ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

/**
 * 挑一个能用的 base：优先局域网地址（手机走的就是它，顺带验证书 SAN 覆盖不覆盖），
 * 连不上再退回 localhost 并说明原因。
 */
async function pickBase() {
  const candidates = [];
  if (EXPLICIT_BASE) candidates.push(EXPLICIT_BASE.replace(/\/+$/, ''));
  else for (const address of lanAddresses()) candidates.push('https://' + address + ':4173');
  candidates.push('https://localhost:4173');
  // 最后兜一个 http：Windows 上 `serve.mjs` 找不到 openssl 会退回 HTTP
  // （见 `serve.mjs` 的 `opensslCandidates`），不给这条兜底整场彩排都跑不起来。
  candidates.push('http://localhost:4173');

  for (const base of candidates) {
    try {
      const health = await fetch(base + '/api/health');
      if (health.ok) return base;
    } catch {
      // 换下一个
    }
  }
  return null;
}

/** 真 WebSocket 的浏览器形状包装：`rtc.js` 只认 onopen / onmessage / onclose / send / close。 */
function createNodeWebSocketClass({ origin, sockets }) {
  class NodeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.received = [];
      this.error = null;
      this.raw = new NodeWS(url, { origin });
      sockets.push(this);

      this.raw.on('open', () => {
        this.readyState = 1;
        this.onopen?.({});
      });
      this.raw.on('message', (data) => {
        const text = String(data);
        this.received.push(text);
        this.onmessage?.({ data: text });
      });
      this.raw.on('error', (error) => {
        this.error = error;
        this.onerror?.({ message: error.message });
      });
      this.raw.on('close', (code, reason) => {
        this.readyState = 3;
        this.onclose?.({ code, reason: String(reason ?? '') });
      });
    }
    send(text) {
      this.sent.push(JSON.parse(text));
      this.raw.send(text);
    }
    close() {
      try {
        this.raw.close();
      } catch (error) {
        void error;
      }
    }
    /** 拔网线：不打招呼直接掐断，与「对方正常挂断」区分开。 */
    terminate() {
      try {
        this.raw.terminate();
      } catch (error) {
        void error;
      }
    }
  }
  return NodeWebSocket;
}

/** 入队 + 成房，返回一个可用的房间与两个身份的令牌。 */
async function openRoom(base, label) {
  // 每个 drill 各开两台**全新的设备**：账号由 deviceId 决定，编号不同就是两个账号，
  // 也就不会撞上上一场遗留的队列行（那一行已经被摘走了）。
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const buddy = await request(base, '/api/auth/session', {
    method: 'POST',
    body: { role: 'buddy', deviceId: 'device-rehearse-buddy-' + stamp },
  });
  const learner = await request(base, '/api/auth/session', {
    method: 'POST',
    body: { role: 'learner', deviceId: 'device-rehearse-learner-' + stamp },
  });
  const buddyToken = buddy.json?.data?.token;
  const learnerToken = learner.json?.data?.token;
  if (!buddyToken || !learnerToken) {
    throw new Error(label + '：拿不到令牌（' + buddy.status + '/' + learner.status + '）');
  }

  // 学习者那台设备的资料 id：队列行与成房都按它定位（不是写死的 demo id）
  const me = await request(base, '/api/me', { token: learnerToken });
  const learnerPeerId = me.json?.data?.learnerProfile?.userId ?? null;
  if (!learnerPeerId) throw new Error(label + '：拿不到学习者资料 id');

  // 选卡取的是双方兴趣的**交集**（不是并集），所以两边都得点 anime：
  // 学习者这侧挂在入队快照上，母语者这侧只能写资料。交集为空时选卡器只用
  // **通用主题**兜底（beginner 窗口里就 14 张），那样「再来八张」凑不出零交集的新一叠，
  // 下面那条真链路断言会假红 —— 那验的就不是「换叠」了。
  const buddyProfile = await request(base, '/api/me/profile/buddy', {
    method: 'PUT',
    token: buddyToken,
    body: { interests: ['anime'] },
  });
  if (buddyProfile.status !== 200) {
    throw new Error(label + '：写母语者资料失败（' + buddyProfile.status + '）');
  }

  await request(base, '/api/match/queue', {
    method: 'POST',
    token: learnerToken,
    body: { learnerProfileSnapshot: { interests: ['anime'] } },
  });
  const created = await request(base, '/api/rooms', {
    method: 'POST',
    token: buddyToken,
    body: { learnerId: learnerPeerId },
  });
  const roomId = created.json?.data?.roomId;
  if (!roomId) throw new Error(label + '：成房失败（' + created.status + ' ' + JSON.stringify(created.json) + '）');
  return { roomId, buddyToken, learnerToken };
}

/**
 * 起一对会话并把协商跑完 —— 两条真 `rtc.js` 会话、真 WebSocket、真后端。
 *
 * **A 先连上、B 再进**：谁是发起方由「谁先到」定（后端第一条 `room:ready` 的 `peerReady`），
 * 序列化之后才可断言「先到的那一方发 offer」。媒体栈用替身，见文件头。
 *
 * 协商分两段推进，因为 Node 里没有 ICE 栈：
 *   1. **SDP 走真链路**：offer / answer 是真 JSON 经真 WebSocket 往返的，这一段全真。
 *   2. **ICE 打通靠手动**：真机是浏览器自己走完 ICE 后把 `connectionState` 置为 `connected`，
 *      替身不会自己跳，所以在这一步显式推进——它是「ICE 成功」这一事实的替身，
 *      而不是被跳过的一步。candidate 的双向送达另有断言（主流程里发假 candidate）。
 */
async function establishPair(label, { media = true } = {}) {
  const room = await openRoom(base, label);
  const signalUrl = base.replace(/^http/, 'ws') + '/ws/rooms/' + room.roomId;
  const sockets = [];
  allSockets.push(sockets);

  const NodeWebSocket = createNodeWebSocketClass({ origin, sockets });
  const harness = createRtcHarness({ timers: 'real', WebSocket: NodeWebSocket, sockets, media });
  const loadIceServers = (token) => async () => (await request(base, '/api/rtc/ice-servers', { token })).json?.data;

  const a = harness.session({ signalUrl, token: room.buddyToken, peerId: 'peer-a', loadIceServers: loadIceServers(room.buddyToken) });
  await a.start();
  await waitFor(label + '：A 的信令连上（经反代 + /ws 隧道）', () => sockets[0]?.readyState === 1);

  const b = harness.session({ signalUrl, token: room.learnerToken, peerId: 'peer-b', loadIceServers: loadIceServers(room.learnerToken) });
  await b.start();
  await waitFor(label + '：B 的信令连上', () => sockets[1]?.readyState === 1);

  const negotiated = await waitFor(label + '：offer / answer 经真信令往返完成', () => {
    const bothSides = harness.connections.length === 2;
    return (
      bothSides &&
      sockets[0].sent.some((message) => message.type === 'rtc:offer') &&
      sockets[1].sent.some((message) => message.type === 'rtc:answer') &&
      harness.connections[0].remoteDescriptions.length === 1 &&
      harness.connections[1].remoteDescriptions.length === 1
    );
  });
  if (!negotiated) {
    throw new Error(label + '：SDP 没走完（连接数 ' + harness.connections.length + '，A 收到 ' + harness.connections[0]?.remoteDescriptions.length + ' 份，B 收到 ' + harness.connections[1]?.remoteDescriptions.length + ' 份）');
  }

  // 第 2 段：ICE 打通（真机由浏览器完成，这里手动推进替身）
  for (const connection of harness.connections) connection.connected();

  const live = await waitFor(label + '：两边都进 live', () => a.snapshot().status === 'live' && b.snapshot().status === 'live');
  if (!live) throw new Error(label + '：两条会话没到 live（' + a.snapshot().status + ' / ' + b.snapshot().status + '）');

  return { ...room, signalUrl, sockets, harness, a, b };
}

/** 探一次握手结果：被拒时后端回的是带错误码的 HTTP 响应，不是裸断开。 */
function handshakeStatus(url, { token, origin }) {
  return new Promise((resolve) => {
    const socket = new NodeWS(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { origin });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.terminate();
      } catch (error) {
        void error;
      }
      resolve(value);
    };
    socket.on('unexpected-response', (_request, response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        let code = null;
        try {
          code = JSON.parse(body).error?.code ?? null;
        } catch {
          code = null;
        }
        done({ status: response.statusCode, code });
      });
    });
    socket.on('open', () => done({ status: 101, code: null }));
    socket.on('error', (error) => done({ status: 0, code: error.message }));
    setTimeout(() => done({ status: 0, code: 'timeout' }), WAIT_TIMEOUT_MS);
  });
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

const allSockets = [];

const base = await pickBase();
if (!base) {
  console.error('\n连不上前端（试过局域网地址、https://localhost:4173 与 http://localhost:4173）。');
  console.error('先把两个服务起起来：');
  console.error('  cd backend  && npm start');
  console.error('  cd frontend && npm run serve');
  process.exit(1);
}
const origin = base;
console.log('== 双端彩排（两条真 rtc.js 会话走真信令） ==');
console.log('base：' + base + (base.includes('localhost') ? '（回退到本机，手机路径未验）' : '（局域网地址，与手机同一条路）'));
console.log('');

try {
  /* ---------- 1. 正常协商：offer / answer / ICE / 音量 / live ---------- */
  const main = await establishPair('主房');
  console.log('主房：' + main.roomId);
  console.log('');

  check(main.a.snapshot().mode === 'remote' && main.b.snapshot().mode === 'remote', '两条会话都跑在远端档位', 'mode=' + main.a.snapshot().mode + ' / ' + main.b.snapshot().mode);

  await waitFor('A（先到）发出 rtc:offer', () => main.sockets[0].sent.some((m) => m.type === 'rtc:offer'));
  await waitFor('B 回了 rtc:answer', () => main.sockets[1].sent.some((m) => m.type === 'rtc:answer'));
  const offer = main.sockets[0].sent.find((m) => m.type === 'rtc:offer');
  check(offer?.from === 'peer-a' && offer?.sdp?.type === 'offer', '发起方是先到的那一方（不是靠 id 比大小）', 'offer.from=' + offer?.from);
  check(
    main.harness.connections[0].remoteDescriptions[0]?.type === 'answer' &&
      main.harness.connections[1].remoteDescriptions[0]?.type === 'offer',
    'description 方向正确（A 收 answer、B 收 offer）',
  );

  // ICE：两端各自把 candidate 经信令送到对方
  main.harness.connections[0].onicecandidate({ candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host' } });
  main.harness.connections[1].onicecandidate({ candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host' } });
  await waitFor('ICE candidate 双向到达', () => main.harness.connections[0].candidates.length === 1 && main.harness.connections[1].candidates.length === 1);
  check(main.harness.connections[0].candidates[0].candidate.includes('10.0.0.2'), 'A 收到的是 B 的 candidate');
  check(main.harness.connections[1].candidates[0].candidate.includes('10.0.0.1'), 'B 收到的是 A 的 candidate');
  check(main.a.snapshot().status === 'live' && main.b.snapshot().status === 'live', '两条会话都到 live（等同两台设备接通）', 'A=' + main.a.snapshot().status + ' / B=' + main.b.snapshot().status);

  // 音量同步：live 之后 A 才会开始上报自己的真实音量，经 rtc:level 送到 B。
  // 这是跨设备档位唯一的波形来源（那边没有 BroadcastChannel 可以本地互看）。
  await waitFor('A 开始上报音量', () => main.sockets[0].sent.some((m) => m.type === 'rtc:level' && m.value > 0), { timeoutMs: 3000 });
  const lastLevel = main.sockets[0].sent.filter((m) => m.type === 'rtc:level').at(-1);
  check(lastLevel?.value > 0, 'A 把本端麦克风音量经 rtc:level 报出去了', 'value=' + lastLevel?.value);
  await waitFor('B 的音量条跟着动', () => main.b.levels().peer > 0, { timeoutMs: 3000 });
  check(main.b.levels().peer > 0, 'B 看到的对方音量非零', 'peer=' + main.b.levels().peer.toFixed(3));

  // 话题卡同步（「双方看同一张」）：A 翻卡 → 经真信令转发 → B 收到同一张。
  // 这条推送路径只有单测里的假 socket 是不够的，必须在真链路（真 WebSocket + 真反代）上走一遍。
  // 用**这间房真实的第 3 张卡**，不写死 id：牌堆顺序一变（比如选卡器改了发牌方式），
  // 写死的 id 会和实际脱节，断言就变成了自说自话。
  const deck = await request(base, '/api/rooms/' + main.roomId + '/cards', { token: main.buddyToken });
  const first = deck.json?.data?.cards ?? [];
  const third = first[2] ?? null;
  check(
    typeof third?.id === 'string' && third.id.length > 0,
    '取到房间真实牌堆的第 3 张（供同步演练用）',
    'status=' + deck.status + ' card=' + (third?.id ?? 'null'),
  );
  // 换一叠（「再来八张」）：同一间房 round + 1、把看过的 8 张 exclude 掉，
  // 真链路上应当换回**一叠完全不同的卡** —— 这条只有真后端 + 真卡池才验得出来。
  const next = await request(
    base,
    '/api/rooms/' + main.roomId + '/cards?round=1&exclude=' + encodeURIComponent(first.map((card) => card.id).join(',')),
    { token: main.buddyToken },
  );
  const nextIds = (next.json?.data?.cards ?? []).map((card) => card.id);
  check(
    next.json?.data?.round === 1 &&
      nextIds.length === 8 &&
      nextIds.every((id) => !first.some((card) => card.id === id)),
    '「再来八张」在真链路上换回一叠全新的卡（round=1 且与第 0 叠零交集）',
    'round=' + next.json?.data?.round + ' cards=' + JSON.stringify(nextIds),
  );
  const cardsAtB = [];
  main.b.onCard((payload) => cardsAtB.push(payload));
  main.a.sendCard({ cardId: third?.id ?? null, index: 2, round: 1 });
  await waitFor('A 翻的话题卡经信令到达 B', () => cardsAtB.length > 0, { timeoutMs: 3000 });
  check(
    typeof cardsAtB[0]?.cardId === 'string' &&
      cardsAtB[0].cardId === third?.id &&
      cardsAtB[0]?.index === 2 &&
      cardsAtB[0]?.round === 1,
    '话题卡同步：A 翻到第 3 张，B 收到同一条（id、序号与「第几叠」都在）',
    JSON.stringify(cardsAtB[0] ?? null),
  );
  check(
    !main.sockets[0].sent.some((m) => m.type === 'room:card' && m.from === 'peer-b'),
    '转发不回给发送方（A 没收到自己发的那条）',
  );

  // 远端音轨到达 → 建播放元素
  main.harness.connections[1].remoteTrack(main.harness.stream);
  check(
    main.harness.audioElements.length === 1 &&
      main.harness.audioElements[0].srcObject === main.harness.stream &&
      main.harness.audioElements[0].played === true,
    '对方音轨到达后建了播放元素并 play()',
  );

  await main.a.hangup();
  await main.b.hangup();

  /* ---------- 2. 兜底彩排（每个 drill 各开一个干净的房） ---------- */
  console.log('');

  // 2.1 对方中途退出：B 挂断 → A 立刻知道，不用等 8 秒超时
  const quit = await establishPair('对方退出房');
  await quit.b.hangup();
  await waitFor('对方挂断后 A 立刻进结算态', () => quit.a.snapshot().peerLeft && quit.a.snapshot().status === 'ended');
  check(quit.a.snapshot().peerLeft && quit.a.snapshot().status === 'ended', '① 对方中途退出：A 收到 peerLeft 并进结算态', 'status=' + quit.a.snapshot().status);
  await quit.a.hangup();

  // 2.2 自己拔网线：信令被硬掐 → 降级 → 一键切模拟通话继续演
  const dropped = await establishPair('拔网线房');
  dropped.sockets[0].terminate();
  await waitFor('拔网线后 A 进降级态', () => dropped.a.snapshot().status === 'degraded');
  check(dropped.a.snapshot().status === 'degraded', '② 自己拔网线：A 进 degraded，页面会给「切到模拟通话」的出路');
  await dropped.a.fallbackToSim();
  check(dropped.a.snapshot().mode === 'sim' && dropped.a.snapshot().status === 'live', '② 降级后一键切模拟通话仍然能演', 'mode=' + dropped.a.snapshot().mode + ' status=' + dropped.a.snapshot().status);
  await dropped.a.hangup();
  await dropped.b.hangup();

  // 2.3 拒麦克风：麦克风被拒也要连上（只听不说）
  const mic = await establishPair('拒麦克风房', { media: 'denied' });
  check(mic.a.snapshot().hasMic === false && mic.a.snapshot().warning === 'mic-unavailable', '③ 拒麦克风：挂 mic-unavailable');
  check(mic.a.snapshot().mode === 'remote', '③ 拒麦克风不等于放弃远端档位', 'mode=' + mic.a.snapshot().mode);
  check(mic.a.snapshot().status === 'live', '③ 拒麦克风后照样接通（只听不说）', 'status=' + mic.a.snapshot().status);
  await mic.a.hangup();
  await mic.b.hangup();

  // 2.4 刷新丢房：房间号不存在时 REST 与信令都要明确报错，不能静默连上
  const missingRoom = 'r-does-not-exist-' + Date.now();
  const goneRest = await request(base, '/api/rooms/' + missingRoom, { token: main.buddyToken });
  check(goneRest.status === 404 && goneRest.json?.error?.code === 'room_gone', '④ 刷新丢房：GET /api/rooms/<不存在> → 404 room_gone', 'status=' + goneRest.status);
  const goneWs = await handshakeStatus(base.replace(/^http/, 'ws') + '/ws/rooms/' + missingRoom, { token: main.buddyToken, origin });
  check(goneWs.status === 404 && goneWs.code === 'room_gone', '④ 房间不存在时信令握手回 404 room_gone', JSON.stringify(goneWs));

  // 2.5 令牌失效：坏令牌必须 401，不能靠「连上就完事」
  const badToken = await handshakeStatus(base.replace(/^http/, 'ws') + '/ws/rooms/' + main.roomId, { token: 'not-a-real-token', origin });
  check(badToken.status === 401 && badToken.code === 'not_authorized', '⑤ 令牌失效时信令握手回 401 not_authorized', JSON.stringify(badToken));
} catch (error) {
  check(false, '脚本异常：' + (error?.message ?? String(error)));
} finally {
  for (const group of allSockets) for (const socket of group) socket.terminate?.();
  await sleep(150);
}

const failed = results.filter((item) => !item.ok);
console.log(`\n== 双端彩排 ${results.length - failed.length}/${results.length} 通过 ==`);
if (failed.length > 0) {
  for (const item of failed) console.log('  ✗ ' + item.label);
  process.exitCode = 1;
}

// 显式收尾：`ws` 的底层句柄与会话的音量轮询（真 `setInterval`）都会把事件循环挂住，
// 断言已经全部跑完，不靠事件循环自然排空——否则脚本「跑完不退出」，外层 `| tail` 也永远不吐字。
process.exit(process.exitCode ?? 0);

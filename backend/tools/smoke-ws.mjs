#!/usr/bin/env node
/**
 * 真链路信令冒烟：**浏览器要走的那条路**——前端 HTTPS 反代 → 后端 WebSocket。
 *
 *   cd backend && npm run smoke:ws
 *
 * 为什么不能只靠 `npm test` 里的 `tests/ws.test.mjs`：那个测试直连后端，
 * 走的是 `ws://127.0.0.1:8787`。而真实浏览器走的是
 *   `wss://localhost:4173/ws/match?token=...` → `serve.mjs` 的 `/ws` 隧道 → 后端 8787
 * 中间隔着一个**字节级升级隧道**，Origin 也从 `http://localhost:4173` 变成
 * `https://localhost:4173`（后端白名单要认得它）。这一层只有真起两个服务才验得到。
 *
 * 前置（两个都要在跑）：
 *   cd backend  && npm start                 # 8787
 *   cd frontend && npm run serve             # 4173（HTTPS + /api 反代 + /ws 隧道）
 *
 * 自签证书会让 node 的 fetch / ws 拒绝握手，所以脚本内部**只给这一次运行**关掉校验
 * （见 `insecure-tls.mjs`：为什么这条不能写成 npm script 的行内环境变量）。
 *
 * 参数：`--base https://localhost:4173`（也可以用 `E2E_BASE_URL`）。
 * 不给就自己挑：先试 `https://localhost:4173`，连不上再试 `http://localhost:4173`
 * —— Windows 上找不到 openssl 时 `serve.mjs` 会退回 HTTP，不试 http 这里会一项都跑不过。
 */

import './insecure-tls.mjs';

import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
function argValue(flag) {
  const at = argv.indexOf(flag);
  if (at >= 0) return argv[at + 1] ?? null;
  const prefixed = argv.find((item) => item.startsWith(flag + '='));
  return prefixed ? prefixed.slice(flag.length + 1) : null;
}

const EXPLICIT_BASE = argValue('--base') ?? process.env.E2E_BASE_URL ?? null;

/**
 * 挑一个能用的 base：**先 https，连不上再试 http**。
 *
 * 为什么要试 http：Windows 上 `serve.mjs` 找不到 openssl 时会退回 HTTP
 * （见 `serve.mjs` 的 `opensslCandidates`），这时写死 `https://localhost:4173`
 * 会让整条自检一项都过不了，而现象只是「连不上」，很难查。
 * 显式给了 `--base` 就照给的用、不做探测 —— 那是调用方点名要验的地址。
 */
async function pickBase() {
  if (EXPLICIT_BASE) return EXPLICIT_BASE.replace(/\/+$/, '');
  for (const base of ['https://localhost:4173', 'http://localhost:4173']) {
    try {
      const health = await fetch(base + '/api/health');
      if (health.ok) return base;
    } catch {
      // 换下一个
    }
  }
  return 'https://localhost:4173'; // 两个都不通：保留旧默认，让下面的断言去报「连不上」
}

const BASE = await pickBase();
const ORIGIN = BASE;
const WAIT_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(ok, label) {
  results.push({ ok, label });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
}

async function request(method, path, { token, body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

const post = (path, options) => request('POST', path, options);
const get = (path, options) => request('GET', path, options);

/** 两台设备两个账号：账号由 `deviceId` 决定，和现场两台手机一模一样。 */
const BUDDY_DEVICE = 'device-smoke-ws-buddy';
const LEARNER_DEVICE = 'device-smoke-ws-learner';

/** 连一条信令，收到的消息攒进 `inbox`。 */
function connect(path, token) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}${path}?token=${token}`, {
    headers: { origin: ORIGIN },
  });
  const inbox = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
  ws.on('error', () => {
    // 握手失败会在下面的 waitOpen 里体现，这里只是别让未处理的 error 掀翻进程
  });
  return {
    ws,
    inbox,
    open: new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
  };
}

const has = (client, type, predicate = () => true) =>
  client.inbox.some((message) => message.type === type && predicate(message));

try {
  // 0. 先探活，给出人话的提示（不然只会看到一串 ECONNREFUSED）
  try {
    const health = await fetch(BASE + '/api/health');
    check(health.ok, `前端反代探活：GET ${BASE}/api/health → ${health.status}`);
  } catch (error) {
    console.error(`\n连不上 ${BASE}（${error.message}）。`);
    console.error('先把两个服务起起来：');
    console.error('  cd backend  && npm start');
    console.error('  cd frontend && npm run serve');
    process.exitCode = 1;
    process.exit(1);
  }

  // 1. REST 经反代（同源，无 CORS、无混合内容）
  const buddySession = await post('/api/auth/session', {
    body: { role: 'buddy', deviceId: BUDDY_DEVICE },
  });
  const learnerSession = await post('/api/auth/session', {
    body: { role: 'learner', deviceId: LEARNER_DEVICE },
  });
  const buddyToken = buddySession.json.data.token;
  const learnerToken = learnerSession.json.data.token;
  check(buddySession.status === 201 && learnerSession.status === 201, 'REST 经反代：两台设备都能拿到令牌');
  check(
    buddySession.json.data.userId !== learnerSession.json.data.userId,
    '两台设备是两个账号（不是同一个 demo 账号）',
  );

  // 1b. 学习者那台设备填好资料并进队列——「列表里只有真注册过的人」就靠这一步
  const learnerMe = await get('/api/me', { token: learnerToken });
  const learnerPeerId = learnerMe.json.data.learnerProfile.userId;

  // 2. wss 握手经反代（Origin 从 http 变成 https，后端白名单要认得）
  const buddy = connect('/ws/match', buddyToken);
  await buddy.open;
  check(true, `wss 经反代：${BASE}/ws/match 握手成功（Origin + 令牌两道都过）`);
  await sleep(WAIT_MS);
  check(has(buddy, 'queue:updated'), '连上就收到 queue:updated（隧道是双向的）');

  // 3. 成房 → 被摘的人收到定向推送，另一个人收不到
  await post('/api/match/queue', {
    token: learnerToken,
    body: { learnerProfileSnapshot: { interests: ['anime'] } },
  });
  await sleep(WAIT_MS);
  check(
    has(buddy, 'queue:updated', (m) => m.entries.some((entry) => entry.peerId === learnerPeerId)),
    '学习者入队后，母语者那台设备的列表里立刻出现他（推送，不用轮询）',
  );
  const learner = connect('/ws/match', learnerToken);
  await learner.open;
  await sleep(WAIT_MS);
  buddy.inbox.length = 0;
  learner.inbox.length = 0;

  const created = await post('/api/rooms', { token: buddyToken, body: { learnerId: learnerPeerId } });
  check(created.status === 201, `POST /api/rooms → ${created.status}`);
  await sleep(WAIT_MS);
  check(has(learner, 'match:matched'), '学习者收到 match:matched');
  check(
    !has(buddy, 'match:matched'),
    '母语者没有收到 match:matched（摘人的那一侧不用给自己弹框）',
  );

  // 4. 房间频道：ready / 转发 / 不回给自己
  const roomId = created.json.data.roomId;
  const roomA = connect(`/ws/rooms/${roomId}`, buddyToken);
  const roomB = connect(`/ws/rooms/${roomId}`, learnerToken);
  await Promise.all([roomA.open, roomB.open]);
  await sleep(WAIT_MS);
  check(
    has(roomA, 'room:ready', (m) => m.peerReady === true) && has(roomB, 'room:ready', (m) => m.peerReady === true),
    '房内两条连接都收到 room:ready{peerReady:true}',
  );

  roomA.ws.send(JSON.stringify({ type: 'rtc:offer', from: 'a', sdp: { type: 'offer', sdp: 'v=0' } }));
  await sleep(WAIT_MS);
  check(has(roomB, 'rtc:offer'), 'rtc:offer 转发到房内另一方');
  check(!has(roomA, 'rtc:offer'), 'rtc:offer 没有回给发送方');

  // 5. 结算 → 另一端跟着跳结算页
  const end = await post(`/api/rooms/${roomId}/end`, {
    token: buddyToken,
    body: { durationSec: 600, cardsUsed: 2 },
  });
  await sleep(WAIT_MS);
  check(end.status === 200, `POST /api/rooms/:roomId/end → ${end.status}`);
  check(has(roomB, 'room:ended', (m) => m.durationSec === 600), '结算后另一端收到 room:ended');

  // 6. 一方挂断 → 另一方立刻知道
  roomA.ws.close();
  await sleep(WAIT_MS);
  check(has(roomB, 'room:peer-left'), '一方断开后另一方收到 room:peer-left');

  for (const client of [buddy, learner, roomB]) client.ws.close();
  await sleep(200);
} catch (error) {
  check(false, '脚本异常：' + (error?.message ?? String(error)));
}

const failed = results.filter((item) => !item.ok);
console.log(`\n== 真链路信令冒烟 ${results.length - failed.length}/${results.length} 通过 ==`);
if (failed.length > 0) {
  for (const item of failed) console.log('  ✗ ' + item.label);
  process.exitCode = 1;
}

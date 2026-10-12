/**
 * 实时信令（`/ws/match`、`/ws/rooms/:roomId`）——契约 09 第 3.3 节 / 10 第 5 节。
 *
 * 分两段：
 *   1. **纯函数**：频道解析、握手取令牌、上行消息白名单、连接登记簿。
 *      这些是「最容易写错、也最该被钉住」的判定逻辑，不需要 socket 就能测。
 *   2. **端到端**：真起一个服务、真连 WebSocket，把成房 → 推事件 → 信令转发 → 挂断走一遍。
 *      握手拒绝必须**看到 HTTP 状态码**（403 / 401 / 404），只断言「连不上」是测不出原因的。
 *
 * 这个文件盯住四条容易错的：
 *   1. **Origin 带了就必须在白名单里**（没带 = 非浏览器客户端，放行 —— 浏览器一定带，伪造不了）；
 *   2. **转发绝不回给发送方**（回给自己会让前端把本地 description 当成对方的再设一遍）；
 *   3. **定向推送按 `(账号, 身份)` 过滤** —— 一个账号有 learner / buddy 两种身份，
 *      只按账号过滤会把「学习者该弹的接受框」推到母语者那台设备上；
 *   4. **信令出问题不能拖垮 REST**（`emit` 吞异常）。
 *
 * 端到端那段用的是**两个不同账号**（两台设备各一个 `deviceId`），和现场两台手机一模一样：
 * 推送必须精确落到「该弹框的那一台」上，落错一台在单账号的旧演示里根本看不出来。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WebSocket } from 'ws';

import { createHub } from '../src/ws/hub.js';
import {
  MATCH_CHANNEL,
  MATCH_UPSTREAM,
  ROOM_RELAY,
  parseChannel,
  parseClientMessage,
  readHandshakeToken,
  roomChannel,
} from '../src/ws/protocol.js';
import { createEventBridge } from '../src/ws/signaling.js';
import { registerWithProfile } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

const ORIGIN = 'http://localhost:4173';

/* ==========================================================================
 * 1. 纯函数
 * ========================================================================== */

test('parseChannel：只认两条频道，认不出返回 null', () => {
  assert.deepEqual(parseChannel('/ws/match'), { kind: 'match', channel: MATCH_CHANNEL, roomId: null });
  assert.deepEqual(parseChannel('/ws/rooms/r-demo-1'), {
    kind: 'room',
    channel: '/ws/rooms/r-demo-1',
    roomId: 'r-demo-1',
  });

  // 认不出的必须回 null（调用方据此回 404），不能悄悄当成 match 频道
  for (const path of ['/ws', '/ws/', '/ws/match/', '/ws/rooms', '/ws/rooms/', '/ws/rooms/a/b', '/api/health', '']) {
    assert.equal(parseChannel(path), null, `${path} 不该被认成频道`);
  }
});

test('readHandshakeToken：查询串优先，其次 Authorization 头', () => {
  const url = new URL('ws://x/ws/match?token=abc123');
  assert.equal(readHandshakeToken({ url: '/ws/match?token=abc123', headers: {} }, url), 'abc123');
  assert.equal(readHandshakeToken({ headers: { authorization: 'Bearer  from-header  ' } }), 'from-header');
  assert.equal(readHandshakeToken({ url: '/ws/match', headers: {} }), null);
  assert.equal(readHandshakeToken({ headers: { authorization: 'Basic nope' } }), null);
  // 空 token 不算令牌，否则 `?token=` 会绕过 401
  assert.equal(readHandshakeToken({ url: '/ws/match?token=', headers: {} }, new URL('ws://x/ws/match?token=')), null);
});

test('parseClientMessage：坏 JSON / 非对象 / 缺 type / 类型不在白名单都拦下', () => {
  assert.equal(parseClientMessage('{"type":"rtc:offer"}', ROOM_RELAY).ok, true);
  assert.equal(parseClientMessage(Buffer.from('{"type":"rtc:ice"}'), ROOM_RELAY).ok, true);
  // 音量同步也是白名单内的信令：跨设备档位没有 BroadcastChannel，只能靠它画对方波形
  assert.equal(parseClientMessage('{"type":"rtc:level","value":0.5}', ROOM_RELAY).ok, true);
  assert.equal(parseClientMessage('{"type":"room:card","cardId":"x","index":1}', ROOM_RELAY).ok, true);

  assert.equal(parseClientMessage('{oops', ROOM_RELAY).code, 'bad_request');
  assert.equal(parseClientMessage('[1,2]', ROOM_RELAY).code, 'bad_request');
  assert.equal(parseClientMessage('"just a string"', ROOM_RELAY).code, 'bad_request');
  assert.equal(parseClientMessage('{"sdp":"x"}', ROOM_RELAY).code, 'bad_request');
  assert.equal(parseClientMessage('', ROOM_RELAY).code, 'bad_request');

  // 白名单：`/ws/match` 上不许出现转发类信令，房间频道上不许出现队列类信令
  const relayOnMatch = parseClientMessage('{"type":"rtc:offer"}', MATCH_UPSTREAM);
  assert.equal(relayOnMatch.ok, false);
  assert.match(relayOnMatch.message, /unsupported message type/);
  assert.equal(parseClientMessage('{"type":"queue:joined"}', ROOM_RELAY).ok, false);

  // 通过校验的消息**原样**带出来，信令层不碰 candidate / sdp 的形状
  const message = { type: 'rtc:ice', candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0' } };
  assert.deepEqual(parseClientMessage(JSON.stringify(message), ROOM_RELAY).message, message);
});

test('Hub：按频道登记、转发排除发送方、按 (账号, 身份) 定向', () => {
  const hub = createHub();
  const sent = [];
  const make = (userId, role, tag) => ({
    userId,
    role,
    send: (message) => {
      sent.push([tag, message.type]);
      return true;
    },
  });

  const learner = make('demo-01', 'learner', 'L');
  const buddy = make('demo-01', 'buddy', 'B');
  const other = make('someone-else', 'learner', 'X');
  hub.register(MATCH_CHANNEL, learner);
  hub.register(MATCH_CHANNEL, buddy);
  hub.register(MATCH_CHANNEL, other);

  assert.equal(hub.size(MATCH_CHANNEL), 3);

  // 广播：所有人都收到
  sent.length = 0;
  hub.broadcast(MATCH_CHANNEL, { type: 'match:taken' });
  assert.deepEqual(sent.map(([tag]) => tag).sort(), ['B', 'L', 'X']);

  // 排除发送方：转发信令绝不能回给自己
  sent.length = 0;
  hub.broadcast(MATCH_CHANNEL, { type: 'rtc:offer' }, { except: new Set([learner]) });
  assert.deepEqual(sent.map(([tag]) => tag).sort(), ['B', 'X']);

  // 定向：同一个账号的两种身份必须分得开（一台设备两个身份，账号是同一个）
  sent.length = 0;
  assert.equal(hub.sendTo(MATCH_CHANNEL, { userId: 'demo-01', role: 'learner' }, { type: 'match:matched' }), 1);
  assert.deepEqual(sent, [['L', 'match:matched']]);

  sent.length = 0;
  assert.equal(hub.sendTo(MATCH_CHANNEL, { userId: 'nobody', role: 'learner' }, { type: 'match:matched' }), 0);
  assert.deepEqual(sent, []);

  // 注销后空频道要清掉，不然进程里会一直长
  hub.unregister(MATCH_CHANNEL, learner);
  hub.unregister(MATCH_CHANNEL, buddy);
  hub.unregister(MATCH_CHANNEL, other);
  assert.equal(hub.size(MATCH_CHANNEL), 0);
  assert.deepEqual(hub.channels(), []);
});

test('createEventBridge：信令抛异常不能冒泡到 REST', () => {
  const boom = {
    clients: () => {
      throw new Error('信令层炸了');
    },
    size: () => 0,
    sendTo: () => {
      throw new Error('信令层炸了');
    },
    broadcast: () => {
      throw new Error('信令层炸了');
    },
  };
  const bridge = createEventBridge({ db: {}, hub: boom });
  // 全部返回 0 而不是抛出去：一次成功的成房不该因为推不动消息变成 500
  assert.equal(bridge.emit('queue:updated'), 0);
  assert.equal(bridge.emit('match:matched', { accountId: 'demo-01' }), 0);
  assert.equal(bridge.emit('match:taken', { learnerId: 'lucas' }), 0);
  assert.equal(bridge.emit('room:ended', { roomId: 'r-1' }), 0);
  // 不认识的事件名也不该炸
  assert.equal(bridge.emit('nope', {}), 0);
});

/* ==========================================================================
 * 2. 端到端：真服务 + 真 WebSocket
 * ========================================================================== */

/** 连一条信令。收件箱 + 等待队列，方便按类型取消息（`queue:updated` 总是先到）。 */
function connect(url, { origin = ORIGIN } = {}) {
  const ws = new WebSocket(url, { headers: origin ? { origin } : {} });
  const inbox = [];
  const waiters = [];

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else inbox.push(message);
  });
  ws.on('error', () => {
    // 握手被拒的用例走 connectExpectReject，这里只是别让未处理的 error 掀翻进程
  });

  const client = {
    ws,
    send(message) {
      ws.send(typeof message === 'string' ? message : JSON.stringify(message));
    },

    /**
     * 取下一条消息。
     *
     * **超时必须把等待者摘掉**：留在队列里的话，下一条真正到达的消息会被塞进
     * 一个已经 reject 的 promise（静默丢失），后面的等待就会莫名其妙地超时 ——
     * 这类「消息被吞掉」的假故障最能耗时间。
     */
    next(timeoutMs = 2000) {
      if (inbox.length > 0) return Promise.resolve(inbox.shift());
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject,
        };
        const timer = setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`等信令消息超时（${timeoutMs}ms）`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },

    /** 等一条**指定类型**的消息，途中的其它消息丢掉。 */
    async nextOfType(type, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('等 ' + type + ' 超时（期间只收到别的消息）');
        let message;
        try {
          message = await client.next(remaining);
        } catch {
          throw new Error('等 ' + type + ' 超时（期间只收到别的消息）');
        }
        if (message.type === type) return message;
      }
    },

    /**
     * 收满 `count` 条消息再断言。
     *
     * 为什么需要它：一个动作往往**同时**推出好几条（成房会推 `queue:updated` +
     * `match:taken` + `match:matched`）。用 `nextOfType` 逐条找会把中间那几条吃掉，
     * 后面再想断言「`match:taken` 也推了」就永远等不到了。
     */
    async drain(count, timeoutMs = 2000) {
      const messages = [];
      const deadline = Date.now() + timeoutMs;
      while (messages.length < count) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`只收到 ${messages.length}/${count} 条：` + messages.map((m) => m.type).join(','));
        }
        messages.push(await client.next(remaining));
      }
      return messages;
    },

    /** 断言「接下来一段时间内**没有**某类消息」（用来验定向推送没推错人）。 */
    async expectSilence(type, waitMs = 300) {
      const seen = [];
      const deadline = Date.now() + waitMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return seen;
        let message;
        try {
          message = await client.next(remaining);
        } catch {
          return seen;
        }
        seen.push(message.type);
        if (message.type === type) throw new Error('不该收到 ' + type + '，实际收到：' + seen.join(','));
      }
    },

    opened() {
      if (ws.readyState === ws.OPEN) return Promise.resolve();
      return new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    closed() {
      if (ws.readyState === ws.CLOSED) return Promise.resolve();
      return new Promise((resolve) => ws.once('close', resolve));
    },
    async close() {
      if (ws.readyState === ws.CLOSED) return;
      const done = client.closed();
      ws.close();
      await done;
    },
  };
  return client;
}

/** 连一条**预期被拒**的信令，拿回 HTTP 状态码与错误信封。 */
function connectExpectReject(url, { origin = ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: origin ? { origin } : {} });
    ws.on('unexpected-response', (request, response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        ws.terminate();
        resolve({ status: response.statusCode, json });
      });
    });
    ws.on('open', () => {
      ws.close();
      reject(new Error('握手本该被拒，却连上了'));
    });
    ws.on('error', (error) => reject(error));
  });
}

/**
 * 两台设备各排一行队：一台当学习者、一台当母语者。
 *
 * 账号由 `deviceId` 决定，所以这里是**两个不同的账号**——和现场两台手机一模一样。
 */
async function queueBothRoles(ui) {
  const learner = await registerWithProfile(ui, 'learner', 'device-learner', {
    nativeLanguage: 'english',
    cantoneseLevel: 'beginner',
    interests: ['anime', 'food'],
  });
  const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy', { interests: ['movies'] });
  await ui.request('POST', '/api/match/queue', { token: learner.token, body: {} });
  await ui.request('POST', '/api/match/queue', { token: buddy.token, body: {} });
  return {
    learnerToken: learner.token,
    buddyToken: buddy.token,
    learnerAccountId: learner.userId,
    buddyAccountId: buddy.userId,
    learnerPeerId: learner.peerId,
    buddyPeerId: buddy.peerId,
  };
}

test('握手把关：Origin / 频道 / 令牌 / 房间四条依次判，各回各的状态码', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');

    // 1. Origin 不在白名单 → 403（浏览器一定带 Origin，恶意页面伪造不了）
    const badOrigin = await connectExpectReject(ui.signalUrl('/ws/match', { token }), {
      origin: 'https://evil.example.com',
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.json.error.code, 'forbidden');

    // 局域网 Origin 要放行（手机同 Wi-Fi 打开就是这个来源）
    const lanOrigin = await connectExpectReject(ui.signalUrl('/ws/nope', { token }), {
      origin: 'http://192.168.1.20:4173',
    });
    assert.equal(lanOrigin.status, 404, 'Origin 过了，才轮到「频道不存在」这一条');

    // 2. 频道认不出 → 404
    const noChannel = await connectExpectReject(ui.signalUrl('/ws/rooms', { token }));
    assert.equal(noChannel.status, 404);
    assert.equal(noChannel.json.error.code, 'not_found');

    // 3. 令牌缺失 / 无效 → 401
    const noToken = await connectExpectReject(ui.signalUrl('/ws/match'));
    assert.equal(noToken.status, 401);
    assert.equal(noToken.json.error.code, 'not_authorized');
    const badToken = await connectExpectReject(ui.signalUrl('/ws/match', { token: 'demo-nope' }));
    assert.equal(badToken.status, 401);

    // 4. 房间不存在 → 404 room_gone（不然信令会变成任意房间号的广播器）
    const noRoom = await connectExpectReject(ui.signalUrl('/ws/rooms/r-does-not-exist', { token }));
    assert.equal(noRoom.status, 404);
    assert.equal(noRoom.json.error.code, 'room_gone');

    // 没带 Origin 的非浏览器客户端放行（令牌已经拦过一道，REST 的 CORS 是同一个口径）
    const headerToken = connect(ui.signalUrl('/ws/match', { token }), { origin: null });
    await headerToken.opened();
    assert.equal((await headerToken.nextOfType('queue:updated')).type, 'queue:updated');
    await headerToken.close();
  } finally {
    await ui.close();
  }
});

test('/ws/match：连上就推当前列表，队列一变就再推一次', async () => {
  const ui = await startTestServer();
  try {
    const { learnerToken, buddyToken, learnerPeerId, buddyPeerId } = await queueBothRoles(ui);

    // 母语者视角：列表里能看到刚入队的学习者
    const buddySocket = connect(ui.signalUrl('/ws/match', { token: buddyToken }));
    await buddySocket.opened();
    const first = await buddySocket.nextOfType('queue:updated');
    assert.ok(Array.isArray(first.entries));
    assert.ok(first.entries.some((entry) => entry.peerId === learnerPeerId));
    assert.equal(typeof first.entries[0].matchScore, 'number', '推送的条目与 REST 同一套字段');

    // 学习者视角：同一个事件名，内容是「此刻有空的母语者」
    const learnerSocket = connect(ui.signalUrl('/ws/match', { token: learnerToken }));
    await learnerSocket.opened();
    const learnerView = await learnerSocket.nextOfType('queue:updated');
    assert.ok(learnerView.entries.some((entry) => entry.peerId === buddyPeerId));

    // 队列变了 → 主动推给正在看列表的人（不用轮询）。
    // 用「取消等待」来改队列：同一个账号重复入队是 409 already_queued，根本不改数据。
    const updated = buddySocket.nextOfType('queue:updated');
    await ui.request('DELETE', '/api/match/queue', { token: learnerToken });
    assert.ok(
      (await updated).entries.every((entry) => entry.peerId !== learnerPeerId),
      '取消等待之后这个人要从推送的列表里消失',
    );

    // 白名单外的上行消息回一条错误信封，且连接不断
    buddySocket.send({ type: 'rtc:offer', sdp: 'x' });
    const error = await buddySocket.nextOfType('error');
    assert.equal(error.error.code, 'bad_request');
    assert.match(error.error.message, /unsupported message type/);

    // ping / pong 保活
    buddySocket.send({ type: 'ping' });
    assert.equal((await buddySocket.nextOfType('pong')).type, 'pong');

    // 上行 `queue:joined` 当确认：回一份当前列表
    learnerSocket.send({ type: 'queue:joined', queueEntryId: 'q-' + learnerPeerId });
    assert.ok(Array.isArray((await learnerSocket.nextOfType('queue:updated')).entries));

    await buddySocket.close();
    await learnerSocket.close();
  } finally {
    await ui.close();
  }
});

test('成房推事件：被摘走的人收到 match:matched，且只推给对应身份的那台设备', async () => {
  const ui = await startTestServer();
  try {
    const { learnerToken, buddyToken, learnerPeerId } = await queueBothRoles(ui);

    const learnerSocket = connect(ui.signalUrl('/ws/match', { token: learnerToken }));
    const buddySocket = connect(ui.signalUrl('/ws/match', { token: buddyToken }));
    await learnerSocket.opened();
    await buddySocket.opened();
    await learnerSocket.nextOfType('queue:updated');
    await buddySocket.nextOfType('queue:updated');

    // 母语者挑走这个学习者
    const created = await ui.request('POST', '/api/rooms', {
      token: buddyToken,
      body: { learnerId: learnerPeerId },
    });
    assert.equal(created.status, 201);
    const roomId = created.json.data.roomId;

    // 成房会一次推三条给学习者（刷列表 → 摘人 → 弹接受框），**一起收下来再断言**：
    // 用 `nextOfType` 逐条找会把中间那几条吃掉，后面就再也断言不到 `match:taken` 了
    const learnerMessages = await learnerSocket.drain(3);
    const byType = new Map(learnerMessages.map((message) => [message.type, message]));
    assert.deepEqual(
      [...byType.keys()].sort(),
      ['match:matched', 'match:taken', 'queue:updated'],
      '成房要同时推：列表刷新 + 候选人淡出 + 接受框',
    );

    // 被摘走的人：房号对得上，requestId 为 null（房已开好，不用接受）
    const matched = byType.get('match:matched');
    assert.equal(matched.roomId, roomId);
    assert.equal(matched.requestId, null, '直接成房没有待接受请求，前端据此不弹接受框');
    assert.equal(matched.peer.role, 'buddy', 'peer 是「对方」，不是自己');
    assert.equal(matched.peer.anonymous, false, '新账号默认实名：两台设备要一眼看得出谁是谁');
    assert.equal(byType.get('match:taken').learnerId, learnerPeerId);

    // 母语者那边只该收到两条：列表刷新 + 候选人淡出
    const buddyMessages = await buddySocket.drain(2);
    assert.deepEqual(
      buddyMessages.map((message) => message.type).sort(),
      ['match:taken', 'queue:updated'],
    );

    // **关键**：摘人的那一侧不该收到 match:matched（自己摘的人，不用再弹框给自己）
    await buddySocket.expectSilence('match:matched');

    await learnerSocket.close();
    await buddySocket.close();
  } finally {
    await ui.close();
  }
});

test('接受匹配推事件：接受的人收到 match:matched 带 requestId，对面收到 null 那条直接进房', async () => {
  const ui = await startTestServer();
  try {
    const { learnerToken, buddyToken, learnerAccountId, buddyPeerId } = await queueBothRoles(ui);

    // 直接注入一条待接受请求（真实环境由匹配引擎产出，`db` 是文档里的测试注入点）。
    // 拥有者 = 要点头的那位（学习者），对面 = 有空的母语者。
    ui.db.createMatchRequest({
      requestId: 'req-ws-1',
      accountId: learnerAccountId,
      role: 'learner',
      peerUserId: buddyPeerId,
      peerRole: 'buddy',
      roomId: 'r-ws-1',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    });

    const learnerSocket = connect(ui.signalUrl('/ws/match', { token: learnerToken }));
    const buddySocket = connect(ui.signalUrl('/ws/match', { token: buddyToken }));
    await learnerSocket.opened();
    await buddySocket.opened();
    await learnerSocket.nextOfType('queue:updated');
    await buddySocket.nextOfType('queue:updated');

    const accepted = await ui.request('POST', '/api/match/requests/req-ws-1/accept', { token: learnerToken });
    assert.equal(accepted.status, 201);

    // 点头的那台设备：带 requestId，前端据此收起弹窗并进房
    const matched = await learnerSocket.nextOfType('match:matched');
    assert.equal(matched.requestId, 'req-ws-1');
    assert.equal(matched.roomId, 'r-ws-1');
    assert.equal(matched.peer.role, 'buddy', '推给学习者的是母语者的视图');

    // 被摘走的那台设备：requestId 为 null，直接进房（否则他会在队列里一直等下去）
    const peerMatched = await buddySocket.nextOfType('match:matched');
    assert.equal(peerMatched.requestId, null);
    assert.equal(peerMatched.roomId, 'r-ws-1');
    assert.equal(peerMatched.peer.role, 'learner', '推给母语者的是学习者的视图');

    await learnerSocket.close();
    await buddySocket.close();
  } finally {
    await ui.close();
  }
});

test('演示口子 POST /api/dev/match-request 也会把接受框推给对的人', async () => {
  const ui = await startTestServer();
  try {
    // 出厂是空的，两台设备现场注册（学习者先入队，母语者后入队）——
    // 「排序第一的候选人」因此只有一个人，用例才是确定的
    const { learnerToken } = await queueBothRoles(ui);
    const learnerSocket = connect(ui.signalUrl('/ws/match', { token: learnerToken }));
    await learnerSocket.opened();
    await learnerSocket.nextOfType('queue:updated');

    // 学习者在首页/匹配页等久了，前端后台引擎替他喊一声「给我配一个」
    const created = await ui.request('POST', '/api/dev/match-request', { token: learnerToken, body: {} });
    assert.equal(created.status, 201);

    const matched = await learnerSocket.nextOfType('match:matched');
    assert.equal(matched.requestId, created.json.data.requestId, '待接受的请求要带上 requestId');
    assert.equal(matched.roomId, created.json.data.roomId);
    assert.equal(matched.expiresAt, created.json.data.expiresAt, '倒计时由服务端给，前端不自己算');
    assert.equal(matched.peer.role, 'buddy', '弹窗里要显示对面那位母语者');

    // 而且这条 requestId 是**真的能接受**的（弹窗上的「接受」不能一点就 410）
    const accepted = await ui.request('POST', `/api/match/requests/${created.json.data.requestId}/accept`, {
      token: learnerToken,
    });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.json.data.roomId, created.json.data.roomId);

    await learnerSocket.close();
  } finally {
    await ui.close();
  }
});

test('/ws/rooms/:roomId：凑齐两条连接才 ready，信令原样转发且不回给自己', async () => {
  const ui = await startTestServer();
  try {
    const { learnerToken, buddyToken, learnerPeerId } = await queueBothRoles(ui);
    const created = await ui.request('POST', '/api/rooms', {
      token: buddyToken,
      body: { learnerId: learnerPeerId },
    });
    const roomId = created.json.data.roomId;
    const path = `/ws/rooms/${roomId}`;

    // 只有一个人时：peerReady 为 false（对方还没进房）
    const a = connect(ui.signalUrl(path, { token: buddyToken }));
    await a.opened();
    assert.deepEqual(await a.nextOfType('room:ready'), { type: 'room:ready', peerReady: false });

    // 第二个人进来 → 两边都收到 peerReady: true
    const readyForA = a.nextOfType('room:ready');
    const b = connect(ui.signalUrl(path, { token: learnerToken }));
    await b.opened();
    assert.deepEqual(await readyForA, { type: 'room:ready', peerReady: true });
    assert.deepEqual(await b.nextOfType('room:ready'), { type: 'room:ready', peerReady: true });

    // 信令转发：B 收到 A 的 offer，A 自己**收不到**（回给自己会把本地 description 再设一遍）
    const offer = { type: 'rtc:offer', from: 'peer-a', sdp: { type: 'offer', sdp: 'v=0' } };
    a.send(offer);
    assert.deepEqual(await b.nextOfType('rtc:offer'), offer);
    await a.expectSilence('rtc:offer');

    // answer / ice 同样原样转发，字段一个不动
    const ice = { type: 'rtc:ice', from: 'peer-b', candidate: { candidate: 'candidate:1 1 udp 1' } };
    b.send(ice);
    assert.deepEqual(await a.nextOfType('rtc:ice'), ice);

    // 静音徽标也是转发（不是服务端状态）
    a.send({ type: 'room:peer-muted', muted: true });
    assert.equal((await b.nextOfType('room:peer-muted')).muted, true);

    // 音量同步同样是原样转发：跨设备档位靠它画对方的波形
    const level = { type: 'rtc:level', from: 'peer-a', value: 0.42 };
    a.send(level);
    assert.deepEqual(await b.nextOfType('rtc:level'), level);

    // 话题卡同步（「双方看同一张」）走的也是这条转发：服务端不认识卡片，原样转给房里另一个人
    const card = { type: 'room:card', from: 'peer-a', cardId: 'anime-beginner-02', index: 3 };
    a.send(card);
    assert.deepEqual(await b.nextOfType('room:card'), card);
    await a.expectSilence('room:card');

    // 结束会话 → 房里所有人都被通知跳结算页
    const ended = b.nextOfType('room:ended');
    const end = await ui.request('POST', `/api/rooms/${roomId}/end`, {
      token: buddyToken,
      body: { durationSec: 600, cardsUsed: 2 },
    });
    assert.equal(end.status, 200);
    assert.equal((await ended).durationSec, 600);

    // 一方掉线 → 另一方立刻知道，不用等超时
    const peerLeft = b.nextOfType('room:peer-left');
    await a.close();
    assert.equal((await peerLeft).reason, 'disconnected');

    await b.close();
  } finally {
    await ui.close();
  }
});

/* ==========================================================================
 * 3. GET /api/rtc/ice-servers
 * ========================================================================== */

test('GET /api/rtc/ice-servers：带令牌回 STUN，不带令牌 401', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const response = await ui.request('GET', '/api/rtc/ice-servers', { token });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.json.data.iceServers));
    assert.ok(response.json.data.iceServers.length > 0, '本轮至少要有 STUN，否则前端只能整段降级');
    assert.ok(response.json.data.iceServers[0].urls.some((url) => url.startsWith('stun:')));
    assert.ok(Number.isFinite(Date.parse(response.json.data.expiresAt)), 'expiresAt 要是合法 ISO 8601');

    const noToken = await ui.request('GET', '/api/rtc/ice-servers');
    assert.equal(noToken.status, 401);
    assert.equal(noToken.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

test('GET /api/rtc/ice-servers：配了 TURN 就一起下发，一个都没有才 503', async () => {
  const ui = await startTestServer({
    turn: { urls: ['turn:turn.example.com:3478'], username: 'demo', credential: 'secret' },
  });
  try {
    const token = await ui.signIn('learner');
    const response = await ui.request('GET', '/api/rtc/ice-servers', { token });
    assert.equal(response.status, 200);
    const turn = response.json.data.iceServers.find((item) => item.urls.some((url) => url.startsWith('turn:')));
    assert.ok(turn, '配了 TURN 就要下发');
    assert.equal(turn.username, 'demo');
    assert.equal(turn.credential, 'secret');
  } finally {
    await ui.close();
  }

  // 连 STUN 都没有才 503 —— 前端据此走「先本地档位、再模拟通话」（契约 4.6 节）
  const bare = await startTestServer({ stunUrls: [] });
  try {
    const token = await bare.signIn('learner');
    const response = await bare.request('GET', '/api/rtc/ice-servers', { token });
    assert.equal(response.status, 503);
    assert.equal(response.json.error.code, 'turn_unavailable');
  } finally {
    await bare.close();
  }
});

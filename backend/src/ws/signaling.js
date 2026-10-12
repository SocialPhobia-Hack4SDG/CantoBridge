/**
 * 信令（WebSocket）：握手 → 频道登记 → 转发。
 *
 * 这一层只做三件事，**不承载媒体、不做业务判断**：
 *   1. 握手把关：Origin 白名单 → 频道存在 → 令牌有效 → 房间存在（四条依次判，谁先不过谁先拒）
 *   2. 频道登记：把连接挂进 Hub（`/ws/match` 或 `/ws/rooms/:roomId`）
 *   3. 转发：`rtc:offer` / `rtc:answer` / `rtc:ice` 原样转给房里**其他人**，绝不回给发送方
 *
 * 为什么用 `noServer` + 自己接 `upgrade`：这样被拒的时候能回一个**带错误码的 HTTP 响应**
 * （403 / 401 / 404），而不是把 socket 直接掐断。浏览器侧只看得到「连接失败」，
 * 但 node / curl / 现场排障能看到 `{ ok:false, error:{ code } }`，和 REST 的信封一致。
 *
 * 两处口径值得写下来：
 *   - **没有 Origin 就放行**：浏览器发 WebSocket **一定**会带 Origin，恶意页面伪造不了；
 *     带不了 Origin 的只有非浏览器客户端（node 测试、curl、以后的 APK），
 *     它们已经要被令牌拦一道，不该再因为「没有 Origin」被拒。REST 那边的 CORS 是同一个口径。
 *   - **信令挂了不能拖垮 REST**：领域层通过 `emit()` 通知，`emit` 内部吞掉所有异常
 *     （契约 4.6 节「演示路径上任何一个失败都要有出路」）。
 */

import { WebSocketServer } from 'ws';

import { isAllowedOrigin } from '../http/cors.js';
import { isRoomParticipant } from '../domain/roomAccess.js';
import { availableBuddiesFor, waitingLearnersFor } from '../domain/match.js';
import {
  MATCH_CHANNEL,
  MATCH_UPSTREAM,
  MAX_PAYLOAD_BYTES,
  ROOM_RELAY,
  parseChannel,
  parseClientMessage,
  readHandshakeToken,
  roomChannel,
} from './protocol.js';

const STATUS_TEXT = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  503: 'Service Unavailable',
};

/** 拒握手：回一个和 REST 同形状的错误信封，再收掉 socket。 */
export function rejectHandshake(socket, status, code, message) {
  const body = JSON.stringify({ ok: false, error: { code, message } });
  const head =
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
    'content-type: application/json; charset=utf-8\r\n' +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    'connection: close\r\n' +
    '\r\n';
  try {
    socket.write(head + body);
  } catch {
    // 对端可能已经走了，写不进去就算了
  }
  socket.destroy();
  return { status, code };
}

/**
 * 一条连接该看到的候选列表：母语者看等待者，学习者看有空的母语者。
 *
 * 用的是 `domain/match.js` 里 REST 同款的那两个函数 —— 推送和拉取必须是同一份列表，
 * 不然会出现「刷新页面是新的、推送来的是旧的」这种只有现场才会发现的漂移。
 */
function viewerEntries(db, client) {
  const viewer = { userId: client.userId, role: client.role };
  return client.role === 'buddy' ? waitingLearnersFor(db, viewer) : availableBuddiesFor(db, viewer);
}

/**
 * 领域层 → 信令层的桥。领域层只喊事件名 + 载荷，**这里**决定谁该收到。
 *
 * 认得的事件（与契约 09 第 3.3 节一一对应）：
 *   `queue:updated`  → 广播给所有匹配频道连接，各自按自己的身份重算列表
 *   `match:matched`  → 定向推给 `accountId`（学习者右上角弹接受框）
 *   `match:taken`    → 广播给所有匹配频道连接（某位候选人被摘走，列表淡出）
 *   `room:ended`     → 广播给该房间频道（跳结算页）
 */
export function createEventBridge({ db, hub }) {
  function pushQueueUpdated() {
    for (const client of hub.clients(MATCH_CHANNEL)) {
      client.send({ type: 'queue:updated', entries: viewerEntries(db, client) });
    }
  }

  return {
    /**
     * 领域层调它。**永远不抛异常**：REST 的成功不该因为信令层出问题而变成 500。
     * 返回真正推出去的连接数，方便测试断言（也是排障时的唯一线索）。
     */
    emit(type, payload = {}) {
      try {
        if (type === 'queue:updated') {
          pushQueueUpdated();
          return hub.size(MATCH_CHANNEL);
        }
        if (type === 'match:matched') {
          if (!payload.accountId) return 0;
          return hub.sendTo(
            MATCH_CHANNEL,
            { userId: payload.accountId, role: payload.role ?? null },
            {
              type: 'match:matched',
              requestId: payload.requestId ?? null,
              roomId: payload.roomId ?? null,
              peer: payload.peer ?? null,
              expiresAt: payload.expiresAt ?? null,
            },
          );
        }
        if (type === 'match:taken') {
          if (!payload.learnerId) return 0;
          return hub.broadcast(MATCH_CHANNEL, { type: 'match:taken', learnerId: payload.learnerId });
        }
        if (type === 'room:ended') {
          if (!payload.roomId) return 0;
          return hub.broadcast(roomChannel(payload.roomId), {
            type: 'room:ended',
            durationSec: payload.durationSec ?? 0,
          });
        }
        return 0;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * 把信令挂到 HTTP 服务上。返回 `{ wss, close() }`。
 *
 * `close()` 必须显式调用：升级过的 socket **不在** HTTP 服务的连接表里，
 * `server.closeAllConnections()` 碰不到它们，测试里只关 server 会一直挂着不退出。
 */
export function attachSignaling({ server, db, hub, corsOrigins = [], now = () => Date.now() }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const sockets = new Set();
  let seq = 0;

  /**
   * 房间频道里凑齐两条连接就叫 ready —— `room:ready` 唯一的触发条件。
   *
   * 为什么数**连接**而不是数**不同账号**：一个账号可以有两个身份，一台设备开两个标签页
   * 就是两条连接、两个身份、同一个账号。按账号去重的话，这种情况永远等不到 ready。
   */
  function announceRoomReady(channel, { except = null } = {}) {
    const peerReady = hub.size(channel) >= 2;
    hub.broadcast(channel, { type: 'room:ready', peerReady }, { except });
    return peerReady;
  }

  function handleClientMessage(client, raw) {
    if (!db.getSession(client.token)) { client.disconnect(4001, 'session expired'); return; }
    const current = now();
    if (current - client.windowStart >= 60_000) { client.windowStart = current; client.messageCount = 0; }
    if (++client.messageCount > 2000) { client.disconnect(4008, 'message rate exceeded'); return; }
    const allowed = client.kind === 'match' ? MATCH_UPSTREAM : ROOM_RELAY;
    const parsed = parseClientMessage(raw, allowed);
    if (!parsed.ok) {
      client.send({ type: 'error', error: { code: parsed.code, message: parsed.message } });
      return;
    }

    if (parsed.type === 'ping') {
      client.send({ type: 'pong', at: new Date(now()).toISOString() });
      return;
    }
    if (parsed.type === 'queue:joined') {
      // 上行只是「我确认在等了」；回一份当前列表当确认（契约 09 第 3.3 节）
      client.send({ type: 'queue:updated', entries: viewerEntries(db, client) });
      return;
    }
    // 白名单里剩下的都是要原样转发给房里其他人的信令：**绝不回给发送方**，
    // 否则前端会把刚设好的本地 description 当成对方的再设一遍。
    hub.broadcast(client.channel, parsed.message, { except: client.self });
  }

  function handleConnection(ws, request, context) {
    const { channel, kind, roomId, session } = context;
    const client = {
      id: `c-${++seq}`,
      kind,
      channel,
      roomId,
      userId: session.userId,
      role: session.role,
      token: session.token,
      windowStart: now(),
      messageCount: 0,
      disconnect(code, reason) { ws.close(code, reason); },
      send(message) {
        if (ws.readyState !== ws.OPEN) return false;
        if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); return false; }
        try {
          ws.send(JSON.stringify(message));
          return true;
        } catch {
          return false;
        }
      },
    };
    // 转发时用来排除自己的那一个元素，建一次就够
    client.self = new Set([client]);

    const detach = hub.register(channel, client);
    sockets.add(ws);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });

    if (kind === 'room') {
      // 广播本身就会发给刚进来的这个人，不用单独再发一遍
      announceRoomReady(channel);
    } else {
      client.send({ type: 'queue:updated', entries: viewerEntries(db, client) });
    }

    ws.on('message', (raw) => handleClientMessage(client, raw));
    ws.on('error', () => {
      // 单个连接出错只收这一条，别把整个信令带下去
      try {
        ws.terminate();
      } catch {
        void 0;
      }
    });
    ws.on('close', () => {
      detach();
      sockets.delete(ws);
      // 房里还有人就通知他们「对面走了」；最后一个走的人不推，推了也没人听
      if (kind === 'room' && hub.size(channel) > 0) {
        hub.broadcast(channel, { type: 'room:peer-left', reason: 'disconnected' });
      }
    });
  }

  function handleUpgrade(request, socket, head) {
    const url = new URL(String(request.url ?? '/'), 'http://localhost');
    const origin = request.headers?.origin;

    // 1. Origin：带了就必须在白名单里；没带 = 非浏览器客户端，放行（见文件头）
    if (origin && !isAllowedOrigin(origin, corsOrigins)) {
      return rejectHandshake(socket, 403, 'forbidden', 'origin not allowed: ' + origin);
    }

    // 2. 频道
    const parsed = parseChannel(url.pathname);
    if (!parsed) return rejectHandshake(socket, 404, 'not_found', 'no signaling channel at ' + url.pathname);

    // 3. 令牌（浏览器走 `?token=`，见 protocol.js 的说明）
    const token = readHandshakeToken(request, url);
    const session = token ? db.getSession(token) : null;
    if (!session) return rejectHandshake(socket, 401, 'not_authorized', 'invalid or missing token');

    // 4. 房间必须真的存在，否则信令会变成任意房间号的广播器
    if (parsed.kind === 'room' && !db.getRoom(parsed.roomId)) {
      return rejectHandshake(socket, 404, 'room_gone', 'room not found: ' + parsed.roomId);
    }
    if (parsed.kind === 'room' && !isRoomParticipant(db, db.getRoom(parsed.roomId), session.userId)) {
      return rejectHandshake(socket, 403, 'forbidden', 'not a room participant');
    }
    if (sockets.size >= 200) return rejectHandshake(socket, 429, 'rate_limited', 'connection limit exceeded');
    let ownedConnections = 0;
    for (const client of wss.clients) if (client.accountId === session.userId) ownedConnections++;
    if (ownedConnections >= 8) return rejectHandshake(socket, 429, 'rate_limited', 'account connection limit exceeded');

    const context = { ...parsed, session };
    wss.handleUpgrade(request, socket, head, (ws) => { ws.accountId = session.userId; wss.emit('connection', ws, request, context); });
    return null;
  }

  server.on('upgrade', (request, socket, head) => {
    try {
      handleUpgrade(request, socket, head);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rejectHandshake(socket, 503, 'internal', message);
    }
  });

  wss.on('connection', (ws, request, context) => {
    try {
      handleConnection(ws, request, context);
    } catch (error) {
      // 不静默：初始化失败（比如列表算不出来）必须留下线索，否则前端只看到「连上就被踢」
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ws] 连接初始化失败：' + message);
      try {
        ws.close(1011, 'signaling error');
      } catch {
        void 0;
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30_000).unref();

  return {
    wss,
    channels: () => hub.channels(),
    close() {
      clearInterval(heartbeat);
      for (const socket of sockets) {
        try {
          socket.terminate();
        } catch {
          void 0;
        }
      }
      sockets.clear();
      hub.clear();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}

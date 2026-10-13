/**
 * 信令协议的**纯函数部分**：频道解析、握手取令牌、上行消息校验。
 *
 * 这里刻意不 require('ws')、不碰 socket —— 握手的拒绝理由（Origin / 令牌 / 房间号）
 * 是这一层最容易写错、也最该被单测钉住的东西，而它们全都是「字符串进、判定出」，
 * 没有理由必须起一个真服务才能测。
 *
 * 频道（契约 09 第 3.3 节 / 10 第 5 节）：
 *   /ws/match             一个人的匹配频道：收匹配事件、刷候选列表
 *   /ws/rooms/:roomId     一间房的信令频道：SDP / ICE 转发、进出房通知
 */

export const MATCH_CHANNEL = '/ws/match';
export const ROOM_CHANNEL_PREFIX = '/ws/rooms/';

/**
 * 单条消息上限。SDP 大概几 KB，ICE candidate 几百字节，256KB 是宽松的上限；
 * 不设上限等于让任何一个客户端都能把内存打满。
 */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

/** `/ws/match` 上允许**上行**的事件。 */
export const MATCH_UPSTREAM = new Set(['queue:joined', 'ping']);

/**
 * `/ws/rooms/:roomId` 上允许**原样转发**给房里其他人的事件。
 * 只有这几个：信令层不做业务判断，白名单之外一律拒绝，避免它变成任意广播器。
 *
 * `rtc:level`（对方说话音量，0~1）也算信令的一部分：跨设备档位没有 `BroadcastChannel`
 * 可以本地互看波形，前端只能靠它把对方的音量条画出来。约 11 条/秒，对 256KB 上限无压力。
 *
 * `room:card`（对方翻到哪一张话题卡）同样是**转发**、不是服务端状态：后端不知道、也不校验
 * 卡片内容，只负责让房里另一台设备知道「对方翻到 `index` 那张（id 是 `cardId`）」。
 * 载荷里同时带 id 与序号，是为了牌堆万一漂移时接收方还能按 id 找回同一张。
 */
export const ROOM_RELAY = new Set([
  'rtc:retry',
  'rtc:offer',
  'rtc:answer',
  'rtc:ice',
  'rtc:level',
  'room:peer-muted',
  'room:card',
]);

/** `/ws/rooms/<roomId>` —— 房间号不额外编码，和 REST 的 `:roomId` 同一套字符。 */
export function roomChannel(roomId) {
  return ROOM_CHANNEL_PREFIX + roomId;
}

/**
 * 路径 → 频道描述。
 * 认不出来返回 `null`（由调用方回 404），不抛异常——握手路径上什么都可能进来。
 */
export function parseChannel(pathname) {
  const path = String(pathname ?? '');
  if (path === MATCH_CHANNEL) return { kind: 'match', channel: MATCH_CHANNEL, roomId: null };
  if (path.startsWith(ROOM_CHANNEL_PREFIX)) {
    const roomId = path.slice(ROOM_CHANNEL_PREFIX.length);
    // `/ws/rooms/` 后面必须有东西，且不能带下一段路径（`/ws/rooms/a/b` 是写错了）
    if (roomId.length === 0 || roomId.includes('/')) return null;
    return { kind: 'room', channel: roomChannel(roomId), roomId };
  }
  return null;
}

/**
 * 从握手请求里取令牌。
 *
 * 为什么优先取查询串：浏览器 `WebSocket` 构造函数**不允许自定义请求头**，
 * 前端没法像 REST 那样带 `Authorization`。所以口径是：
 *   - `?token=xxx`（浏览器路径）
 *   - `Authorization: Bearer xxx`（node / curl 这类能带头的客户端）
 * 两条都支持，令牌的校验逻辑与 REST 完全共用 `db.getSession()`。
 */
export function readHandshakeToken(request, url = null) {
  const search = url ?? new URL(String(request?.url ?? '/'), 'http://localhost');
  const fromQuery = search.searchParams?.get?.('token');
  if (typeof fromQuery === 'string' && fromQuery.trim().length > 0) return fromQuery.trim();

  const header = request?.headers?.authorization ?? request?.headers?.Authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * 上行消息 → `{ ok: true, type, message }` 或 `{ ok: false, code, message }`。
 *
 * 只做「是不是一条合法的、类型在白名单里的 JSON 对象」，不做字段级校验：
 * `rtc:ice` 的 candidate 形状由 WebRTC 决定，信令层不掺和，原样转发。
 */
export function parseClientMessage(raw, allowed) {
  let text;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString('utf8');
  else if (raw === null || raw === undefined) text = '';
  else text = String(raw);

  if (text.length === 0) return { ok: false, code: 'bad_request', message: 'empty message' };

  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_request', message: 'message is not valid JSON' };
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { ok: false, code: 'bad_request', message: 'message must be a JSON object' };
  }
  if (typeof message.type !== 'string' || message.type.length === 0) {
    return { ok: false, code: 'bad_request', message: 'message.type is required' };
  }
  if (allowed && !allowed.has(message.type)) {
    return { ok: false, code: 'bad_request', message: `unsupported message type on this channel: ${message.type}` };
  }
  return { ok: true, type: message.type, message };
}

/**
 * 匹配频道（`/ws/match`）的客户端：把服务端的推送接进 store。
 *
 * ## 为什么必须有它
 *
 * 后端在这三处都会往 `/ws/match` 推事件（见 `backend/src/ws/signaling.js` 的事件桥）：
 *   - 有人入队 / 退队 / 被摘走 → `queue:updated`（按各自的身份重算列表）
 *   - 母语者挑了人、或学习者自己配到了人 → `match:matched`（定向推给该收的那一方）
 *   - 某位候选人被摘走 → `match:taken`
 *
 * 但前端以前**从来没有连过这个频道**（`src/` 里只有房间频道在用 WebSocket）——
 * 消息全推进了空气。现场表现就是：**「我能看到对面在等，我点了 TA，TA 那边没反应」**，
 * 然后双方一起卡住（学习者的本地兜底引擎去 `POST /api/dev/match-request` 也找不到人，
 * 因为母语者已经进房了）。这一层就是补这个洞。
 *
 * ## 三条口径
 *
 * 1. **`requestId` 为 `null` = 对方已经把房开好**（契约 10 第 5 节）：不弹接受框，
 *    直接 `startRoom` + 进房。这是「母语者挑人」那条路的形状。
 *    带 `requestId` 的才渲染成 `MatchAcceptToast`（10 秒倒计时、接受 / 不接受）。
 * 2. **没有令牌 / 没有信令地址就什么都不做**：纯 mock 档位（`?api=mock`）下没有后端，
 *    这层是**无害旁路**；未登录时连上去只会被 401 踢掉，不如不连。
 * 3. **断线要自己重连**：手机锁屏、切后台、换 Wi-Fi 都会断，而匹配这件事必须活着。
 *    退避重试（1s → 2s → 5s → 10s → 15s 封顶），`close()` 之后不再重连。
 *
 * 与 `socialSync.js` 的分工：那个管「伙伴关系表对齐」（REST，一次性），
 * 这个管「实时推送」（WebSocket，长连接）。
 */

import { matchSignalUrl } from '../lib/signal.js';
import { toEntries, toMatchRequest } from '../services/adapters.js';

/** 断线重连的退避序列（毫秒），用尽后一直用最后一个值。 */
export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 15000];

export function createMatchSync({
  store,
  signalUrl = '',
  getToken = () => null,
  WebSocketImpl = globalThis.WebSocket ?? null,
  /** 进房回调：由外壳层接上 `navigate('/room/' + roomId)`（store 里只记房间，不碰路由）。 */
  onEnterRoom = null,
  retryDelays = RETRY_DELAYS_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let socket = null;
  let retryTimer = null;
  let attempt = 0;
  let closedByUs = false;
  let currentUrl = '';

  /** 这次该连的地址。缺令牌或缺信令基址时返回空串 = 不连。 */
  function targetUrl() {
    const base = matchSignalUrl(signalUrl);
    const token = getToken();
    if (!base || !token) return '';
    // 令牌只能走查询串：浏览器 `WebSocket` 不允许自定义请求头（后端 protocol.js 同口径）
    return base + '?token=' + encodeURIComponent(token);
  }

  function scheduleRetry() {
    if (closedByUs || retryTimer !== null) return;
    const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
    attempt += 1;
    retryTimer = setTimer(() => {
      retryTimer = null;
      open();
    }, delay);
  }

  /**
   * `match:matched` 的两种形状。
   *
   * 注意这里**不校验是不是自己的请求**：服务端已经按 `(账号, 身份)` 定向推过了
   * （见 backend 的 `hub.sendTo`），前端再筛一遍只会把「换了身份之后收到的」误杀。
   */
  function receiveMatch(message) {
    // 走一遍适配层：`expiresAt` 是 ISO 字符串，倒计时要的是毫秒数（同 `toMatchRequest`）
    const request = toMatchRequest(message);
    const { roomId } = request;
    if (!roomId) return;
    const myRole = store?.getState?.().role ?? null;

    // 已经在同一间房里：重连补发时可能再收到一次，别把房间重建一遍
    if (store?.getState?.().runtime?.room?.roomId === roomId) return;

    // `toMatchRequest` 把缺省的 requestId 归成 null，所以一个判断覆盖 null 与 undefined
    if (request.requestId === null) {
      // 对方已经把房开好 —— 不弹接受框，直接进房
      store?.startRoom?.({ roomId, peer: request.peer, role: myRole });
      onEnterRoom?.(roomId);
      return;
    }

    store?.receiveMatchRequest?.({
      requestId: request.requestId,
      roomId,
      peer: request.peer,
      expiresAt: request.expiresAt,
      reason: 'server',
    });
  }

  /** 处理一条下行消息。解析失败一律忽略：信令层不该因为一条坏消息把连接搞崩。 */
  function handleMessage(raw) {
    let message = null;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'queue:updated') {
      store?.hydrateMatchPeers?.(toEntries(message));
      return;
    }
    if (message.type === 'match:taken') {
      store?.dropMatchPeer?.(message.learnerId);
      return;
    }
    if (message.type === 'match:matched') {
      receiveMatch(message);
    }
    // 其余（`pong` 等）不需要前端处理
  }

  /** 连上（幂等）。已经在连同一个地址就什么都不做。 */
  function open() {
    const url = targetUrl();
    if (!url) return false;
    if (!WebSocketImpl) return false;
    if (socket && currentUrl === url) return false;

    // 地址变了（换身份 = 换令牌）：把旧的收干净再连新的，否则会同时挂两条连接
    closeSocket();

    closedByUs = false;
    currentUrl = url;
    try {
      socket = new WebSocketImpl(url);
    } catch {
      socket = null;
      scheduleRetry();
      return false;
    }

    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (event) => handleMessage(event?.data);
    socket.onclose = () => {
      socket = null;
      scheduleRetry();
    };
    socket.onerror = () => {
      // 出错之后浏览器一定还会发 close，重连交给 onclose 统一处理，避免连两次
    };
    return true;
  }

  function closeSocket() {
    if (!socket) return;
    const dying = socket;
    socket = null;
    // 先摘掉回调：这是我们主动关的，不该触发重连
    dying.onopen = null;
    dying.onmessage = null;
    dying.onclose = null;
    dying.onerror = null;
    try {
      dying.close();
    } catch {
      void 0;
    }
  }

  /** 彻底断开（不再重连）。换身份前、或页面要收摊时用。 */
  function close() {
    closedByUs = true;
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    attempt = 0;
    currentUrl = '';
    closeSocket();
  }

  /**
   * 令牌到手 / 换了身份之后调用：按当前令牌重连一次。
   * 已经连着同一个地址就是空操作，所以可以放心地在每次登录成功后调。
   */
  function restart() {
    const url = targetUrl();
    if (!url) {
      close();
      return false;
    }
    if (socket && currentUrl === url) return false;
    close();
    closedByUs = false;
    return open();
  }

  return {
    open,
    close,
    restart,
    /** 给测试与排障用：当前是否挂着一条连接。 */
    isConnected: () => socket !== null,
  };
}

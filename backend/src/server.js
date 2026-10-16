/**
 * 服务装配：HTTP 入口 → CORS → 路由 → 请求体 → 幂等 → handler → 统一信封。
 *
 * 一个请求的完整链路（顺序不能乱）：
 *   1. OPTIONS 预检直接 204 / 403（不进业务）
 *   2. 路由匹配：没有这个路径 → 404 not_found；路径在但方法不对 → 405 method_not_allowed
 *   3. 解析 JSON body（POST/PUT/DELETE）：坏 JSON / 非对象 → 400 bad_request
 *   4. requestId 幂等：命中过就原样回放第一次的结果（弱网重试不能把 XP 加两次）
 *   5. 执行 handler；抛 ApiError 就按 code + 状态码表回错误信封，抛别的错回 500 internal
 *
 * 已注册的路由清单通过 `router.list()` 暴露给 tools/check-contract.mjs，
 * 用来和 frontend/docs/10-api-v1.md 的端点表比对。
 *
 * 信令（WebSocket）与 REST **共用同一份 db 与同一套令牌**：领域层通过 `events` 喊事件，
 * `ws/signaling.js` 决定谁该收到。装配顺序有讲究 —— 桥必须先于 handler 建好，
 * 信令服务器必须在 http server 之后挂上去（它要接管 `upgrade`）。
 */

import { createServer as createHttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiError, errorBody, okBody, sendJson, statusForCode } from './http/envelope.js';
import { readJsonBody } from './http/body.js';
import { createRouter } from './http/router.js';
import { corsHeaders, handlePreflight } from './http/cors.js';
import { createIdempotency } from './http/idempotency.js';
import { createDb } from './store/db.js';
import { createAccountHandlers } from './domain/account.js';
import { createDictionaryHandlers } from './domain/dictionary.js';
import { createMatchHandlers } from './domain/match.js';
import { createRoomHandlers } from './domain/rooms.js';
import { createRtcHandlers, turnFromEnv } from './domain/rtc.js';
import { createSocialHandlers } from './domain/social.js';
import { createShopHandlers } from './domain/shop.js';
import { createGenAiHandlers } from './domain/genai.js';
import { createHub } from './ws/hub.js';
import { attachSignaling, createEventBridge } from './ws/signaling.js';

export const API_VERSION = '0.1.0';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DATA_FILE = resolve(ROOT, '.data', 'db.json');

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createServer({
  db = createDb(),
  now = () => Date.now(),
  corsOrigins = [],
  devRoutes = true,
  turn = null,
  stunUrls = undefined,
  iceProvider = null,
  runRequest = null,
  requestPolicy = null,
  exposeErrors = true,
  genAiProvider = undefined,
} = {}) {
  const router = createRouter();
  const idempotency = createIdempotency({ now });
  // 连接登记簿 + 领域层 → 信令层的桥；两者都要先建好，下面才能注入给各 handler
  const hub = createHub();
  const bus = createEventBridge({ db, hub });
  let pendingEvents = null;
  const emit = (type, payload) => pendingEvents ? pendingEvents.push([type, payload]) : bus.emit(type, payload);
  const account = createAccountHandlers({ db, events: emit });
  const dictionary = createDictionaryHandlers();
  const match = createMatchHandlers({ db, now, events: emit });
  const rooms = createRoomHandlers({ db, now, events: emit });
  const rtc = createRtcHandlers({ db, now, turn, iceProvider, ...(stunUrls ? { stunUrls } : {}) });
  const social = createSocialHandlers({ db, now });
  const shop = createShopHandlers({ db });
  const genai = createGenAiHandlers({ db, ...(genAiProvider ? { provider: genAiProvider } : {}) });
  router.post('/api/genai/topic-cards', genai.generateCards, { idempotent: true });
  router.post('/api/genai/tutor/reply', genai.tutorReply, { idempotent: true });
  router.get('/api/me/shop', shop.get);
  router.post('/api/me/shop/redeem', shop.redeem, { idempotent: true });
  const startedAt = now();

  /** 契约内的接口（tools/check-contract.mjs 会拿这份清单和 docs/10 比对）。 */
  router.get('/api/health', async () => ({
    data: {
      status: 'ok',
      version: API_VERSION,
      uptimeSec: Math.round((now() - startedAt) / 1000),
      tables: {
        users: db.count('users'),
        profiles: db.count('profiles'),
        queue: db.count('queue'),
        rooms: db.count('rooms'),
        relations: db.count('relations'),
      },
    },
  }), { contract: false });
  router.get('/api/tags', dictionary.tags);
  router.post('/api/auth/session', account.session, { idempotent: true });
  router.post('/api/auth/logout', account.logout, { idempotent: true });
  router.get('/api/me', account.me);
  // 两份资料分开存、分开改：切身份不会覆盖另一边（契约 2.4 / 4.2 节）
  router.put('/api/me/profile/learner', account.updateLearnerProfile, { idempotent: true });
  router.put('/api/me/profile/buddy', account.updateBuddyProfile, { idempotent: true });
  router.put('/api/me/settings', account.updateSettings, { idempotent: true });

  /* ---------- Phase 3：房间 / 话题卡 / 结算（契约 4.5 节） ---------- */
  router.get('/api/rooms/:roomId/cards', rooms.getCards);
  router.post('/api/rooms/:roomId/end', rooms.endRoom, { idempotent: true });
  router.post('/api/rooms/:roomId/feedback', rooms.sendFeedback, { idempotent: true });
  router.post('/api/me/saved-phrases', rooms.savePhrase, { idempotent: true });

  /* ---------- 实时：ICE 服务器（契约 4.8 节；信令本身走 /ws/*，不在路由表里） ---------- */
  router.get('/api/rtc/ice-servers', rtc.iceServers);

  /* ---------- Phase 2：匹配与成房（契约 4.4 / 4.5 节） ---------- */
  router.post('/api/match/queue', match.joinQueue, { idempotent: true });
  router.delete('/api/match/queue', match.leaveQueue, { idempotent: true });
  router.get('/api/match/queue', match.listQueue);
  router.get('/api/match/recommendations', match.listRecommendations);
  router.put('/api/match/criteria', match.updateCriteria, { idempotent: true });
  router.get('/api/match/candidates/:learnerId', match.getCandidate);
  router.post('/api/match/requests/:requestId/accept', rooms.acceptRequest, { idempotent: true });
  router.post('/api/match/requests/:requestId/decline', rooms.declineRequest, { idempotent: true });
  // 发起人两种、接口一个：母语者传 learnerId，学习者在首页「直接聊」传 buddyId
  router.post('/api/rooms', rooms.createRoom, { idempotent: true });
  router.get('/api/rooms/:roomId', rooms.getRoom);

  /* ---------- Phase 4：伙伴关系（契约 4.6 节） ---------- */
  // 发出申请 ≠ 成为伙伴；双向申请自动互相确认；处理完的申请直接移除
  router.get('/api/me/buddies', social.listBuddies);
  router.delete('/api/me/buddies/:peerId', social.removeBuddy, { idempotent: true });
  router.get('/api/me/buddy-requests', social.listBuddyRequests);
  router.post('/api/me/buddy-requests', social.sendBuddyRequest, { idempotent: true });
  router.post('/api/me/buddy-requests/:peerId/accept', social.acceptBuddyRequest, { idempotent: true });
  router.post('/api/me/buddy-requests/:peerId/decline', social.declineBuddyRequest, { idempotent: true });
  router.delete('/api/me/buddy-requests/:peerId', social.cancelBuddyRequest, { idempotent: true });

  /* ---------- Phase 4：沉淀（契约 4.7 节） ---------- */
  router.get('/api/me/progress', social.getProgress);
  router.get('/api/me/history', social.getHistory);
  router.get('/api/leaderboard', social.getLeaderboard);

  if (devRoutes) {
    router.post('/api/dev/reset', account.reset, { contract: false, idempotent: true });
    // 契约外的演示口子：真实环境由匹配引擎 + /ws/match 推送产出待接受请求（Phase 4）
    router.post('/api/dev/match-request', rooms.createDemoMatchRequest, { contract: false, idempotent: true });
    // 契约外的演示口子：模拟「收到一条伙伴申请」（前端 mock 的 receiveBuddyRequest）
    router.post('/api/dev/buddy-request', social.createDemoBuddyRequest, { contract: false, idempotent: true });
  }

  async function handle(req, res) {
    const origin = req.headers?.origin;
    const headers = corsHeaders(origin, corsOrigins);
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (handlePreflight(req, res, corsOrigins)) return;

    const matched = router.match(req.method, url.pathname);
    if (!matched) {
      sendJson(res, 404, errorBody('not_found', `no route for ${req.method} ${url.pathname}`), headers);
      return;
    }
    if (matched.methodNotAllowed) {
      sendJson(res, 405, errorBody('method_not_allowed', `${req.method} not allowed on ${url.pathname}`), headers);
      return;
    }

    const { route, params } = matched;
    const method = String(req.method).toUpperCase();
    const token = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '') || null;

    try {
      const body = BODY_METHODS.has(method) ? await readJsonBody(req) : {};

      const requestId = typeof body?.requestId === 'string' && body.requestId.length > 0 ? body.requestId : null;
      const key = route.options.idempotent && requestId ? idempotency.keyFor(req, token, requestId) : null;
      // 云端串行执行、先持久化再回包；失败时不缓存成功结果、不广播未提交事件。
      const execute = async () => {
        requestPolicy?.({ req, body, path: url.pathname, token });
        const replay = key ? idempotency.get(key) : null;
        if (replay) return { replay };
        const events = [];
        if (runRequest) pendingEvents = events;
        try {
          const result = (await route.handler({ req, res, params, query: url.searchParams, body, db })) ?? {};
          return { status: result.status ?? 200, payload: okBody(result.data ?? null), events };
        } finally {
          if (runRequest) pendingEvents = null;
        }
      };
      const committed = outcome => {
        if (key && !outcome.replay) idempotency.set(key, outcome.status, outcome.payload);
        for (const [type, data] of outcome.events ?? []) bus.emit(type, data);
      };
      const outcome = await (runRequest ? runRequest(execute, committed) : execute());
      if (!runRequest) committed(outcome);
      const status = outcome.replay?.status ?? outcome.status;
      const payload = outcome.replay?.body ?? outcome.payload;
      sendJson(res, status, payload, headers);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status ?? statusForCode(error.code), errorBody(error.code, error.message), headers);
        return;
      }
      const message = exposeErrors ? (error instanceof Error ? error.message : String(error)) : 'service temporarily unavailable';
      sendJson(res, 500, errorBody('internal', message), headers);
    }
  }

  const server = createHttpServer((req, res) => {
    void handle(req, res);
  });
  // 信令挂在 http server 上接管 `upgrade`；REST 与 WS 共用同一个端口、同一份令牌
  const signaling = attachSignaling({ server, db, hub, corsOrigins, now });

  return { server, router, db, idempotency, handle, now, hub, signaling };
}

export function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) urls.push(`http://${item.address}:${port}`);
    }
  }
  return urls;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
  const dataFile = process.env.CANTOBRIDGE_DATA ?? DEFAULT_DATA_FILE;
  const corsOrigins = (process.env.CANTOBRIDGE_CORS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const turn = turnFromEnv();
  const { server } = createServer({ db: createDb({ filePath: dataFile }), corsOrigins, turn });
  server.listen(port, '0.0.0.0', () => {
    console.log(`CantoBridge backend: http://localhost:${port}/api/health`);
    console.log(`数据快照: ${dataFile}`);
    console.log(
      `信令: ws://localhost:${port}/ws/match 与 ws://localhost:${port}/ws/rooms/<roomId>` +
        `（握手带 ?token=<令牌>）`,
    );
    console.log(turn ? `TURN: ${turn.urls.join(', ')}` : 'TURN: 未配置（本轮只下发 STUN，同 Wi-Fi 够用）');
    for (const url of lanUrls(port)) console.log(`手机同 Wi-Fi 打开: ${url}/api/health`);
  });
}

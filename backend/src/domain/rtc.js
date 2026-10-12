/**
 * ICE 服务器下发（契约 09 第 3.2 节 / 10 第 4.8 节 `GET /api/rtc/ice-servers`）。
 *
 * 本轮**先只回 STUN**：两台设备在同一个 Wi-Fi 下，双方各自拿到 NAT 映射就能直连；
 * TURN 是中继，只有跨网络 / 对称 NAT 才真的需要，按已定的口径后置（TODO 第 6 节）。
 * TURN 的地址与凭证从环境变量读（`CANTOBRIDGE_TURN_*`），以后要接只是改配置，不是改代码。
 *
 * **一处故意偏离契约**：契约写「拿不到 TURN 时返回 503 `turn_unavailable`」。
 * 这里改成「有 STUN 就 200，连 STUN 都没有才 503」。理由：demo 的 TURN 本来就是空的，
 * 真按契约回 503，前端连 STUN 都拿不到，只能整段降级到模拟通话 —— 那正好把
 * 「同 Wi-Fi 真机通话」这条最重要的演示路径掐死了。降级路径照样能演（契约 4.6 节）：
 * 前端拿到 503 一样要走「先本地档位、再模拟通话」。
 */

import { ApiError } from '../http/envelope.js';
import { requireSession } from '../http/auth.js';

export const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

/** 默认有效期：STUN 列表本身不过期，这个值是给前端做缓存 / TURN 续期的口径。 */
const DEFAULT_TTL_SEC = 3600;

export function createRtcHandlers({
  db,
  now = () => Date.now(),
  stunUrls = DEFAULT_STUN_URLS,
  turn = null,
  ttlSec = DEFAULT_TTL_SEC,
} = {}) {
  return {
    /** GET /api/rtc/ice-servers —— 进房协商前拉一次。 */
    async iceServers(ctx) {
      requireSession(ctx.req, db);

      const iceServers = [];
      const urls = (stunUrls ?? []).filter(Boolean);
      if (urls.length > 0) iceServers.push({ urls });

      const turnUrls = (turn?.urls ?? []).filter(Boolean);
      if (turnUrls.length > 0) {
        iceServers.push({
          urls: turnUrls,
          username: turn.username ?? null,
          credential: turn.credential ?? null,
        });
      }

      if (iceServers.length === 0) {
        throw new ApiError('turn_unavailable', 'no ICE servers configured');
      }

      return { data: { iceServers, expiresAt: new Date(now() + ttlSec * 1000).toISOString() } };
    },
  };
}

/** CLI 用：把环境变量读成 `turn` 选项；没配就是 `null`（本轮的正常状态）。 */
export function turnFromEnv(env = process.env) {
  const urls = String(env.CANTOBRIDGE_TURN_URL ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;
  return {
    urls,
    username: env.CANTOBRIDGE_TURN_USERNAME ?? null,
    credential: env.CANTOBRIDGE_TURN_CREDENTIAL ?? null,
  };
}

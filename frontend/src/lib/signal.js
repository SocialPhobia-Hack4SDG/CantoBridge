/**
 * 信令地址解析（纯函数，便于单测）。
 *
 * 为什么单独一个模块：`rtc.js` 的远端档位要一个 **WebSocket 地址**，而这个地址必须与
 * REST 的 `baseUrl` 同一套口径（同源 / `&direct` / `&backend=`）——否则会出现
 * 「接口打到 A 后端、信令连到 B 后端」这种最难查的错。
 *
 * 三个来源，优先级从高到低：
 *   1. `?signal=<url>` 显式指定（信令单独部署时用；现场做兜底演练也靠它）
 *   2. `baseUrl`（由 `?direct` / `&backend=` 决定）→ http→ws / https→wss
 *   3. 同源（默认）→ 按当前页面协议推 `wss:` / `ws:`，路径固定 `/ws`
 *
 * 契约依据：`frontend/docs/10-api-v1.md` 第 5 节；频道常量与后端
 * `backend/src/ws/protocol.js` 的 `MATCH_CHANNEL` / `ROOM_CHANNEL_PREFIX` 一致。
 */

/** 信令的固定路径前缀，与 REST 的 `/api` 平级。 */
export const SIGNAL_PATH = '/ws';

/**
 * 解析信令基址（**不含**频道后缀，房间频道由 `roomSignalUrl()` 拼）。
 * 解析不出来时返回空串——调用方据此降级，而不是拿一个坏地址去连。
 */
export function resolveSignalUrl({ baseUrl = '', protocol = 'http:', host = 'localhost', explicit = '' } = {}) {
  const override = String(explicit ?? '').trim();
  if (override) return override.replace(/\/+$/, '');

  const raw = String(baseUrl ?? '').trim();
  if (!raw) {
    // 同源：页面是 https 就用 wss（https 页面连 ws:// 会被浏览器按 mixed content 拒掉）
    const scheme = protocol === 'https:' ? 'wss:' : 'ws:';
    return scheme + '//' + (host || 'localhost') + SIGNAL_PATH;
  }

  // 显式后端：只换协议头，路径前缀与 REST 的 `/api` 平级
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return '';
  }
  const scheme = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return scheme + '//' + parsed.host + SIGNAL_PATH;
}

/** 把信令基址拼成某个房间的频道地址（后端 `/ws/rooms/:roomId`）。 */
export function roomSignalUrl(base, roomId) {
  const root = String(base ?? '').replace(/\/+$/, '');
  if (!root) return '';
  return root + '/rooms/' + encodeURIComponent(String(roomId ?? ''));
}

/**
 * 把信令基址拼成**匹配频道**地址（后端 `/ws/match`）。
 *
 * 匹配频道与房间频道是两条独立的连接：房间频道跟着房间页的生灭，
 * 匹配频道要在整个会话里一直挂着（排队、挑人、被挑中都靠它）。
 */
export function matchSignalUrl(base) {
  const root = String(base ?? '').replace(/\/+$/, '');
  if (!root) return '';
  return root + '/match';
}

/**
 * requestId 幂等（契约第 3.3 节）：所有写接口都带客户端生成的 `requestId`，
 * 服务端对同一个 key 去重——**重复提交返回第一次的结果，而不是报错**。
 *
 * 为什么必须有：弱网重试不能让用户看到「房间号变了」或「XP 加了两次」。
 * 这里先用内存 Map（demo 够用）；键里带令牌，避免不同账号用同一个 requestId 互相串结果。
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

export function createIdempotency({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
  /** @type {Map<string, {status:number, body:object, at:number}>} */
  const entries = new Map();

  function prune() {
    const current = now();
    for (const [key, value] of entries) {
      if (current - value.at > ttlMs) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  }

  return {
    keyFor(req, token, requestId) {
      const path = String(req.url ?? '').split('?')[0];
      return [token ?? 'anon', req.method, path, requestId].join('|');
    },

    get(key) {
      prune();
      return entries.get(key) ?? null;
    },

    set(key, status, body) {
      entries.set(key, { status, body, at: now() });
      prune();
    },

    size() {
      return entries.size;
    },

    clear() {
      entries.clear();
    },
  };
}

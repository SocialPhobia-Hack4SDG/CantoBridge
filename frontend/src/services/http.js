/**
 * HTTP 底层：只做「每个请求都要做一遍」的事——
 *   拼 URL / query、带 Bearer 令牌、写请求自动补 `requestId`、拆统一信封、错误码 → `ApiError`。
 *
 * **不做业务形状转换**（那是 adapters.js 的事），**不做方法映射**（那是 httpApi.js 的事）。
 * 这样 38 个方法共用一套请求逻辑，出问题时只需要看这一个文件。
 *
 * 契约依据：`frontend/docs/10-api-v1.md` 第 3.1（信封与状态码）、3.2（鉴权）、3.3（幂等）节。
 */

import { ApiError } from './mockApi.js';

/** 令牌落在 localStorage：刷新之后还在（契约 3.2 的「不透明令牌」，演示期 12 小时）。 */
export const TOKEN_KEY = 'cantobridge:token';

const DEFAULT_TIMEOUT_MS = 8000;

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式下访问 localStorage 会抛异常：当成没有存储，令牌退化成「只在内存里」
    return null;
  }
}

/**
 * 读当前落盘的令牌。**给信令握手用**：浏览器 `WebSocket` 构造函数不允许自定义请求头，
 * 所以 `/ws/rooms/:roomId` 只能走 `?token=`（后端 `protocol.js` 的 `readHandshakeToken`）。
 *
 * 为什么不做成 `api.getToken()`：`check-api.mjs` 第 7b 条要求 `createHttpApi()` 与
 * `createMockApi()` 的方法名**逐个相等**，给 api 多挂一个属性就会判红。令牌本来就在
 * localStorage 里，按同一个键读回来是等价的（且不依赖 api 实例）。
 */
export function readStoredToken(storage = null) {
  try {
    return (storage ?? safeStorage())?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function createHttpClient({
  baseUrl = '',
  store = null,
  fetchImpl = null,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // baseUrl 结尾的斜杠统一去掉，拼路径时只加一个「/」
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

  let token = readStoredToken();

  function getToken() {
    return token;
  }

  function setToken(next) {
    token = next ?? null;
    try {
      if (token) safeStorage()?.setItem(TOKEN_KEY, token);
      else safeStorage()?.removeItem(TOKEN_KEY);
    } catch {
      // 存不进去也不影响这次会话（内存里还有）
    }
    return token;
  }

  function clearToken() {
    return setToken(null);
  }

  let seq = 0;
  /** 幂等键：写接口必须唯一，优先用 crypto.randomUUID，退化时用「时钟 + 序号」。 */
  function newRequestId() {
    seq += 1;
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ?? `rid-${now().toString(36)}-${seq}`;
  }

  function buildUrl(path, query) {
    const suffix = String(path ?? '').startsWith('/') ? path : '/' + String(path ?? '');
    let url = base + suffix;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        params.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
      const qs = params.toString();
      if (qs) url += '?' + qs;
    }
    return url;
  }

  function withTimeout() {
    if (!(timeoutMs > 0)) return undefined;
    const timeout = globalThis.AbortSignal?.timeout;
    return typeof timeout === 'function' ? timeout(timeoutMs) : undefined;
  }

  /**
   * 发一个请求，成功返回**拆好的 data**，失败抛 `ApiError`（与 mock 层同一种错误类型）。
   * `auth: false` 用于登录这类还没令牌的接口。
   */
  async function request(method, path, { body = null, query = null, auth = true } = {}) {
    const upper = String(method ?? 'GET').toUpperCase();
    const headers = {};
    if (body !== null) headers['content-type'] = 'application/json';
    if (auth && token) headers.authorization = 'Bearer ' + token;

    const url = buildUrl(path, query);
    const init = { method: upper, headers };
    if (body !== null) {
      // 写请求统一带幂等键：弱网重试 / 双击不会把 XP 加两次（契约 3.3）
      init.body = JSON.stringify({ ...(body ?? {}), requestId: body?.requestId ?? newRequestId() });
    }
    const signal = withTimeout();
    if (signal) init.signal = signal;

    let response;
    try {
      response = await doFetch(url, init);
    } catch (error) {
      throw new ApiError('internal', 'network failed: ' + (error?.message ?? String(error)));
    }

    if (!response || typeof response.text !== 'function') {
      throw new ApiError('internal', 'malformed fetch response for ' + upper + ' ' + url);
    }

    let text = '';
    try {
      text = await response.text();
    } catch (error) {
      throw new ApiError('internal', 'failed to read response body: ' + (error?.message ?? String(error)));
    }

    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    /* 契约 3.1：失败一律 `{ ok: false, error: { code, message } }`，前端只认 code。 */
    if (parsed && parsed.ok === false) {
      const code = parsed.error?.code ?? 'internal';
      if (code === 'not_authorized') clearToken();
      throw new ApiError(code, parsed.error?.message ?? code);
    }

    const status = Number(response.status ?? 0);
    if (status === 401) {
      clearToken();
      throw new ApiError('not_authorized', 'HTTP 401 ' + upper + ' ' + url);
    }
    if (status >= 400 || response.ok === false) {
      throw new ApiError('internal', 'HTTP ' + status + ' ' + upper + ' ' + url);
    }
    if (!parsed || parsed.ok !== true) {
      // 非 JSON / 信封不合规（例如反代返回了一段 HTML）都算服务端异常，绝不把半个对象交给页面
      throw new ApiError('internal', 'malformed envelope from ' + upper + ' ' + url);
    }

    return parsed.data;
  }

  return { request, getToken, setToken, clearToken, newRequestId, buildUrl, baseUrl: base };
}

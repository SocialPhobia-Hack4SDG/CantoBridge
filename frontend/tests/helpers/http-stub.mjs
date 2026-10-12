/**
 * 测试用的假 fetch：**不联网**，把后端的真实响应片段回放给 httpApi。
 *
 * 用法：`const fetchImpl = createFetchStub((call) => ok({...}))`，
 * 之后 `fetchImpl.calls` 里能看到每次请求的 URL / 方法 / 请求头 / body（用于断言幂等键、令牌头等）。
 */

export function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** 成功信封：`{ ok: true, data }`。 */
export function ok(data) {
  return jsonResponse({ ok: true, data });
}

/** 失败信封：`{ ok: false, error: { code, message } }`。 */
export function fail(code, message = code, { status = 400 } = {}) {
  return jsonResponse({ ok: false, error: { code, message } }, { status });
}

/** 非 JSON 响应（模拟反代返回 HTML）。 */
export function raw(text, { status = 200 } = {}) {
  return { ok: status < 400, status, text: async () => text };
}

/**
 * 造一个 fetch 替身。`handler(call, index)` 返回 Response 替身；抛 Error 表示网络异常。
 * 每一次调用都记进 `fetchImpl.calls`。
 */
export function createFetchStub(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: String(init.method ?? 'GET').toUpperCase(),
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : null,
      hasSignal: Boolean(init.signal),
    };
    calls.push(call);
    const result = await handler(call, calls.length);
    if (result instanceof Error) throw result;
    return result;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** 按「方法 + 路径后缀」分发的简单路由表。 */
export function routeTable(routes) {
  return (call) => {
    for (const [key, value] of Object.entries(routes)) {
      const [method, pathPart] = key.split(' ');
      if (call.method === method && call.url.includes(pathPart)) {
        return typeof value === 'function' ? value(call) : value;
      }
    }
    return fail('not_found', 'no stub route for ' + call.method + ' ' + call.url, { status: 404 });
  };
}

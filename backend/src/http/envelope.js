/**
 * 统一信封与错误码（契约见 frontend/docs/10-api-v1.md 第 3.1 节）。
 *
 * 成功：`{ ok: true, data: ... }`
 * 失败：`{ ok: false, error: { code, message } }`
 *
 * 前端**只认 `error.code`**，`message` 只用来打日志；所以这里的 code 必须是
 * 契约里声明过的那些串（tools/check-contract.mjs 会把没声明的 code 拦下来）。
 */

/** 错误码 → HTTP 状态码。契约第 3.1 节的状态码表就是这份映射的由来。 */
export const STATUS_BY_CODE = {
  bad_request: 400,
  not_authorized: 401,
  forbidden: 403,
  not_found: 404,
  room_gone: 404,
  method_not_allowed: 405,
  already_queued: 409,
  room_taken: 409,
  already_buddy: 409,
  queue_expired: 410,
  match_request_expired: 410,
  rate_limited: 429,
  turn_unavailable: 503,
  internal: 500,
};

/** 业务错误：handler 里 throw 它，顶层接到之后按 code 生成信封。 */
export class ApiError extends Error {
  constructor(code, message, status = null) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status ?? statusForCode(code);
  }
}

export function statusForCode(code) {
  return STATUS_BY_CODE[code] ?? 400;
}

export function okBody(data) {
  return { ok: true, data };
}

export function errorBody(code, message) {
  return { ok: false, error: { code, message: message ?? code } };
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

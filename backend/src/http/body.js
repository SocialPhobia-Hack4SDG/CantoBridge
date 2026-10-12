/**
 * 请求体解析：只接受 JSON 对象，坏 JSON / 非对象 / 超长都收敛成 400 bad_request。
 * 空体视作 `{}`（很多写接口的字段都可选，例如 `PUT /api/me/settings`）。
 */

import { ApiError } from './envelope.js';

export const MAX_BODY_BYTES = 64 * 1024;

export async function readJsonBody(req, { limit = MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError('bad_request', 'request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError('bad_request', 'request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('bad_request', 'request body must be a JSON object');
  }
  return parsed;
}

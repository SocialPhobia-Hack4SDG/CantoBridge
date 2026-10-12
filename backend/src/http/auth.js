/**
 * 鉴权：不透明令牌 + `Authorization: Bearer <token>`（契约第 3.2 节）。
 *
 * demo 阶段是固定演示账号一键进入：`POST /api/auth/session` 发一个令牌，
 * 之后所有需要登录的接口都要带它，缺失 / 过期 / 不认识 → 401 `not_authorized`。
 */

import { ApiError } from './envelope.js';

export function issueToken(store, { userId, role, ttlMs }) {
  return store.createSession({ userId, role, ttlMs });
}

/** 从请求头取令牌；没有就返回 null（由各接口自己决定要不要强制）。 */
export function readToken(req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** 强制登录：拿不到有效会话就抛 401。 */
export function requireSession(req, store) {
  const token = readToken(req);
  if (!token) throw new ApiError('not_authorized', 'missing bearer token');
  const session = store.getSession(token);
  if (!session) throw new ApiError('not_authorized', 'invalid or expired token');
  return session;
}

/**
 * 字段校验：把「契约里写死的枚举 / 类型 / 上限」变成可复用的断言。
 *
 * 原则：**越界一律 400 `bad_request`，并且说清是哪个字段**——前端在表单上就地提示，
 * 不该出现「服务端 500 但用户不知道为什么」。
 */

import { ApiError } from '../http/envelope.js';

export function pickRequestId(body) {
  const requestId = body?.requestId;
  if (requestId === undefined || requestId === null || requestId === '') return null;
  return String(requestId);
}

export function assertEnum(value, allowed, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!allowed.includes(value)) {
    throw new ApiError('bad_request', `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function assertBoolean(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ApiError('bad_request', `${field} must be a boolean`);
  return value;
}

export function assertEnumArray(value, allowed, field, { max = null } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new ApiError('bad_request', `${field} must be an array`);
  const unique = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item)) {
      throw new ApiError('bad_request', `${field} has an unknown value: ${String(item)}`);
    }
    if (!unique.includes(item)) unique.push(item);
  }
  if (max !== null && unique.length > max) {
    throw new ApiError('bad_request', `${field} allows at most ${max} values`);
  }
  return unique;
}

/** 只接受白名单字段；其余字段：服务端自有的静默忽略，真不认识的就 400。 */
export function assertKnownKeys(body, { allowed = [], ignored = [] } = {}, context) {
  for (const key of Object.keys(body ?? {})) {
    if (allowed.includes(key) || ignored.includes(key)) continue;
    throw new ApiError('bad_request', `unknown field for ${context}: ${key}`);
  }
}

export function assertString(value, field, { maxLength = 200 } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ApiError('bad_request', `${field} must be a non-empty string (<= ${maxLength})`);
  }
  return value;
}

/** 整数（时长、卡片张数这类）：越界 / 非数字一律 400；`defaultValue` 只在字段缺省时生效。 */
export function assertInt(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, defaultValue = undefined } = {}) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ApiError('bad_request', `${field} must be an integer`);
  }
  if (value < min || value > max) {
    throw new ApiError('bad_request', `${field} must be between ${min} and ${max}`);
  }
  return value;
}

/**
 * 字符串数组（例如结算里的 `topics`）：去重、每个元素非空、限制长度。
 * 与 `assertEnumArray` 的区别：**不查词表**——话题 id 的真源是卡池（`topicDatabase.js`），
 * 不是前端标签词表，硬套词表会把 `university` / `daily_life` 这类合法话题误判成 400。
 */
export function assertStringArray(value, field, { max = 32, maxLength = 60 } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new ApiError('bad_request', `${field} must be an array`);
  const unique = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLength) {
      throw new ApiError('bad_request', `${field} must contain non-empty strings (<= ${maxLength})`);
    }
    if (!unique.includes(item)) unique.push(item);
  }
  if (unique.length > max) throw new ApiError('bad_request', `${field} allows at most ${max} values`);
  return unique;
}

/** 一组布尔开关（例如 visibility）：只认已知子键，值必须是布尔。 */
export function assertBooleanMap(value, allowed, field) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('bad_request', `${field} must be an object`);
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new ApiError('bad_request', `unknown ${field} key: ${key}`);
    if (typeof item !== 'boolean') throw new ApiError('bad_request', `${field}.${key} must be a boolean`);
    out[key] = item;
  }
  return out;
}

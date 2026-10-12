/**
 * 极简哈希路由（纯函数，可在 Node 里单测）。
 * 支持 `/room/:roomId` 这类具名段与 `*` 兜底路由，与 docs/03 的路由表一一对应。
 */

export const DEFAULT_PATH = '/';

/** 把 location.hash 解析成路径；忽略查询串但保留解析结果。 */
export function parseHash(hash) {
  const raw = typeof hash === 'string' ? hash : '';
  const withoutMarker = raw.startsWith('#') ? raw.slice(1) : raw;
  if (withoutMarker.length === 0) return { path: DEFAULT_PATH, query: {} };
  const [rawPath, rawQuery = ''] = withoutMarker.split('?');
  const path = normalizePath(rawPath);
  const query = {};
  if (rawQuery.length > 0) {
    for (const pair of rawQuery.split('&')) {
      if (pair.length === 0) continue;
      const [key, value = ''] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return { path, query };
}

export function normalizePath(path) {
  const trimmed = String(path ?? '').trim();
  if (trimmed.length === 0) return DEFAULT_PATH;
  const withLeading = trimmed.startsWith('/') ? trimmed : '/' + trimmed;
  if (withLeading.length > 1 && withLeading.endsWith('/')) return withLeading.slice(0, -1);
  return withLeading;
}

/** 匹配单条路由模板，返回参数对象或 null。 */
export function matchPath(pattern, path) {
  if (pattern === '*') return {};
  const target = normalizePath(path);
  const patternSegments = normalizePath(pattern).split('/').filter(Boolean);
  const targetSegments = target.split('/').filter(Boolean);
  if (patternSegments.length !== targetSegments.length) return null;
  const params = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const targetSegment = targetSegments[index];
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(targetSegment);
      continue;
    }
    if (patternSegment !== targetSegment) return null;
  }
  return params;
}

/** routes: [{ path, name, titleKey }]，顺序即优先级，`*` 建议放最后。 */
export function createRouter(routes) {
  const list = Array.isArray(routes) ? routes : [];
  return {
    routes: list,
    match(path) {
      const target = normalizePath(path);
      for (const route of list) {
        const params = matchPath(route.path, target);
        if (params !== null) return { route, params, path: target };
      }
      return { route: { path: '*', name: 'notFound' }, params: {}, path: target };
    },
    /** 用参数反向拼出一个具体路径，便于页面之间跳转。 */
    href(pattern, params = {}) {
      const segments = normalizePath(pattern)
        .split('/')
        .filter(Boolean)
        .map((segment) =>
          segment.startsWith(':') ? String(params[segment.slice(1)] ?? '') : segment,
        );
      return segments.length === 0 ? DEFAULT_PATH : '/' + segments.join('/');
    },
  };
}
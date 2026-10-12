/**
 * 极简路由表：注册 `GET /api/rooms/:roomId` 这种路径，自动解析 :param。
 *
 * 为什么不每个接口写一套 if：
 *   1. 30 多个接口都要做「路径参数解析 + 方法不匹配时给 405」这两件事；
 *   2. tools/check-contract.mjs 需要一份**可枚举的路由清单**去和 docs/10 的端点表比对，
 *      散落的 if 拿不出这份清单。
 *
 * 匹配规则：按 `/` 切段、逐段比较；`:name` 段吃任意非空段并收进 params。
 * 同一个路径注册了其它方法 → 405 method_not_allowed（而不是 404）。
 */

import { ApiError } from './envelope.js';

function splitPath(path) {
  return String(path)
    .split('?')[0]
    .split('/')
    .filter((segment) => segment.length > 0);
}

export function createRouter() {
  /** @type {{method: string, path: string, segments: string[], handler: Function, options: object}[]} */
  const routes = [];

  function add(method, path, handler, options = {}) {
    routes.push({
      method: method.toUpperCase(),
      path,
      segments: splitPath(path),
      handler,
      options,
    });
    return api;
  }

  function match(method, path) {
    const target = splitPath(path);
    const upper = method.toUpperCase();
    let pathMatched = false;
    for (const route of routes) {
      if (route.segments.length !== target.length) continue;
      const params = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const pattern = route.segments[index];
        const actual = target[index];
        if (pattern.startsWith(':')) {
          params[pattern.slice(1)] = decodeURIComponent(actual);
          continue;
        }
        if (pattern !== actual) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathMatched = true;
      if (route.method === upper || (route.method === 'GET' && upper === 'HEAD')) {
        return { route, params };
      }
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }

  /** 供契约校验与文档使用：已注册的 method + path 清单。 */
  function list() {
    return routes.map((route) => ({ method: route.method, path: route.path, options: route.options }));
  }

  const api = {
    add,
    get: (path, handler, options) => add('GET', path, handler, options),
    post: (path, handler, options) => add('POST', path, handler, options),
    put: (path, handler, options) => add('PUT', path, handler, options),
    delete: (path, handler, options) => add('DELETE', path, handler, options),
    match,
    list,
  };

  return api;
}

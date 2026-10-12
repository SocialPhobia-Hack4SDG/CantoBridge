/**
 * 字典接口（Phase 1）：把词表下发给前端。
 * 内容与 frontend/src/data/tags.js 逐值一致，由 tests/contract.test.mjs 保证。
 */

import { ApiError } from '../http/envelope.js';
import { publicTags } from '../data/vocabularies.js';

export function createDictionaryHandlers() {
  return {
    /** GET /api/tags —— `kind` 可选：给了就只回那一张表（不带就是一次全给）。 */
    async tags(ctx) {
      const kind = ctx.query.get('kind');
      const all = publicTags();
      if (!kind) return { data: all };
      if (!Object.prototype.hasOwnProperty.call(all, kind)) {
        throw new ApiError('bad_request', `unknown kind: ${kind}`);
      }
      return { data: { [kind]: all[kind] } };
    },
  };
}

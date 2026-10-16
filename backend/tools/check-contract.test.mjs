/**
 * 校验脚本自己的测试：既要有「真实仓库零错误」，也要证明**它真的拦得住**不一致
 * （否则任何改动都能悄悄通过，校验形同虚设）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkContract, implementedRoutes } from './check-contract.mjs';
import { ALL_VOCABULARIES } from '../src/data/vocabularies.js';

/** Phase 0~4 已经实现的契约内端点（账号资料 + 匹配成房 + 房间结算 + 伙伴关系 + 沉淀 + ICE）。 */
const EXPECTED_ROUTES = [
  'POST /api/genai/topic-cards',
  'POST /api/genai/tutor/reply',
  'DELETE /api/match/queue',
  'DELETE /api/me/buddies/:peerId',
  'DELETE /api/me/buddy-requests/:peerId',
  'GET /api/leaderboard',
  'GET /api/match/candidates/:learnerId',
  'GET /api/match/queue',
  'GET /api/match/recommendations',
  'GET /api/me',
  'GET /api/me/buddies',
  'GET /api/me/buddy-requests',
  'GET /api/me/history',
  'GET /api/me/progress',
  'GET /api/me/shop',
  'POST /api/me/shop/redeem',
  'GET /api/rooms/:roomId',
  'GET /api/rooms/:roomId/cards',
  'GET /api/rtc/ice-servers',
  'GET /api/tags',
  'POST /api/auth/logout',
  'POST /api/auth/session',
  'POST /api/match/queue',
  'POST /api/me/buddy-requests',
  'POST /api/me/buddy-requests/:peerId/accept',
  'POST /api/me/buddy-requests/:peerId/decline',
  'POST /api/me/saved-phrases',
  'POST /api/rooms/:roomId/end',
  'POST /api/rooms/:roomId/feedback',
  'POST /api/match/requests/:requestId/accept',
  'POST /api/match/requests/:requestId/decline',
  'POST /api/rooms',
  'PUT /api/match/criteria',
  'PUT /api/me/profile/buddy',
  'PUT /api/me/profile/learner',
  'PUT /api/me/settings',
];

test('真实仓库：后端已实现路由与 docs/10 契约零错误', async () => {
  const { errors, stats } = await checkContract();
  assert.deepEqual(errors, []);
  assert.equal(stats.documentedEndpointCount, 39, '契约里一共 39 个端点，含两个GenAI预留接口');
  assert.equal(stats.vocabularyCount, 10, '契约 3.6 的十张词表');
  assert.match(stats.coverage, /%$/);

  // 已实现的契约内路由：少一个或多一个都要红。
  const implemented = implementedRoutes()
    .map((route) => `${route.method.toUpperCase()} ${route.path}`)
    .sort();
  assert.deepEqual(implemented, [...EXPECTED_ROUTES].sort());
  assert.equal(stats.implementedEndpointCount, EXPECTED_ROUTES.length);
  // 39 条里已实现 36 条（GenAI两个接口当前仅示例实现）。
  assert.equal(stats.coverage, '92%');

  // `contract: false` 的本地口子（health / dev reset / dev match-request / dev buddy-request）不算进覆盖率，但确实存在
  const allRoutes = implementedRoutes({ devRoutes: true });
  assert.equal(allRoutes.some((route) => route.path === '/api/health'), false);
  assert.equal(allRoutes.some((route) => route.path === '/api/dev/reset'), false);
  assert.equal(allRoutes.some((route) => route.path === '/api/dev/match-request'), false);
  assert.equal(allRoutes.some((route) => route.path === '/api/dev/buddy-request'), false);
});

test('契约里没声明的路由会被拦下', async () => {
  const routes = [...implementedRoutes(), { method: 'GET', path: '/api/nope', options: {} }];
  const { errors } = await checkContract({ routes });
  assert.ok(
    errors.some((error) => error.includes('/api/nope')),
    '应当报出未声明的路由，实际：' + JSON.stringify(errors),
  );
});

test('词表和前端 tags.js 不一致会被拦下', async () => {
  const vocabularies = { ...ALL_VOCABULARIES, INTERESTS: [...ALL_VOCABULARIES.INTERESTS, 'tea'] };
  const { errors } = await checkContract({ vocabularies });
  assert.ok(errors.some((error) => error.includes('INTERESTS') && error.includes('tea')));
});

test('少了整张词表也会被拦下（不是只有多值才红）', async () => {
  const vocabularies = { ...ALL_VOCABULARIES };
  delete vocabularies.BUDDY_TOPICS;
  const { errors } = await checkContract({ vocabularies });
  assert.ok(errors.some((error) => error.includes('BUDDY_TOPICS')), JSON.stringify(errors));
});

test('错误码没在契约里声明会被拦下', async () => {
  const { errors } = await checkContract({ statusByCode: { ...{ bad_request: 400 }, weird_code: 499 } });
  assert.ok(errors.some((error) => error.includes('weird_code')));
});

test('/api/tags 少下发或多下发字段会被拦下', async () => {
  const missing = await checkContract({ tagsResponseKeys: ['interests', 'levels'] });
  assert.ok(missing.errors.some((error) => error.includes('/api/tags 漏了契约声明的字段')));

  const extra = await checkContract({ tagsResponseKeys: ['interests', 'levels', 'languagesSpoken'] });
  assert.ok(extra.errors.some((error) => error.includes('/api/tags 下发了契约没写的字段')));
});

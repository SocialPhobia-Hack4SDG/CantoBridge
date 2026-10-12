import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRouter, matchPath, normalizePath, parseHash } from '../src/lib/router.js';

test('parseHash：空 hash 落到首页', () => {
  assert.deepEqual(parseHash(''), { path: '/', query: {} });
  assert.deepEqual(parseHash('#'), { path: '/', query: {} });
});

test('parseHash：带参数与查询串', () => {
  const parsed = parseHash('#/room/r-1?tab=2&lang=zh-Hant');
  assert.equal(parsed.path, '/room/r-1');
  assert.deepEqual(parsed.query, { tab: '2', lang: 'zh-Hant' });
});

test('normalizePath：补前导斜杠、去掉尾斜杠', () => {
  assert.equal(normalizePath('home'), '/home');
  assert.equal(normalizePath('/home/'), '/home');
  assert.equal(normalizePath('   '), '/');
});

test('matchPath：具名段与不匹配', () => {
  assert.deepEqual(matchPath('/room/:roomId', '/room/r-9'), { roomId: 'r-9' });
  assert.equal(matchPath('/room/:roomId', '/room'), null);
  assert.equal(matchPath('/home', '/me'), null);
  assert.deepEqual(matchPath('*', '/whatever'), {});
});

test('createRouter：命中、兜底与反向拼路径', () => {
  const router = createRouter([
    { path: '/', name: 'landing' },
    { path: '/room/:roomId', name: 'room' },
    { path: '*', name: 'notFound' },
  ]);
  assert.equal(router.match('/room/abc').route.name, 'room');
  assert.equal(router.match('/room/abc').params.roomId, 'abc');
  assert.equal(router.match('/nope').route.name, 'notFound');
  assert.equal(router.href('/room/:roomId', { roomId: 'r-3' }), '/room/r-3');
  assert.equal(router.href('/'), '/');
});

test('createRouter：缺参数时拼出可预期的路径而不是 undefined', () => {
  const router = createRouter([{ path: '/room/:roomId', name: 'room' }]);
  assert.equal(router.href('/room/:roomId', {}), '/room/');
});
/** HTTP 底层：URL 拼接、令牌、幂等键、信封拆解、错误码 → ApiError。 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoryStorage } from '../../src/app/store.js';
import { ApiError } from '../../src/services/mockApi.js';
import { TOKEN_KEY, createHttpClient } from '../../src/services/http.js';
import { createFetchStub, fail, ok, raw } from '../helpers/http-stub.mjs';

const BASE = 'http://localhost:8787';

test('buildUrl：baseUrl 结尾多余的斜杠不会拼出双斜杠，query 会跳过空值', () => {
  const http = createHttpClient({ baseUrl: BASE + '///', fetchImpl: createFetchStub(() => ok({})) });
  assert.equal(http.buildUrl('/api/me'), BASE + '/api/me');
  assert.equal(http.buildUrl('api/me'), BASE + '/api/me');
  assert.equal(
    http.buildUrl('/api/rooms/r-1/cards', { level: 'beginner', interests: ['anime', 'food'], count: undefined }),
    BASE + '/api/rooms/r-1/cards?level=beginner&interests=anime%2Cfood',
    '数组按逗号拼、undefined 直接丢掉',
  );
});

test('request：GET 不带 body；带令牌时自动加 Authorization 头', async () => {
  const fetchImpl = createFetchStub(() => ok({ userId: 'demo-01' }));
  const http = createHttpClient({ baseUrl: BASE, fetchImpl });
  http.setToken('t-123');

  const data = await http.request('GET', '/api/me');
  assert.deepEqual(data, { userId: 'demo-01' });
  const call = fetchImpl.calls[0];
  assert.equal(call.method, 'GET');
  assert.equal(call.body, null, 'GET 不该有请求体');
  assert.equal(call.headers.authorization, 'Bearer t-123');
  assert.equal(call.headers['content-type'], undefined, '没有 body 就不该带 content-type');
});

test('request：写请求自动补 requestId，两次调用不同', async () => {
  const fetchImpl = createFetchStub(() => ok({ ok: true }));
  const http = createHttpClient({ baseUrl: BASE, fetchImpl });

  await http.request('POST', '/api/match/queue', { body: { anonymous: true } });
  await http.request('POST', '/api/match/queue', { body: { anonymous: true } });

  const [first, second] = fetchImpl.calls;
  assert.equal(first.headers['content-type'], 'application/json');
  assert.equal(first.body.anonymous, true);
  assert.ok(typeof first.body.requestId === 'string' && first.body.requestId.length > 0, '写请求必须带幂等键');
  assert.notEqual(first.body.requestId, second.body.requestId, '每次写请求的幂等键都要不一样');
});

test('request：显式传进来的 requestId 不会被覆盖', async () => {
  const fetchImpl = createFetchStub(() => ok({ ok: true }));
  const http = createHttpClient({ baseUrl: BASE, fetchImpl });
  await http.request('POST', '/api/rooms/r-1/end', { body: { requestId: 'fixed-1' } });
  assert.equal(fetchImpl.calls[0].body.requestId, 'fixed-1');
});

test('request：失败信封按 error.code 抛 ApiError', async () => {
  const http = createHttpClient({
    baseUrl: BASE,
    fetchImpl: createFetchStub(() => fail('room_taken', 'room already claimed', { status: 409 })),
  });
  await assert.rejects(
    () => http.request('POST', '/api/rooms', { body: {} }),
    (error) => {
      assert.ok(error instanceof ApiError, '必须是同一种错误类型');
      assert.equal(error.code, 'room_taken');
      return true;
    },
  );
});

test('request：401 会顺手清掉令牌（令牌失效后不该继续带着它打）', async () => {
  const http = createHttpClient({
    baseUrl: BASE,
    fetchImpl: createFetchStub(() => fail('not_authorized', 'expired', { status: 401 })),
  });
  http.setToken('t-old');
  await assert.rejects(() => http.request('GET', '/api/me'), (error) => error.code === 'not_authorized');
  assert.equal(http.getToken(), null, '401 之后令牌必须清掉');
});

test('request：网络异常 / 非 JSON / 信封不合规 一律 internal', async () => {
  const network = createHttpClient({
    baseUrl: BASE,
    fetchImpl: createFetchStub(() => new Error('boom')),
  });
  await assert.rejects(() => network.request('GET', '/api/me'), (error) => error.code === 'internal');

  const notJson = createHttpClient({ baseUrl: BASE, fetchImpl: createFetchStub(() => raw('<html>502</html>')) });
  await assert.rejects(() => notJson.request('GET', '/api/me'), (error) => error.code === 'internal');

  const noEnvelope = createHttpClient({ baseUrl: BASE, fetchImpl: createFetchStub(() => raw('{"foo":1}')) });
  await assert.rejects(() => noEnvelope.request('GET', '/api/me'), (error) => error.code === 'internal');

  const serverError = createHttpClient({ baseUrl: BASE, fetchImpl: createFetchStub(() => raw('oops', { status: 500 })) });
  await assert.rejects(() => serverError.request('GET', '/api/me'), (error) => error.code === 'internal');
});

test('令牌：写进 localStorage，新客户端能读回来，clearToken 会删掉', () => {
  const previous = globalThis.localStorage;
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  try {
    const fetchImpl = createFetchStub(() => ok({}));
    const first = createHttpClient({ baseUrl: BASE, fetchImpl });
    first.setToken('t-persist');
    assert.equal(storage.getItem(TOKEN_KEY), 't-persist', '令牌要落 localStorage');

    const second = createHttpClient({ baseUrl: BASE, fetchImpl });
    assert.equal(second.getToken(), 't-persist', '刷新（新客户端）后令牌还在');

    second.clearToken();
    assert.equal(storage.getItem(TOKEN_KEY), null, 'clearToken 要删掉存储里的令牌');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('request：auth:false 时不带令牌（登录接口本来就还没有令牌）', async () => {
  const fetchImpl = createFetchStub(() => ok({ token: 't-1' }));
  const http = createHttpClient({ baseUrl: BASE, fetchImpl });
  http.setToken('t-should-not-be-sent');
  await http.request('POST', '/api/auth/session', { body: { role: 'learner' }, auth: false });
  assert.equal(fetchImpl.calls[0].headers.authorization, undefined);
});

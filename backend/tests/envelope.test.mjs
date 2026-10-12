/**
 * 地基用例：统一信封、状态码、CORS、requestId 幂等。
 * 这些是后面 30 多个接口共用的东西，所以单独盯住。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startTestServer } from './helpers/server.mjs';

test('信封与状态码：404 / 405 / 400 都是 { ok:false, error:{ code, message } }', async () => {
  const ui = await startTestServer();
  try {
    const notFound = await ui.request('GET', '/api/nope');
    assert.equal(notFound.status, 404);
    assert.equal(notFound.json.ok, false);
    assert.deepEqual(Object.keys(notFound.json.error).sort(), ['code', 'message']);
    assert.equal(notFound.json.error.code, 'not_found');

    // 路径存在但方法不对 → 405（而不是 404）
    const wrongMethod = await ui.request('DELETE', '/api/me');
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.json.error.code, 'method_not_allowed');

    const badJson = await ui.request('POST', '/api/auth/session', { body: '{ not json' });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error.code, 'bad_request');

    const arrayBody = await ui.request('POST', '/api/auth/session', { body: [1, 2, 3] });
    assert.equal(arrayBody.status, 400);
    assert.equal(arrayBody.json.error.code, 'bad_request');
  } finally {
    await ui.close();
  }
});

test('鉴权：没带令牌 / 令牌不认识 / 格式不对，一律 401 not_authorized', async () => {
  const ui = await startTestServer();
  try {
    const missing = await ui.request('GET', '/api/me');
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error.code, 'not_authorized');

    const unknown = await ui.request('GET', '/api/me', { token: 'not-a-real-token' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error.code, 'not_authorized');

    // 令牌格式不对（没有 Bearer 前缀）同样算没带
    const malformed = await ui.request('GET', '/api/me', { headers: { authorization: 'token abc' } });
    assert.equal(malformed.status, 401);
    assert.equal(malformed.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

test('CORS：放行 localhost 与局域网，其它 Origin 预检直接 403', async () => {
  const ui = await startTestServer();
  try {
    const allowed = await ui.request('OPTIONS', '/api/me', {
      headers: { origin: 'http://localhost:4173', 'access-control-request-method': 'GET' },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:4173');
    assert.match(allowed.headers.get('access-control-allow-headers'), /authorization/);

    const lan = await ui.request('OPTIONS', '/api/tags', {
      headers: { origin: 'http://192.168.1.23:4173', 'access-control-request-method': 'GET' },
    });
    assert.equal(lan.status, 204, '手机连同一 WiFi 的局域网地址要能过');

    const blocked = await ui.request('OPTIONS', '/api/me', {
      headers: { origin: 'http://evil.example.com', 'access-control-request-method': 'GET' },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, 'forbidden');

    // 真实请求也会带上 CORS 头（否则浏览器拿得到响应也读不了）
    const real = await ui.request('GET', '/api/tags', { headers: { origin: 'http://localhost:4173' } });
    assert.equal(real.status, 200);
    assert.equal(real.headers.get('access-control-allow-origin'), 'http://localhost:4173');

    // 没有 Origin 的客户端（curl / 测试）照常放行
    const curl = await ui.request('GET', '/api/tags');
    assert.equal(curl.status, 200);
    assert.equal(curl.headers.get('access-control-allow-origin'), null);
  } finally {
    await ui.close();
  }
});

test('requestId 幂等：同一个键重复提交返回第一次的结果，不会重复执行', async () => {
  const ui = await startTestServer();
  try {
    const first = await ui.request('POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: 'device-a', requestId: 'req-1' },
    });
    assert.equal(first.status, 201);
    const token = first.json.data.token;
    const accountId = first.json.data.userId;

    const replay = await ui.request('POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: 'device-a', requestId: 'req-1' },
    });
    assert.equal(replay.status, 201, '回放的状态码也要和第一次一致');
    assert.deepEqual(replay.json, first.json, '第二次必须原样返回第一次的结果');

    const different = await ui.request('POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: 'device-a', requestId: 'req-2' },
    });
    assert.notEqual(different.json.data.token, token, '不同的 requestId 才是新的一次');
    assert.equal(different.json.data.userId, accountId, '同一台设备不该因为换了 requestId 就换人');

    // 写资料同样幂等：重复提交不会把 onboarded / 兴趣写两遍，也不会顺手碰到另一份资料
    const profileBody = { interests: ['anime', 'food'], requestId: 'req-profile-1' };
    const write1 = await ui.request('PUT', '/api/me/profile/learner', { token, body: profileBody });
    const write2 = await ui.request('PUT', '/api/me/profile/learner', { token, body: profileBody });
    assert.equal(write1.status, 200);
    assert.deepEqual(write2.json, write1.json);
    assert.deepEqual(ui.db.getProfile(accountId, 'learner').interests, ['anime', 'food']);
    assert.deepEqual(ui.db.getProfile(accountId, 'buddy').interests, [], '写 learner 不碰 buddy');
    assert.equal(ui.db.getProfile(accountId, 'buddy').onboarded, false);
  } finally {
    await ui.close();
  }
});

test('幂等键只对写接口生效，且不同令牌互不串结果', async () => {
  const ui = await startTestServer();
  try {
    const tokenA = await ui.signIn('learner');
    const tokenB = await ui.signIn('buddy');

    const a = await ui.request('PUT', '/api/me/settings', { token: tokenA, body: { anonymous: false, requestId: 'same' } });
    const b = await ui.request('PUT', '/api/me/settings', { token: tokenB, body: { anonymous: true, requestId: 'same' } });
    assert.equal(a.json.data.settings.anonymous, false);
    assert.equal(b.json.data.settings.anonymous, true, '同一个 requestId 但不同令牌不该互相回放');

    // GET 不需要 requestId，也永远不会被幂等表挡住
    const read = await ui.request('GET', '/api/me', { token: tokenA });
    assert.equal(read.status, 200);
    assert.equal(read.json.ok, true);
  } finally {
    await ui.close();
  }
});

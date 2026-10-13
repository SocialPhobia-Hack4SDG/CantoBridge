import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startDeployment } from '../deploy/start.mjs';
import { memoryStorage } from './helpers/cloud.mjs';

const { WebSocket } = createRequire(new URL('../backend/package.json', import.meta.url))('ws');
const ORIGIN = 'https://cloud.example.test';
const INVITE = 'test-only-long-invitation';

async function fixture(t, { storage = memoryStorage(), maxAccounts = 50, turn = null } = {}) {
  const deployment = await startDeployment({
    config: { port: 0, origin: ORIGIN, inviteCode: INVITE, maxAccounts, trustProxy: false, turn }, storage,
    iceProvider: turn ? null : async () => ({ iceServers: [{ urls: ['turns:test.example:443'], username: 'test-user', credential: 'test-short-key' }], expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
  });
  t.after(() => deployment.close());
  const base = `http://127.0.0.1:${deployment.server.address().port}`;
  async function access(code = INVITE) {
    return fetch(base + '/_access', { method: 'POST', redirect: 'manual', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code }) });
  }
  const response = await access();
  assert.equal(response.status, 303);
  const setCookie = response.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  async function api(path, { method = 'GET', body, token, cookieOverride = cookie, origin = ORIGIN } = {}) {
    const response = await fetch(base + path, {
      method, headers: { cookie: cookieOverride, origin, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  async function signIn(id) {
    const result = await api('/api/auth/session', { method: 'POST', body: { role: 'learner', deviceId: 'test-device-' + id.padEnd(32, '0') } });
    assert.equal(result.status, 201);
    return result.body.data;
  }
  return { ...deployment, base, storage, api, access, signIn, cookie, setCookie };
}

function handshake(base, path, { token, cookie, origin = ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + path + '?token=' + token, {
      origin, headers: cookie ? { cookie } : {}, handshakeTimeout: 2000,
    });
    let unexpected = false;
    ws.on('error', error => { if (!unexpected) reject(error); });
    ws.once('unexpected-response', (_req, response) => { unexpected = true; response.resume(); ws.terminate(); resolve(response.statusCode); });
    ws.once('open', () => { ws.close(); resolve(101); });
  });
}

test('公网入口提供前端与同源 API，邀请 cookie 防篡改，密钥不出现在页面', async t => {
  const ui = await fixture(t);
  assert.match(ui.setCookie, /HttpOnly/);
  assert.match(ui.setCookie, /Secure/);
  assert.match(ui.setCookie, /SameSite=Lax/);
  const guest = await fetch(ui.base);
  assert.match(await guest.text(), /Invitation code/);
  const page = await fetch(ui.base, { headers: { cookie: ui.cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /type="module"/);
  const token = (await ui.signIn('one')).token;
  assert.equal((await ui.api('/api/me', { token })).status, 200);
  assert.equal((await ui.api('/api/me', { token, cookieOverride: '' })).status, 403);
  assert.equal((await ui.api('/api/me', { token, cookieOverride: ui.cookie + 'tampered' })).status, 403);
  assert.equal((await ui.api('/api/me', { token, origin: 'https://evil.example.test' })).status, 403);
  assert.equal((await ui.access('wrong')).status, 403);
  const health = await fetch(ui.base + '/api/health');
  assert.deepEqual(await health.json(), { ok: true, data: { status: 'ok' } });
});

test('公网仅分发运行素材，不暴露工具、文档、配置、依赖或开发接口', async t => {
  const ui = await fixture(t);
  for (const path of ['/tools/serve.mjs', '/tests/store.test.mjs', '/docs/10-api-v1.md', '/package.json', '/.env', '/node_modules/ws/index.js']) {
    const response = await fetch(ui.base + path, { headers: { cookie: ui.cookie } });
    assert.equal(response.status, 403, path);
  }
  assert.equal((await fetch(ui.base + '/cert.crt', { headers: { cookie: ui.cookie } })).status, 404);
  for (const path of ['/src/app/main.js', '/assets/branding/logo.png']) {
    assert.equal((await fetch(ui.base + path, { headers: { cookie: ui.cookie } })).status, 200, path);
  }
  assert.equal((await ui.api('/api/dev/reset', { method: 'POST', body: {} })).status, 404);
});

test('第三个有效账号不能查看房间、取卡、结算、反馈或加入房间信令', async t => {
  const ui = await fixture(t);
  const a = await ui.signIn('a'); const b = await ui.signIn('b'); const stranger = await ui.signIn('stranger');
  await ui.cloud.runRequest(() => ui.app.db.createRoom({ roomId: 'private-room', status: 'active', initiatorAccountId: a.userId, peerAccountId: b.userId }));
  for (const [method, path, body] of [
    ['GET', '/api/rooms/private-room'], ['GET', '/api/rooms/private-room/cards'],
    ['POST', '/api/rooms/private-room/end', { durationSec: 20, cardsUsed: 1 }],
    ['POST', '/api/rooms/private-room/feedback', { skipped: true }],
  ]) assert.equal((await ui.api(path, { method, body, token: stranger.token })).status, 403, path);
  assert.equal((await ui.api('/api/rooms/private-room', { token: a.token })).status, 200);
  assert.equal((await ui.api('/api/rooms/private-room/cards', { token: b.token })).status, 200);
  assert.equal(await handshake(ui.base, '/ws/rooms/private-room', { cookie: ui.cookie, token: stranger.token }), 403);
  assert.equal(await handshake(ui.base, '/ws/rooms/private-room', { cookie: ui.cookie, token: a.token }), 101);
  assert.equal(await handshake(ui.base, '/ws/match', { token: a.token }), 403);
  assert.equal(await handshake(ui.base, '/ws/match', { cookie: ui.cookie, token: a.token, origin: 'https://evil.example.test' }), 403);
});

test('公网同源信令真实转发 SDP 和翻卡，TURN 入口仅限登录用户', async t => {
  const ui = await fixture(t);
  const a = await ui.signIn('a'); const b = await ui.signIn('b');
  await ui.cloud.runRequest(() => ui.app.db.createRoom({ roomId: 'call', status: 'active', initiatorAccountId: a.userId, peerAccountId: b.userId }));
  const connect = async token => {
    const ws = new WebSocket(ui.base.replace('http:', 'ws:') + '/ws/rooms/call?token=' + token, { origin: ORIGIN, headers: { cookie: ui.cookie } });
    t.after(() => ws.terminate());
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return ws;
  };
  const left = await connect(a.token); const right = await connect(b.token);
  for (const message of [{ type: 'rtc:offer', sdp: { type: 'offer', sdp: 'test-sdp' } }, { type: 'room:card', cardId: 'test-card', index: 0, round: 0 }]) {
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('signal not received')), 2000);
      const handle = raw => { const value = JSON.parse(String(raw)); if (value.type === message.type) { clearTimeout(timeout); right.off('message', handle); resolve(value); } };
      right.on('message', handle);
    });
    left.send(JSON.stringify(message));
    assert.deepEqual(await received, message);
  }
  assert.equal((await ui.api('/api/rtc/ice-servers')).status, 401);
  const ice = await ui.api('/api/rtc/ice-servers', { token: a.token });
  assert.equal(ice.status, 200);
  assert.ok(ice.body.data.iceServers[0].credential);
});

test('并发重复请求只发一个令牌，数据库失败不会返回成功或缓存成功', async t => {
  const ui = await fixture(t);
  const body = { role: 'learner', deviceId: 'a'.repeat(36), requestId: 'same-request' };
  const results = await Promise.all([ui.api('/api/auth/session', { method: 'POST', body }), ui.api('/api/auth/session', { method: 'POST', body })]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(ui.app.db.count('users'), 1);
  assert.equal(ui.app.db.count('sessions'), 1);
  ui.storage.fail = true;
  const failed = await ui.api('/api/me/settings', { method: 'PUT', token: results[0].body.data.token, body: { anonymous: true, requestId: 'failed-write' } });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error.message, 'service temporarily unavailable');
  assert.equal(ui.app.db.getSettings(results[0].body.data.userId).anonymous, false);
  assert.equal(ui.app.idempotency.size(), 1);
  assert.equal((await fetch(ui.base + '/api/health')).status, 503);
});

test('账号上限和安全设备密钥要求不会阻止已有账号继续登录', async t => {
  const ui = await fixture(t, { maxAccounts: 2 });
  assert.equal((await ui.api('/api/auth/session', { method: 'POST', body: { role: 'learner', deviceId: 'short-id' } })).status, 400);
  const a = await ui.signIn('a'); await ui.signIn('b');
  const full = await ui.api('/api/auth/session', { method: 'POST', body: { role: 'learner', deviceId: 'new-user'.padEnd(36, '0') } });
  assert.equal(full.status, 429);
  assert.equal((await ui.signIn('a')).userId, a.userId);
});

test('实际重启公网服务后，账号和保存的个人资料仍可恢复', async t => {
  const storage = memoryStorage();
  const first = await fixture(t, { storage });
  const account = await first.signIn('same-device');
  const write = await first.api('/api/me/profile/learner', { method: 'PUT', token: account.token, body: { displayName: 'Cloud Tester' } });
  assert.equal(write.status, 200);
  const second = await fixture(t, { storage });
  const same = await second.signIn('same-device');
  assert.equal(same.userId, account.userId);
  const me = await second.api('/api/me', { token: same.token });
  assert.equal(me.body.data.learnerProfile.displayName, 'Cloud Tester');
});

test('邀请入口限制错误口令尝试，伪造转发头不能重置本地限流身份', async t => {
  const ui = await fixture(t);
  for (let i = 0; i < 9; i++) assert.equal((await ui.access('wrong')).status, 403);
  const blocked = await fetch(ui.base + '/_access', { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': 'spoofed-client', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: INVITE }) });
  assert.equal(blocked.status, 429);
});

test('已作废的会话不能继续使用打开的信令连接', async t => {
  const ui = await fixture(t);
  const account = await ui.signIn('revoked');
  const ws = new WebSocket(ui.base.replace('http:', 'ws:') + '/ws/match?token=' + account.token, { origin: ORIGIN, headers: { cookie: ui.cookie } });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await ui.cloud.runRequest(() => ui.app.db.deleteSession(account.token));
  const closed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('revoked session remained connected')), 2000);
    ws.once('close', code => { clearTimeout(timeout); resolve(code); });
  });
  ws.send(JSON.stringify({ type: 'ping' }));
  assert.equal(await closed, 4001);
});

test('单个账号不能无限建立信令连接，关闭旧连接后可以重新进入', async t => {
  const ui = await fixture(t);
  const account = await ui.signIn('many-tabs');
  const sockets = [];
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket(ui.base.replace('http:', 'ws:') + '/ws/match?token=' + account.token, { origin: ORIGIN, headers: { cookie: ui.cookie } });
    t.after(() => ws.terminate());
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    sockets.push(ws);
  }
  assert.equal(await handshake(ui.base, '/ws/match', { cookie: ui.cookie, token: account.token }), 429);
  await new Promise(resolve => { sockets[0].once('close', resolve); sockets[0].close(); });
  assert.equal(await handshake(ui.base, '/ws/match', { cookie: ui.cookie, token: account.token }), 101);
});

test('Metered 凭证通过已鉴权的公网 ICE 接口下发，不在页面或未登录请求中暴露', async t => {
  const turn = { urls: ['turn:relay.example.test:80', 'turns:relay.example.test:443?transport=tcp'], username: 'metered-test-user', credential: 'metered-test-password' };
  const ui = await fixture(t, { turn });
  const account = await ui.signIn('metered');
  assert.equal((await ui.api('/api/rtc/ice-servers')).status, 401);
  const result = await ui.api('/api/rtc/ice-servers', { token: account.token });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.iceServers.find(server => server.username === turn.username), turn);
  const page = await (await fetch(ui.base, { headers: { cookie: ui.cookie } })).text();
  assert.equal(page.includes(turn.credential), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createDb } from '../src/store/db.js';

async function fixture(t, options = {}) {
  const db = createDb();
  const app = createServer({ db, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.signaling.close();
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
  });
  return { db, base: `http://127.0.0.1:${app.server.address().port}` };
}

function handshake(url, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin, handshakeTimeout: 2000 });
    ws.on('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode);
    });
    ws.once('open', () => { ws.close(); resolve(101); });
  });
}

test('公网 ICE 配置：未配置仅 STUN，配置后下发 TURN；接口仍要求有效令牌', async t => {
  const plain = await fixture(t);
  const token = plain.db.createSession({ userId: 'audit-a', role: 'learner' }).token;
  const load = (base, auth) => fetch(base + '/api/rtc/ice-servers', { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
  assert.equal((await load(plain.base)).status, 401);
  const defaultIce = (await (await load(plain.base, token)).json()).data.iceServers;
  assert.ok(defaultIce.length > 0);
  assert.ok(defaultIce.every(server => server.urls.every(url => url.startsWith('stun:'))));
  const turn = { urls: ['turn:relay.example.test:3478', 'turns:relay.example.test:443'], username: 'test-only', credential: 'test-only' };
  const configured = await fixture(t, { turn });
  const configuredToken = configured.db.createSession({ userId: 'audit-b', role: 'buddy' }).token;
  const ice = (await (await load(configured.base, configuredToken)).json()).data.iceServers;
  assert.deepEqual(ice.find(server => server.urls.some(url => url.startsWith('turn:'))), turn);
});

test('公网 WebSocket Origin 必须显式放行，放行后仍拒绝无效令牌', async t => {
  const origin = 'https://call.example.test';
  const blocked = await fixture(t);
  const token = blocked.db.createSession({ userId: 'audit-a', role: 'learner' }).token;
  assert.equal(await handshake(blocked.base.replace('http:', 'ws:') + '/ws/match?token=' + token, origin), 403);
  const allowed = await fixture(t, { corsOrigins: [origin] });
  const allowedToken = allowed.db.createSession({ userId: 'audit-b', role: 'buddy' }).token;
  const wsBase = allowed.base.replace('http:', 'ws:') + '/ws/match?token=';
  assert.equal(await handshake(wsBase + allowedToken, origin), 101);
  assert.equal(await handshake(wsBase + 'invalid', origin), 401);
});

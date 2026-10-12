import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudflareIceProvider } from '../backend/src/domain/cloudflareTurn.js';
import { createDb } from '../backend/src/store/db.js';
import { newDeviceId } from '../frontend/src/app/store.js';

test('TURN 长期密钥只用于服务端签发，短期凭证按账号缓存且会到期刷新', async () => {
  let clock = 1_000_000;
  const requests = [];
  const provider = createCloudflareIceProvider({ keyId: 'test-id', apiToken: 'server-only-token', now: () => clock, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ iceServers: [{ urls: ['turns:turn.example.test:443'], username: 'short-user', credential: 'short-key-' + requests.length }] }) };
  } });
  const a = await provider({ userId: 'a' });
  assert.equal(requests[0].init.headers.authorization, 'Bearer server-only-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), { ttl: 3600 });
  assert.ok(requests[0].url.endsWith('/test-id/credentials/generate-ice-servers'));
  assert.equal(JSON.stringify(a).includes('server-only-token'), false);
  assert.equal(Date.parse(a.expiresAt), clock + 3_600_000);
  assert.deepEqual(await provider({ userId: 'a' }), a);
  assert.equal(requests.length, 1);
  await provider({ userId: 'b' });
  assert.equal(requests.length, 2);
  clock += 61_000;
  assert.notDeepEqual(await provider({ userId: 'a' }), a);
});

test('TURN 上游失败、非 JSON 或缺少中继凭证时返回明确错误且不泄露上游响应', async () => {
  for (const fetchImpl of [
    async () => { throw Error('server-only-token'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => { throw Error('server-only-token'); } }),
    async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: ['stun:example.test'] }] }) }),
  ]) {
    const provider = createCloudflareIceProvider({ keyId: 'id', apiToken: 'server-only-token', fetchImpl });
    await assert.rejects(provider({ userId: 'a' }), error => error.code === 'turn_unavailable' && !error.message.includes('server-only-token'));
  }
});

test('账号设备密钥与会话令牌具有足够随机长度且不会互相重复', () => {
  const ids = Array.from({ length: 50 }, newDeviceId);
  assert.equal(new Set(ids).size, 50);
  assert.ok(ids.every(id => id.length >= 32 && id.length <= 64));
  const db = createDb();
  const tokens = Array.from({ length: 50 }, () => db.createSession({ userId: 'u-a', role: 'learner' }).token);
  assert.equal(new Set(tokens).size, 50);
  assert.ok(tokens.every(token => /^demo-[a-f0-9]{64}$/.test(token)));
});

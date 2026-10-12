import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudDatabase, createSupabaseSnapshotStore } from '../backend/src/store/supabase.js';
import { createSeed } from '../backend/src/store/seed.js';
import { memoryStorage } from './helpers/cloud.mjs';

test('Supabase secret 与旧 JWT 使用正确服务端头部，响应不泄露凭证', async () => {
  for (const key of ['sb_secret_test-only', 'test-only-jwt']) {
    const calls = [];
    const store = createSupabaseSnapshotStore({ url: 'https://example.supabase.co', key, fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => init.method === 'POST' ? 1 : [] };
    } });
    assert.deepEqual(await store.load(), { revision: 0, data: createSeed() });
    assert.equal(await store.save(createSeed(), 0), 1);
    assert.equal(calls[0].init.headers.apikey, key);
    assert.equal(calls[0].init.headers.authorization, key.startsWith('sb_secret_') ? undefined : 'Bearer ' + key);
    assert.ok(calls[0].url.includes('/rest/v1/cantobridge_snapshots?'));
    assert.equal(calls[1].url, 'https://example.supabase.co/rest/v1/rpc/cantobridge_save_snapshot');
    assert.deepEqual(JSON.parse(calls[1].init.body), { snapshot_id: 'main', expected_revision: 0, snapshot_data: createSeed() });
    assert.equal(calls[1].init.redirect, 'error');
  }
});

test('云端读取失败、损坏快照、版本冲突和非 HTTPS 地址都不能静默清空数据', async () => {
  assert.throws(() => createSupabaseSnapshotStore({ url: 'http://example.test', key: 'test' }), /HTTPS/);
  for (const response of [
    { ok: false, status: 401, json: async () => ({ secret: 'must-not-leak' }) },
    { ok: true, json: async () => [{ revision: 1, data: { users: [] } }] },
    { ok: true, json: async () => ({ unexpected: true }) },
    { ok: true, json: async () => { throw Error('must-not-leak'); } },
  ]) {
    const store = createSupabaseSnapshotStore({ url: 'https://example.supabase.co', key: 'test', fetchImpl: async () => response });
    await assert.rejects(store.load(), error => !error.message.includes('must-not-leak'));
  }
  const store = createSupabaseSnapshotStore({ url: 'https://example.supabase.co', key: 'test', fetchImpl: async () => ({ ok: true, json: async () => 5 }) });
  await assert.rejects(store.save(createSeed(), 0), /conflict/);
});

test('云端重启保留账号、资料、积分和历史，清理旧排队及进行中房间', async () => {
  const storage = memoryStorage();
  const first = await createCloudDatabase({ storage });
  await first.runRequest(() => {
    first.db.createAccount({ accountId: 'u-a', deviceId: 'test-device' });
    first.db.updateProfile('u-a', 'learner', { displayName: 'Alice' });
    first.db.creditPoints('u-a', 20, 'earned-once', 'conversation');
    first.db.appendHistory('u-a', { sessionId: 'ended-room' });
    first.db.createRoom({ roomId: 'ended-room', status: 'ended' });
    first.db.createRoom({ roomId: 'active-room', status: 'active' });
    first.db.upsertQueueRow({ userId: 'learner-u-a', ownerAccountId: 'u-a' });
  });
  const second = await createCloudDatabase({ storage });
  assert.equal(second.db.findUserByDeviceId('test-device').userId, 'u-a');
  assert.equal(second.db.getProfile('u-a', 'learner').displayName, 'Alice');
  assert.equal(second.db.getWallet('u-a').balance, 20);
  assert.equal(second.db.listHistory('u-a')[0].sessionId, 'ended-room');
  assert.ok(second.db.getRoom('ended-room'));
  assert.equal(second.db.getRoom('active-room'), null);
  assert.equal(second.db.count('queue'), 0);
});

test('并发修改串行保存，数据库提交之后才通知调用方', async () => {
  const storage = memoryStorage();
  const cloud = await createCloudDatabase({ storage });
  const order = [];
  await Promise.all(Array.from({ length: 8 }, (_, i) => cloud.runRequest(async () => {
    order.push('start-' + i);
    await Promise.resolve();
    cloud.db.createAccount({ accountId: 'u-' + i });
    order.push('end-' + i);
  }, () => order.push('commit-' + i))));
  assert.equal((await storage.load()).data.users.length, 8);
  assert.deepEqual(order, Array.from({ length: 8 }, (_, i) => ['start-' + i, 'end-' + i, 'commit-' + i]).flat());
});

test('保存失败回滚内存、不发成功事件，并阻止不确定版本继续写入', async () => {
  const storage = memoryStorage();
  const cloud = await createCloudDatabase({ storage });
  storage.fail = true;
  let emitted = false;
  await assert.rejects(cloud.runRequest(() => cloud.db.createAccount({ accountId: 'u-failed' }), () => { emitted = true; }));
  assert.equal(cloud.db.count('users'), 0);
  assert.equal(emitted, false);
  assert.equal(cloud.ready(), false);
  storage.fail = false;
  await assert.rejects(cloud.runRequest(() => cloud.db.createAccount({ accountId: 'u-other' })), /restart required/);
});

test('业务失败回滚部分修改，但不锁死下一次正常请求', async () => {
  const cloud = await createCloudDatabase({ storage: memoryStorage() });
  await assert.rejects(cloud.runRequest(() => { cloud.db.createAccount({ accountId: 'partial' }); throw Error('bad input'); }));
  assert.equal(cloud.ready(), true);
  assert.equal(cloud.db.count('users'), 0);
  await cloud.runRequest(() => cloud.db.createAccount({ accountId: 'good' }));
  assert.equal(cloud.db.count('users'), 1);
});

test('部署重叠时旧实例的过期版本不能覆盖新实例数据', async () => {
  const storage = memoryStorage();
  const old = await createCloudDatabase({ storage });
  const current = await createCloudDatabase({ storage });
  await current.runRequest(() => current.db.createAccount({ accountId: 'new-user' }));
  await assert.rejects(old.runRequest(() => old.db.createAccount({ accountId: 'stale-user' })));
  assert.equal(old.ready(), false);
  assert.deepEqual((await storage.load()).data.users.map(user => user.userId), ['new-user']);
});

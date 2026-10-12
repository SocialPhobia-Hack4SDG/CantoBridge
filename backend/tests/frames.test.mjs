import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer } from './helpers/server.mjs';
import { createDb } from '../src/store/db.js';
import { createShopHandlers } from '../src/domain/shop.js';
import { cropPeer } from '../src/domain/peerView.js';
test('小徽章权限、零分兑换、重复兑换、身份同步、移除及重启持久化', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-frames-')); const path = join(dir, 'db.json');
  const ui = await startTestServer({ dataFile: path }); let accountId;
  try {
    const { token, userId } = await ui.signInAs('learner'); accountId = userId;
    const put = body => ui.request('PUT', '/api/me/profile/learner', { token, body });
    const initial = (await ui.request('GET', '/api/me', { token })).json.data;
    assert.equal(initial.learnerProfile.frameId, 'none'); assert.deepEqual(initial.progress.wallet.ownedFrames, ['none']);
    assert.equal((await put({ frameId: 'milk-tea', avatarId: 'female', displayName: '不能修改' })).status, 403);
    assert.equal(ui.db.getProfile(userId, 'learner').avatarId, 'neutral');
    for (const body of [{ frameId: null }, { frameId: 'url:test' }, { frameId: 'none', ownedFrames: ['pineapple'] }]) assert.equal((await put(body)).status, 400);
    for (const id of ['milk-tea', 'pineapple', 'tram']) {
      const purchase = await ui.request('POST', '/api/me/shop/redeem', { token, body: { itemId: 'badge-' + id } });
      assert.equal(purchase.status, 200); assert.equal(purchase.json.data.balance, 0); assert.ok(purchase.json.data.ownedFrames.includes(id));
      assert.equal((await put({ frameId: id })).status, 200);
      assert.equal(ui.db.getProfile(userId, 'buddy').frameId, id);
    }
    await ui.request('POST', '/api/me/shop/redeem', { token, body: { itemId: 'badge-tram' } });
    assert.equal(ui.db.getWallet(userId).transactions.length, 3);
    assert.equal(ui.db.getProfile(userId, 'learner').onboarded, false);
    ui.db.upsertQueueRow({ userId: 'frame-queue', ownerAccountId: userId });
    await put({ frameId: 'none' }); assert.equal(ui.db.findQueueRow('frame-queue').frameId, 'none');
    await put({ frameId: 'tram' });
    const stranger = await ui.signInAs('learner', { deviceId: 'frame-stranger' });
    assert.equal((await ui.request('PUT', '/api/me/profile/buddy', { token: stranger.token, body: { frameId: 'tram' } })).status, 403);
    assert.equal(cropPeer({ userId: 'x', anonymous: true, frameId: 'tram' }).frameId, 'none');
  } finally { await ui.close(); }
  try {
    const db = createDb({ filePath: path }); assert.equal(db.getProfile(accountId, 'buddy').frameId, 'tram'); assert.ok(db.getWallet(accountId).ownedFrames.includes('tram'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('小徽章正常价格不足时不能兑换；成功只扣可用积分，不影响累计分或其他商品', async () => {
  const ui = await startTestServer();
  try {
    const { token, userId } = await ui.signInAs('learner');
    const handlers = createShopHandlers({ db: ui.db, catalog: [{ id: 'badge-pineapple', type: 'frame', frameId: 'pineapple', price: 80 }] });
    const ctx = { req: { headers: { authorization: 'Bearer ' + token } }, body: { itemId: 'badge-pineapple' } };
    await assert.rejects(handlers.redeem(ctx), /insufficient/);
    ui.db.updateProgress(userId, { xp: 100 });
    const wallet = (await handlers.redeem(ctx)).data; assert.equal(wallet.balance, 20); assert.equal(ui.db.getProgress(userId).xp, 100);
    assert.ok(wallet.ownedFrames.includes('pineapple')); assert.ok(!wallet.ownedAvatars.includes('pineapple')); assert.ok(!wallet.ownedThemes.includes('pineapple'));
    assert.equal((await handlers.redeem(ctx)).data.balance, 20);
  } finally { await ui.close(); }
});

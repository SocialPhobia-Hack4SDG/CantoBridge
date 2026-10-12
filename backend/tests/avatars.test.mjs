import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestServer } from './helpers/server.mjs';
import { createDb } from '../src/store/db.js';
import { createShopHandlers } from '../src/domain/shop.js';
import { cropPeer } from '../src/domain/peerView.js';

test('绿背景男性头像只在商城兑换后解锁，并跨身份同步', async () => {
  const ui = await startTestServer();
  try {
    const { token } = await ui.signInAs('learner');
    const put = () => ui.request('PUT', '/api/me/profile/learner', { token, body: { avatarId: 'male-sage' } });
    assert.equal((await put()).status, 403);
    const shop = (await ui.request('GET', '/api/me/shop', { token })).json.data;
    assert.ok(shop.catalog.some(item => item.avatarId === 'male-sage'));
    assert.equal((await ui.request('POST', '/api/me/shop/redeem', { token, body: { itemId: 'avatar-male-sage' } })).status, 200);
    assert.equal((await put()).status, 200);
    const me = (await ui.request('GET', '/api/me', { token })).json.data;
    assert.equal(me.learnerProfile.avatarId, 'male-sage');
    assert.equal(me.buddyProfile.avatarId, 'male-sage');
    assert.equal(me.learnerProfile.onboarded, false);
  } finally { await ui.close(); }
});

test('头像默认与权限：免费选择同步两份资料，拒绝 URL、未解锁、伪造所有权', async () => {
  const ui = await startTestServer();
  try {
    const person = await ui.signInAs('learner');
    const token = person.token;
    const path = '/api/me/profile/learner';
    const initial = (await ui.request('GET', '/api/me', { token })).json.data;
    assert.equal(initial.learnerProfile.avatarId, 'neutral');
    assert.deepEqual(initial.progress.wallet.ownedAvatars, ['neutral', 'male', 'female']);
    for (const body of [{ avatarId: 'https://evil.test/a.png' }, { avatarId: null }, { avatarId: 'male', ownedAvatars: ['star'] }]) {
      assert.equal((await ui.request('PUT', path, { token, body })).status, 400);
    }
    assert.equal((await ui.request('PUT', path, { token, body: { avatarId: 'star', displayName: '不能改名' } })).status, 403);
    assert.equal((await ui.request('GET', '/api/me', { token })).json.data.learnerProfile.displayName, initial.learnerProfile.displayName);
    assert.equal((await ui.request('PUT', path, { token, body: { avatarId: 'female' } })).status, 200);
    const me = (await ui.request('GET', '/api/me', { token })).json.data;
    assert.equal(me.learnerProfile.avatarId, 'female');
    assert.equal(me.buddyProfile.avatarId, 'female');
    assert.equal(me.learnerProfile.onboarded, false, '选初始头像不等于完成问卷');
    assert.equal(cropPeer({ userId: 'x', avatarId: 'female', anonymous: true }).avatarId, 'neutral');
  } finally { await ui.close(); }
});

test('头像兑换按服务端价格扣款、重复不扣；只给购买者解锁，累计积分不减', async () => {
  const ui = await startTestServer();
  try {
    const person = await ui.signInAs('learner');
    const handlers = createShopHandlers({ db: ui.db, catalog: [{ id: 'avatar-star', type: 'avatar', avatarId: 'star', price: 60 }] });
    const ctx = { req: { headers: { authorization: 'Bearer ' + person.token } }, body: { itemId: 'avatar-star' } };
    await assert.rejects(handlers.redeem(ctx), /insufficient points/);
    ui.db.updateProgress(person.userId, { xp: 100 });
    assert.equal((await handlers.redeem(ctx)).data.balance, 40);
    assert.equal((await handlers.redeem(ctx)).data.balance, 40);
    assert.equal(ui.db.getProgress(person.userId).xp, 100);
    assert.equal(ui.db.getWallet(person.userId).transactions.length, 1);
    assert.equal((await ui.request('PUT', '/api/me/profile/buddy', { token: person.token, body: { avatarId: 'star' } })).status, 200);
    const outsider = await ui.signInAs('learner', { deviceId: 'avatar-outsider' });
    assert.equal((await ui.request('PUT', '/api/me/profile/learner', { token: outsider.token, body: { avatarId: 'star' } })).status, 403);
  } finally { await ui.close(); }
});

test('零分解锁和头像重启保留；旧钱包补齐基础头像，队列更换同步', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-avatars-'));
  try {
    const path = join(dir, 'db.json');
    const ui = await startTestServer({ dataFile: path });
    let id;
    try {
      const person = await ui.signInAs('learner'); id = person.userId;
      ui.db.updateProgress(id, { wallet: { balance: 0, ownedThemes: ['mint', 'warm'], transactions: [] } });
      ui.db.upsertQueueRow({ userId: 'queued-avatar', ownerAccountId: id, role: 'learner' });
      const purchase = await ui.request('POST', '/api/me/shop/redeem', { token: person.token, body: { itemId: 'avatar-jade' } });
      assert.equal(purchase.status, 200); assert.equal(purchase.json.data.balance, 0);
      await ui.request('PUT', '/api/me/profile/learner', { token: person.token, body: { avatarId: 'jade' } });
      assert.equal(ui.db.findQueueRow('queued-avatar').avatarId, 'jade');
    } finally { await ui.close(); }
    const restored = createDb({ filePath: path });
    assert.equal(restored.getProfile(id, 'buddy').avatarId, 'jade');
    assert.ok(restored.getWallet(id).ownedAvatars.includes('jade'));
    assert.ok(restored.getWallet(id).ownedAvatars.includes('neutral'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

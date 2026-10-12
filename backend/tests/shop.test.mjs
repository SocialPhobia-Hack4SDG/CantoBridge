import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/server.mjs';
import { seedBothSides, registerWithProfile } from './helpers/scenario.mjs';
import { createDb } from '../src/store/db.js';
import { SHOP_CATALOG } from '../src/data/shop.js';
import { SHOP_CATALOG as FRONTEND_CATALOG } from '../../frontend/src/data/shop.js';
import { createShopHandlers } from '../src/domain/shop.js';

async function room(ui) {
  const { learners } = await seedBothSides(ui);
  const buddy = await registerWithProfile(ui, 'buddy', 'shop-buddy');
  const res = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: learners[0].peerId } });
  assert.equal(res.status, 201);
  return { learner: learners[0], buddy, roomId: res.json.data.roomId };
}

test('恢复正常价格后仍拒绝余额不足，按服务端价格扣款且不重复扣费', async () => {
  const ui = await startTestServer();
  try {
    const person = await ui.signInAs('learner');
    const handlers = createShopHandlers({ db: ui.db, catalog: [{ id: 'theme-blue', type: 'theme', theme: 'blue', price: 60 }] });
    const ctx = { req: { headers: { authorization: 'Bearer ' + person.token } }, body: { itemId: 'theme-blue' } };
    await assert.rejects(handlers.redeem(ctx), /insufficient points/);
    ui.db.updateProgress(person.userId, { xp: 100 });
    assert.equal((await handlers.redeem(ctx)).data.balance, 40);
    assert.equal((await handlers.redeem(ctx)).data.balance, 40);
    assert.equal(ui.db.getProgress(person.userId).xp, 100);
  } finally { await ui.close(); }
});

test('双方结算一次，伙伴评价奖励给被评价者且不重复', async () => {
  const ui = await startTestServer();
  try {
    const { learner, buddy, roomId } = await room(ui);
    for (const person of [buddy, learner, buddy]) {
      const res = await ui.request('POST', `/api/rooms/${roomId}/end`, { token: person.token, body: { durationSec: 120, cardsUsed: 2, requestId: 'end-' + Math.random() } });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.xpEarned, 22);
    }
    for (const person of [learner, buddy]) {
      assert.equal(ui.db.getProgress(person.accountId).xp, 22);
      assert.equal(ui.db.getProgress(person.accountId).conversations, 1);
      assert.equal(ui.db.getWallet(person.accountId).balance, 22);
      assert.equal(ui.db.getRelations(person.accountId).history[0].sessionId, roomId);
    }
    for (const person of [learner, buddy, learner]) {
      const res = await ui.request('POST', `/api/rooms/${roomId}/feedback`, { token: person.token, body: { tags: [person === learner ? 'patient' : 'active_learner'], requestId: 'fb-' + Math.random() } });
      assert.equal(res.status, 200);
    }
    for (const person of [learner, buddy]) {
      assert.equal(ui.db.getWallet(person.accountId).balance, 32);
      assert.equal(ui.db.getProgress(person.accountId).xp, 32);
      assert.equal(ui.db.getWallet(person.accountId).transactions.filter(x => x.kind === 'feedback').length, 1);
    }
  } finally { await ui.close(); }
});

test('短会话或跳过评价不给奖励，非参与者无法结算或评价', async () => {
  const ui = await startTestServer();
  try {
    const { learner, buddy, roomId } = await room(ui);
    const outsider = await ui.signInAs('learner', { deviceId: 'outsider' });
    for (const path of ['end', 'feedback']) {
      assert.equal((await ui.request('POST', `/api/rooms/${roomId}/${path}`, { token: outsider.token, body: {} })).status, 403);
    }
    await ui.request('POST', `/api/rooms/${roomId}/end`, { token: buddy.token, body: { durationSec: 59, cardsUsed: 0 } });
    const before = ui.db.getWallet(learner.accountId).balance;
    for (const body of [{ tags: [], skipped: true }, { tags: ['active_learner'] }]) {
      assert.equal((await ui.request('POST', `/api/rooms/${roomId}/feedback`, { token: buddy.token, body })).status, 200);
    }
    assert.equal(ui.db.getWallet(learner.accountId).balance, before);
  } finally { await ui.close(); }
});

test('零价商品验证身份、商品和服务端价格，重复并发请求不重复解锁', async () => {
  const ui = await startTestServer();
  try {
    assert.deepEqual(SHOP_CATALOG, FRONTEND_CATALOG);
    assert.equal((await ui.request('GET', '/api/me/shop')).status, 401);
    const person = await ui.signInAs('learner');
    const token = person.token;
    assert.ok(SHOP_CATALOG.every(item => item.price === 0));
    ui.db.updateProgress(person.userId, { xp: 160 });
    for (const body of [{ itemId: 'nope' }, { itemId: 'theme-blue', price: 0 }]) {
      assert.equal((await ui.request('POST', '/api/me/shop/redeem', { token, body })).status, 400);
    }
    const responses = await Promise.all([1, 2, 3].map(i => ui.request('POST', '/api/me/shop/redeem', { token, body: { itemId: 'theme-blue', requestId: 'redeem-' + i } })));
    for (const res of responses) {
      assert.equal(res.status, 200);
      assert.equal(res.json.data.balance, 160);
      assert.ok(res.json.data.ownedThemes.includes('blue'));
    }
    assert.equal(ui.db.getProgress(person.userId).xp, 160, '消费不降低排行榜累计积分');
    assert.equal(ui.db.getWallet(person.userId).transactions.length, 1);
    const night = await ui.request('POST', '/api/me/shop/redeem', { token, body: { itemId: 'theme-night' } });
    assert.equal(night.json.data.balance, 160, '零价兑换不减少已有余额');
    assert.equal((await ui.request('POST', '/api/me/shop/redeem', { token, body: { itemId: 'theme-eye' } })).status, 200);
  } finally { await ui.close(); }
});

test('钱包兼容旧积分，奖励和解锁重启保留；事务失败完整回滚', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-shop-'));
  try {
    const filePath = join(dir, 'db.json');
    const ui = await startTestServer({ dataFile: filePath });
    let userId;
    try {
      const person = await ui.signInAs('learner');
      userId = person.userId;
      ui.db.updateProgress(userId, { xp: 100 });
      assert.equal(ui.db.getWallet(userId).balance, 100);
      await ui.request('POST', '/api/me/shop/redeem', { token: person.token, body: { itemId: 'theme-blue' } });
      assert.throws(() => ui.db.transaction(() => { ui.db.creditPoints(userId, 10, 'rollback', 'feedback'); throw new Error('abort'); }), /abort/);
      assert.equal(ui.db.getWallet(userId).balance, 100);
      assert.equal(ui.db.creditPoints(userId, 10, 'reward', 'feedback'), true);
      assert.equal(ui.db.creditPoints(userId, 10, 'reward', 'feedback'), false);
    } finally { await ui.close(); }
    const restored = createDb({ filePath });
    assert.equal(restored.getWallet(userId).balance, 110);
    assert.equal(restored.getProgress(userId).xp, 110);
    assert.ok(restored.getWallet(userId).ownedThemes.includes('blue'));
    assert.equal(restored.getWallet(userId).transactions.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

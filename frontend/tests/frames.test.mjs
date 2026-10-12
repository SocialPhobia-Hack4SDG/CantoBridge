import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore, createMemoryStorage } from '../src/app/store.js';
import { createMockApi } from '../src/services/mockApi.js';
import { AvatarPicker, PresetAvatar } from '../src/components/avatars.js';
import { ShopPage } from '../src/pages/shop.js';
import { createTranslator } from '../src/i18n/i18n.js';
import { installDom } from './helpers/dom-stub.mjs';
import { createHttpApi } from '../src/services/httpApi.js';
import { createFetchStub, ok, routeTable } from './helpers/http-stub.mjs';
import { existsSync } from 'node:fs';
import { FRAMES } from '../src/data/frames.js';
installDom();
const t = createTranslator('zh-Hans');
const button = (node, text) => node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === text);
test('徽章资源齐全、选择无商品名称，旧头像框不显示，昵称不受影响', () => {
  for (const item of FRAMES.filter(item => item.id !== 'none')) {
    assert.ok(existsSync(new URL('../assets/badges/' + item.id + '.svg', import.meta.url)));
    const picker = AvatarPicker({ kind: 'frame', avatarId: 'female', wallet: { ownedFrames: [item.id] }, t, onChange() {} });
    assert.equal(picker.textContent.includes(t(item.labelKey)), false);
    assert.ok(picker.walk().some(node => node.getAttribute('aria-label') === t(item.labelKey)));
  }
  for (const id of ['aurora', 'orbit', 'sakura', 'pixel']) {
    assert.equal(PresetAvatar({ avatarId: 'female', frameId: id, label: '小晴' }).getAttribute('alt'), '小晴');
    assert.equal(PresetAvatar({ frameId: id }).getAttribute('data-frame'), null);
  }
});
test('已有头像框兑换记录保留，修改资料可正常保存，商城不再出售旧框', async () => {
  const store = createStore({ storage: createMemoryStorage() });
  store.hydrateWallet({ balance: 0, ownedFrames: ['none', 'aurora'] });
  const api = createMockApi({ store, sleep: () => Promise.resolve() });
  await api.saveLearnerProfile({ frameId: 'aurora', displayName: '小晴' });
  assert.equal(store.getState().learnerProfile.displayName, '小晴');
  assert.ok((await api.getShop()).ownedFrames.includes('aurora'));
  assert.equal((await api.getShop()).catalog.some(item => item.frameId === 'aurora'), false);
  assert.equal(PresetAvatar({ frameId: 'aurora' }).getAttribute('data-frame'), null);
});
test('三款小徽章预览不更换头像；兑换只解锁，应用与取消跨身份同步并保留', async () => {
  const storage = createMemoryStorage(); const store = createStore({ storage }); store.saveSettings({ mockDelayMs: 0 });
  const api = createMockApi({ store }); const view = { local: {}, data: null };
  const ctx = { t, store, api, view, getState: () => store.getState(), paint() {} };
  await assert.rejects(api.saveLearnerProfile({ frameId: 'milk-tea' }), /locked/);
  view.data = await ShopPage.load(ctx); view.local.category = 'frames';
  const before = JSON.stringify(store.getState());
  assert.equal(ShopPage.render(ctx, view).querySelectorAll('.shop-item').length, 3);
  for (const id of ['milk-tea', 'pineapple', 'tram']) {
    view.local.previewFrame = id;
    const node = ShopPage.render(ctx, view);
    assert.ok(node.querySelector('.frame-preview'));
    assert.ok(node.querySelector('.avatar-badge'));
    assert.equal(node.querySelector('.avatar-badge').getAttribute('src'), '/assets/badges/' + id + '.svg');
    assert.equal(JSON.stringify(store.getState()), before);
  }
  view.local.previewFrame = 'milk-tea';
  button(ShopPage.render(ctx, view), t('shop.redeem')).click();
  // DOM stub does not await handlers: wait until the asynchronous action settles.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().learnerProfile.frameId, 'none');
  button(ShopPage.render(ctx, view), t('shop.apply')).click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().learnerProfile.frameId, 'milk-tea');
  assert.equal(store.getState().buddyProfile.frameId, 'milk-tea');
  button(ShopPage.render(ctx, view), t('frame.back')).click();
  button(ShopPage.render(ctx, view), t('frame.none')).click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().learnerProfile.frameId, 'none');
  await api.saveLearnerProfile({ frameId: 'milk-tea' });
  const restored = createStore({ storage });
  assert.equal(restored.getState().buddyProfile.frameId, 'milk-tea');
  const wallet = restored.getState().progress.wallet;
  assert.ok(wallet.ownedFrames.includes('milk-tea')); assert.equal(wallet.transactions.length, 1);
  await api.redeemShopItem('badge-milk-tea'); assert.equal(store.getState().progress.wallet.transactions.length, 1);
  await api.saveBuddyProfile({ frameId: 'none' }); assert.equal(store.getState().learnerProfile.frameId, 'none');
});
test('未解锁小徽章禁用，非法样式回退；匿名不显示已佩戴框', () => {
  const changes = [];
  const picker = AvatarPicker({ kind: 'frame', t, value: 'none', onChange: id => changes.push(id) });
  const locked = picker.walk().find(x => x.getAttribute('data-frame-option') === 'pineapple');
  assert.equal(locked.disabled, true); locked.click(); assert.deepEqual(changes, []);
  picker.walk().find(x => x.getAttribute('data-frame-option') === 'none').click(); assert.deepEqual(changes, ['none']);
  assert.equal(PresetAvatar({ avatarId: 'male', frameId: 'tram', anonymous: true }).getAttribute('data-avatar'), 'neutral');
  assert.equal(PresetAvatar({ frameId: 'arbitrary-css' }).getAttribute('data-frame'), null);
});
test('真实 HTTP 小徽章保存只发白名单 ID，不跳过问卷且同步另一身份', async () => {
  const store = createStore({ storage: createMemoryStorage() });
  const fetchImpl = createFetchStub(routeTable({
    'GET /api/me': () => ok({ progress: { wallet: { balance: 0, ownedFrames: ['none', 'pineapple'] } } }),
    'PUT /api/me/profile/buddy': () => ok({ buddyProfile: { avatarId: 'female', frameId: 'pineapple', onboarded: false } }),
  }));
  const api = createHttpApi({ store, fetchImpl }); await api.getMe();
  assert.ok(store.getState().progress.wallet.ownedFrames.includes('pineapple'));
  await api.saveBuddyProfile({ frameId: 'pineapple', ownedFrames: ['tram'], imageUrl: 'https://bad.test' });
  assert.deepEqual(Object.keys(fetchImpl.calls[1].body).filter(x => x !== 'requestId'), ['frameId']);
  assert.equal(store.getState().learnerProfile.frameId, 'pineapple');
  assert.equal(store.getState().buddyProfile.onboarded, false);
  assert.equal(store.getState().learnerProfile.avatarId, 'female');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom-stub.mjs';
import { createStore, createMemoryStorage } from '../src/app/store.js';
import { createMockApi } from '../src/services/mockApi.js';
import { createHttpApi } from '../src/services/httpApi.js';
import { createFetchStub, ok, routeTable } from './helpers/http-stub.mjs';
import { createTranslator } from '../src/i18n/i18n.js';
import { SHOP_CATALOG } from '../src/data/shop.js';
import { LeaderboardPage } from '../src/pages/leaderboard.js';
import { ProfilePage } from '../src/pages/me.js';
import { ShopPage } from '../src/pages/shop.js';

installDom();
function setup() {
  const storage = createMemoryStorage();
  const store = createStore({ storage });
  store.saveSettings({ mockDelayMs: 0 });
  const api = createMockApi({ store, sleep: () => Promise.resolve() });
  return { storage, store, api };
}

test('零积分可兑换测试商品；兑换前主题未解锁不能应用', async () => {
  const { store, api } = setup();
  store.setTheme('night');
  assert.equal(store.getState().settings.theme, 'mint');
  const free = await api.redeemShopItem('theme-night');
  assert.equal(free.balance, 0);
  assert.ok(free.ownedThemes.includes('night'));
  await assert.rejects(api.redeemShopItem('missing'), /unknown/);
  assert.equal((await api.getShop()).balance, 0);
});

test('兑换和后续对话增加可用余额，主题与余额刷新保留', async () => {
  const { store, storage, api } = setup();
  store.setRole('learner');
  store.recordSession({ durationSec: 600, cardsUsed: 0, topics: [] });
  assert.equal((await api.getShop()).balance, 60);
  const wallet = await api.redeemShopItem('theme-blue');
  assert.equal(wallet.balance, 60);
  assert.ok(wallet.ownedThemes.includes('blue'));
  assert.equal(store.getState().progress.xp, 60);
  assert.equal((await api.redeemShopItem('theme-blue')).balance, 60);
  assert.equal(store.getState().progress.wallet.transactions.length, 1);
  store.setTheme('blue');
  store.recordSession({ durationSec: 60, cardsUsed: 1, topics: [] });
  const restored = createStore({ storage });
  assert.equal(restored.getState().settings.theme, 'blue');
  assert.equal(restored.getState().progress.wallet.balance, 71);
  assert.equal(restored.getState().progress.xp, 71);
});

test('HTTP 商城请求只发送商品 ID 并同步钱包到 store', async () => {
  const { store, api: fallback } = setup();
  const wallet = { balance: 100, ownedThemes: ['mint', 'warm'], transactions: [], catalog: SHOP_CATALOG };
  const purchased = { ...wallet, balance: 100, ownedThemes: ['mint', 'warm', 'blue'] };
  const fetchImpl = createFetchStub(routeTable({
    'GET /api/me/shop': () => ok(wallet),
    'POST /api/me/shop/redeem': () => ok(purchased),
  }));
  const api = createHttpApi({ store, fallback, baseUrl: 'http://localhost', fetchImpl });
  await api.getShop();
  assert.equal(store.getState().progress.wallet.balance, 100);
  await api.redeemShopItem('theme-blue');
  assert.equal(store.getState().progress.wallet.balance, 100);
  assert.equal(fetchImpl.calls[1].body.itemId, 'theme-blue');
  assert.equal(fetchImpl.calls[1].body.price, undefined);
  assert.ok(fetchImpl.calls[1].body.requestId);
  store.setTheme('blue');
  assert.equal(store.getState().settings.theme, 'blue');
});

test('退出换人清除付费主题和钱包，免费配色仍保留', () => {
  const { store } = setup();
  store.hydrateWallet({ balance: 20, ownedThemes: ['mint', 'warm', 'night'], transactions: [] });
  store.setTheme('night');
  store.resetAccount();
  assert.equal(store.getState().settings.theme, 'mint');
  assert.equal(store.getState().progress.wallet, undefined);
  store.setTheme('night');
  assert.equal(store.getState().settings.theme, 'mint');
  store.setTheme('warm');
  store.resetAccount();
  assert.equal(store.getState().settings.theme, 'warm');
});

test('独立商城先确认再扣款，取消保留余额，已兑换可应用', async () => {
  const { store, api } = setup();
  store.hydrateWallet({ balance: 200, ownedThemes: ['mint', 'warm'], transactions: [] });
  const view = { local: {}, data: null };
  const ctx = { store, api, view, t: createTranslator('zh-Hans'), locale: 'zh-Hans', getState: () => store.getState(), paint() {}, navigate() {}, reload() {} };
  view.data = await ShopPage.load(ctx);
  view.data.shop.catalog = view.data.shop.catalog.map(item => item.id === 'theme-blue' ? { ...item, price: 60 } : item);
  let purchases = 0;
  const redeemItem = api.redeemShopItem;
  api.redeemShopItem = async id => { purchases++; const result = await redeemItem(id); result.balance = 140; store.hydrateWallet(result); return result; };
  const render = () => ShopPage.render(ctx, view);
  const button = (node, text) => node.walk().find(x => x.tagName === 'BUTTON' && !(x.getAttribute('class') ?? '').includes('shop-category') && x.textContent.includes(text));
  const redeem = button(render(), '兑换');
  redeem.click();
  assert.equal((await api.getShop()).balance, 200);
  button(render(), '取消').click();
  assert.equal(view.local.confirmItem, null);
  assert.equal(purchases, 0);
  button(render(), '兑换').click();
  const confirm = button(render(), '确认');
  assert.ok(confirm);
  await confirm.listeners.click[0]({ target: confirm });
  assert.equal(view.data.shop.balance, 140);
  assert.equal(purchases, 1);
  assert.equal(view.local.shopPending, false);
  button(render().querySelectorAll('.shop-item').find(item => item.textContent.includes('简约蓝')), '使用').click();
  assert.equal(store.getState().settings.theme, 'blue');
  assert.ok(render().textContent.includes('简约蓝'));
});

test('免费商品直接解锁，处理中防重复，失败可重试且成功不自动应用', async () => {
  const { store, api } = setup();
  const view = { local: {}, data: null };
  const t = createTranslator('zh-Hans');
  const ctx = { store, api, view, t, getState: () => store.getState(), paint() {} };
  view.data = await ShopPage.load(ctx); view.local.category = 'avatars';
  const render = () => ShopPage.render(ctx, view);
  let requests = 0, rejectRequest;
  const original = api.redeemShopItem;
  api.redeemShopItem = () => { requests++; return new Promise((resolve, reject) => { rejectRequest = reject; }); };
  const button = render().querySelector('.shop-item-actions').querySelector('button');
  const action = button.listeners.click[0];
  const pending = action();
  await action();
  assert.equal(requests, 1);
  assert.equal(view.local.confirmItem, undefined);
  assert.ok(render().textContent.includes(t('shop.processing')));
  assert.equal(render().querySelector('.shop-image-preview').disabled, true);
  rejectRequest(new Error('offline')); await pending;
  assert.ok(render().textContent.includes(t('shop.failed')));
  assert.equal(view.local.shopPending, false);
  api.redeemShopItem = original;
  await render().querySelector('.shop-item-actions').querySelector('button').listeners.click[0]();
  assert.ok(render().textContent.includes(t('shop.unlockedHint')));
  assert.equal(store.getState().learnerProfile.avatarId, 'neutral');
  render().querySelector('.shop-image-preview').click();
  assert.ok(render().querySelector('.avatar-preview'));
  const apply = render().walk().find(x => x.tagName === 'BUTTON' && x.textContent === t('shop.apply'));
  await apply.listeners.click[0]();
  assert.equal(store.getState().learnerProfile.avatarId, 'star');
  assert.ok(render().textContent.includes(t('shop.applied')));
});

test('深夜黑覆盖页面和卡片底色，所有新增主题三语完整', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const dark = css.match(/:root\[data-theme='night'\],\s*\[data-preview-theme='night'\]\s*\{([^}]+)\}/)[1];
  for (const property of ['color-scheme: dark', '--bg-base:', '--bg-raised:', '--text-primary:', '--on-accent:']) assert.ok(dark.includes(property));
  for (const locale of ['zh-Hans', 'zh-Hant', 'en']) {
    const t = createTranslator(locale);
    for (const theme of ['blue', 'night', 'eye']) assert.notEqual(t('theme.' + theme), 'theme.' + theme);
  }
});


test('排行榜不请求商城，也不再提供商城入口', async () => {
  const { store } = setup();
  let destination;
  const view = { local: {}, data: null };
  const ctx = { view, store, t: createTranslator('zh-Hans'), getState: () => store.getState(), navigate: path => { destination = path; }, api: {
    getLeaderboard: async () => [],
    getShop: async () => { throw new Error('排行榜不应请求商城'); },
  } };
  view.data = await LeaderboardPage.load(ctx);
  const node = LeaderboardPage.render(ctx, view);
  assert.equal(node.querySelectorAll('.shop-card').length, 0);
  assert.equal(node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === '积分商城'), undefined);
  assert.equal(destination, undefined);
});

test('商城接口缺失与网络失败保留错误并可重试', async () => {
  const view = { local: {} };
  const error = Object.assign(new Error('no route'), { code: 'not_found' });
  let retries = 0;
  const ctx = { view, api: { getShop: async () => { throw error; } }, t: createTranslator('zh-Hans'), reload: () => { retries++; } };
  await assert.rejects(ShopPage.load(ctx), err => err === error);
  view.error = error;
  const node = ShopPage.render(ctx, view);
  assert.ok(node.textContent.includes('暂时不可用'));
  node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === '重试').click();
  assert.equal(retries, 1);
  view.error = new Error('network failed');
  assert.ok(ShopPage.render(ctx, view).textContent.includes('检查网络'));
});


test('配饰开放三款小徽章，主题入口保留原商品', async () => {
  const { store, api } = setup();
  const view = { local: {}, data: null };
  const ctx = { store, api, view, t: createTranslator('zh-Hans'), getState: () => store.getState(), paint() {} };
  view.data = await ShopPage.load(ctx);
  const render = () => ShopPage.render(ctx, view);
  for (const [id, label] of [['frames', '配饰']]) {
    const node = render();
    node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === label + '可兑换').click();
    assert.equal(view.local.category, id);
    const placeholder = render();
    assert.equal(placeholder.textContent.includes('奶茶小徽章'), false);
    assert.ok(placeholder.querySelector('.avatar-badge'));
    assert.equal(placeholder.querySelectorAll('.shop-item').length, 3);
    assert.equal((await api.getShop()).balance, 0);
  }
  render().walk().find(x => x.tagName === 'BUTTON' && x.textContent === '主题可兑换').click();
  assert.equal(render().querySelectorAll('.shop-item').length, 4);
});

test('零积分可预览每款真实主题，预览关闭不修改配色、余额或解锁', async () => {
  const { store, api } = setup();
  store.setTheme('warm');
  const before = JSON.stringify(store.getState());
  const view = { local: {}, data: null };
  const ctx = { store, api, view, t: createTranslator('zh-Hans'), getState: () => store.getState(), paint() {} };
  view.data = await ShopPage.load(ctx);
  const render = () => ShopPage.render(ctx, view);
  for (const item of SHOP_CATALOG.filter(item => item.type === 'theme')) {
    const button = render().walk().find(x => x.getAttribute('aria-label') === ctx.t('shop.previewTitle', { theme: ctx.t('theme.' + item.theme) }));
    assert.equal(Boolean(button.disabled), false);
    button.click();
    const preview = render();
    assert.equal(preview.querySelectorAll('.theme-preview-frame')[0].getAttribute('data-preview-theme'), item.theme);
    assert.ok(preview.textContent.includes('今日话题'));
    const redeem = preview.walk().find(x => x.tagName === 'BUTTON' && x.textContent === (item.theme === 'warm' ? '使用中' : '兑换'));
    assert.ok(redeem);
    assert.equal(Boolean(redeem.disabled), item.theme === 'warm');
    assert.equal(JSON.stringify(store.getState()), before);
    preview.walk().find(x => x.tagName === 'BUTTON' && x.textContent === '返回主题').click();
    assert.equal(render().querySelectorAll('.theme-preview-frame').length, 0);
  }
  assert.equal((await api.getShop()).balance, 0);
});

test('预览配色复用实际主题 CSS，重置基础色以免继承外层主题', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  assert.match(css, /:root,\s*\[data-preview-theme\]\s*\{/);
  for (const theme of ['warm', 'blue', 'eye', 'night']) {
    assert.ok(css.includes(":root[data-theme='" + theme + "'],"));
    assert.ok(css.includes("[data-preview-theme='" + theme + "'] {"));
  }
});


test('商城所有主题零积分兑换后出现在我的设置，切换后刷新保留', async () => {
  const { store, storage, api } = setup();
  store.setRole('learner');
  const before = await api.getShop();
  assert.equal(before.balance, 0);
  assert.equal(before.catalog.filter(item => item.type === 'theme').length, 4);
  assert.ok(before.catalog.some(item => item.theme === 'warm'));
  for (const item of before.catalog.filter(item => item.type === 'theme')) {
    assert.equal(item.price, 0);
    await api.redeemShopItem(item.id);
  }
  const view = { local: {}, data: null };
  const ctx = { store, api, view, t: createTranslator('zh-Hans'), locale: 'zh-Hans', label: (group, value) => value,
    getState: () => store.getState(), paint() {}, watch() {}, navigate() {} };
  view.data = await ProfilePage.load(ctx);
  view.local.settingsExpanded = true;
  const settings = ProfilePage.render(ctx, view);
  const options = settings.querySelectorAll('.theme-option');
  assert.equal(options.length, 5);
  for (const theme of ['mint', 'warm', 'blue', 'night', 'eye']) {
    options.find(button => button.textContent === ctx.t('theme.' + theme)).click();
    assert.equal(store.getState().settings.theme, theme);
  }
  const refreshed = createStore({ storage });
  assert.equal(refreshed.getState().settings.theme, 'eye');
  assert.equal(refreshed.getState().progress.wallet.balance, 0);
  for (const theme of ['warm', 'blue', 'night', 'eye']) assert.ok(refreshed.getState().progress.wallet.ownedThemes.includes(theme));
});

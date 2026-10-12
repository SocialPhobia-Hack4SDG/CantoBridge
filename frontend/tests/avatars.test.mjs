import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { existsSync } from 'node:fs';
import { createStore, createMemoryStorage } from '../src/app/store.js';
import { createMockApi } from '../src/services/mockApi.js';
import { createHttpApi } from '../src/services/httpApi.js';
import { AvatarPicker, PresetAvatar } from '../src/components/avatars.js';
import { AVATARS } from '../src/data/avatars.js';
import { ShopPage } from '../src/pages/shop.js';
import { createTranslator } from '../src/i18n/i18n.js';
import { installDom } from './helpers/dom-stub.mjs';
import { boot, flush, restoreGlobalTimers } from './helpers/app-harness.mjs';
import { createFetchStub, ok, routeTable } from './helpers/http-stub.mjs';
after(() => restoreGlobalTimers());
installDom();
const t = createTranslator('zh-Hans');
function setup() {
  const storage = createMemoryStorage(); const store = createStore({ storage });
  store.saveSettings({ mockDelayMs: 0 });
  return { storage, store, api: createMockApi({ store, sleep: () => Promise.resolve() }) };
}

test('我的页直接修改外观：取消不写入，失败保留草稿，重试仅保存外观且同步身份', async () => {
  for (const role of ['learner', 'buddy']) {
    let fail = true;
    const calls = [];
    const method = role === 'buddy' ? 'saveBuddyProfile' : 'saveLearnerProfile';
    const ui = await boot({ hash: '#/me', role, apiWrapper: api => ({ ...api, [method]: async patch => {
      calls.push(patch);
      if (fail) throw new Error('offline');
      return api[method](patch);
    } }) });
    await flush();
    const before = structuredClone(ui.store.getState()[role === 'buddy' ? 'buddyProfile' : 'learnerProfile']);
    assert.equal(ui.root.querySelector('.profile-settings').getAttribute('open'), null, '设置默认收起');
    assert.equal(ui.root.querySelector('.profile-account').getAttribute('open'), null, '账号默认收起');
    await ui.click('.profile-avatar-button');
    const choose = () => ui.root.walk().find(node => node.getAttribute('data-avatar-option') === 'female').click();
    choose(); await flush();
    await ui.clickButton(t('action.cancel'));
    assert.equal(calls.length, 0);
    assert.equal(ui.store.getState().learnerProfile.avatarId, 'neutral');
    await ui.click('.profile-avatar-button'); choose(); await flush();
    await ui.clickButton(t('action.save'));
    assert.ok(ui.text().includes(t('me.appearanceFailed')));
    assert.ok(ui.root.querySelector('.appearance-editor'));
    fail = false;
    await ui.clickButton(t('action.save'));
    assert.equal(ui.win.location.hash, '#/me', '不进入注册问卷');
    assert.equal(ui.root.querySelector('.appearance-editor'), null);
    assert.equal(ui.store.getState().learnerProfile.avatarId, 'female');
    assert.equal(ui.store.getState().buddyProfile.avatarId, 'female');
    assert.deepEqual(Object.keys(calls[1]).sort(), ['avatarId', 'frameId']);
    const after = ui.store.getState()[role === 'buddy' ? 'buddyProfile' : 'learnerProfile'];
    assert.equal(after.displayName, before.displayName);
    assert.equal(after.onboarded, before.onboarded);
    assert.deepEqual(after.interests, before.interests);
  }
});

test('预设资源齐全，匿名与非法头像回退人影；锁定项灰色禁用不改变选择', () => {
  for (const item of AVATARS) assert.ok(existsSync(new URL('../assets/avatars/' + item.src.split('/').pop(), import.meta.url)));
  assert.equal(PresetAvatar({ avatarId: 'star', anonymous: true }).getAttribute('data-avatar'), 'neutral');
  assert.equal(PresetAvatar({ avatarId: 'https://evil.test/image' }).getAttribute('data-avatar'), 'neutral');
  const picked = [];
  const picker = AvatarPicker({ t, onChange: id => picked.push(id) });
  const locked = picker.walk().find(x => x.getAttribute('data-avatar-option') === 'star');
  assert.equal(locked.disabled, true); locked.click(); assert.deepEqual(picked, []);
  picker.walk().find(x => x.getAttribute('data-avatar-option') === 'female').click(); assert.deepEqual(picked, ['female']);
  const initial = AvatarPicker({ t, initial: true, onChange() {} });
  assert.equal(initial.querySelectorAll('.avatar-option').length, 3);
  assert.equal(initial.textContent.includes(t('avatar.free')), false, '三个初始头像不重复标注免费');
  assert.equal(initial.querySelector('.is-selected').getAttribute('data-avatar-option'), 'neutral', '初始默认选择无脸人影');
  for (const id of ['neutral', 'male', 'female']) {
    assert.equal(initial.textContent.includes(t('avatar.' + id)), false, '基础人物不显示商品或性别名称');
  }
});

test('注册不展示外观选项，头像作为资料最后一步出现一次，选择后同步身份', async () => {
  const ui = await boot({ hash: '#/register', learnerOnboarded: false, buddyOnboarded: false });
  assert.equal(ui.root.querySelector('.avatar-picker'), null);
  ui.root.walk().find(node => node.tagName === 'BUTTON' && node.textContent === t('register.submit')).click();
  await flush();
  assert.equal(ui.win.location.hash, '#/onboarding/role');
  assert.equal(ui.store.getState().learnerProfile.onboarded, false);
  await ui.clickButton(t('role.learnerTitle')); await ui.clickButton(t('action.next'));
  assert.equal(ui.root.querySelector('.avatar-picker'), null, '资料题目不重复显示头像');
  await ui.clickButton(t('setup.skipForNow'));
  assert.equal(ui.root.querySelectorAll('.avatar-picker').length, 1);
  assert.equal(ui.root.querySelectorAll('.avatar-option').length, 3);
  assert.equal(ui.root.walk().find(x => x.getAttribute('data-frame-option')), undefined);
  ui.root.walk().find(x => x.getAttribute('data-avatar-option') === 'female').click(); await flush();
  assert.equal(ui.store.getState().learnerProfile.avatarId, 'neutral', '草稿提交前不保存');
  await ui.clickButton(t('setup.nextStep'));
  assert.equal(ui.store.getState().learnerProfile.avatarId, 'female');
  assert.equal(ui.store.getState().buddyProfile.avatarId, 'female');
  assert.equal(ui.store.getState().buddyProfile.onboarded, false);
  assert.equal(ui.store.getState().learnerProfile.frameId, 'none');
});

test('编辑资料的头像与头像框仅出现在最后一步，两身份前面的题目均不展示', async () => {
  for (const role of ['learner', 'buddy']) {
    const ui = await boot({ hash: '#/onboarding/profile', role }); await flush();
    const total = role === 'buddy' ? 4 : 6;
    for (let step = 0; step < total - 1; step++) {
      assert.equal(ui.root.querySelector('.avatar-picker'), null);
      await ui.clickButton(t('setup.nextItem'));
    }
    assert.equal(ui.root.querySelectorAll('.avatar-picker').length, 2);
    assert.equal(ui.root.walk().filter(x => x.getAttribute('data-avatar-option')).length, 7);
    assert.equal(ui.root.walk().filter(x => x.getAttribute('data-frame-option')).length, 4);
    await ui.clickButton(t('setup.prevItem')); assert.equal(ui.root.querySelector('.avatar-picker'), null);
    await ui.clickButton(t('setup.nextItem')); assert.equal(ui.root.querySelectorAll('.avatar-picker').length, 2);
    await ui.clickButton(t('setup.nextStep')); assert.equal(ui.win.location.hash, '#/onboarding/privacy');
    assert.equal(ui.root.querySelector('.avatar-picker'), null, '隐私页只有预览，不能再选择头像');
  }
});

test('商城头像零余额预览不改状态；直接解锁后可应用，刷新保留，退出清除', async () => {
  const { store, api, storage } = setup();
  await assert.rejects(api.saveLearnerProfile({ avatarId: 'star' }), /locked/);
  const view = { local: {}, data: null };
  const ctx = { t, store, api, view, getState: () => store.getState(), paint() {} };
  view.data = await ShopPage.load(ctx); view.local.category = 'avatars';
  const before = JSON.stringify(store.getState());
  let node = ShopPage.render(ctx, view);
  assert.equal(node.querySelectorAll('.shop-item').length, 4);
  for (const id of ['star', 'fox', 'jade']) assert.equal(node.textContent.includes(t('avatar.' + id)), false, '商品名称只保留在无障碍描述中');
  node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === t('shop.preview')).click();
  node = ShopPage.render(ctx, view);
  assert.ok(node.querySelector('.avatar-preview'));
  assert.equal(JSON.stringify(store.getState()), before);
  node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === t('shop.redeem')).click();
  await flush();
  assert.notEqual(store.getState().learnerProfile.avatarId, 'star', '解锁不会自动换上');
  node = ShopPage.render(ctx, view);
  node.walk().find(x => x.tagName === 'BUTTON' && x.textContent === t('shop.apply')).click();
  await flush();
  assert.equal(store.getState().learnerProfile.avatarId, 'star');
  assert.equal(store.getState().buddyProfile.avatarId, 'star');
  const restored = createStore({ storage });
  assert.equal(restored.getState().learnerProfile.avatarId, 'star');
  assert.ok(restored.getState().progress.wallet.ownedAvatars.includes('star'));
  store.resetAccount(); assert.equal(store.getState().learnerProfile.avatarId, 'neutral');
});

test('HTTP 首屏同步已购头像，保存只发送 ID，两份身份同步', async () => {
  const { store } = setup();
  const fetchImpl = createFetchStub(routeTable({
    'GET /api/me': () => ok({ progress: { wallet: { balance: 0, ownedAvatars: ['star'] } }, learnerProfile: { avatarId: 'star' }, buddyProfile: { avatarId: 'star' } }),
    'PUT /api/me/profile/learner': () => ok({ learnerProfile: { avatarId: 'male', onboarded: false } }),
  }));
  const api = createHttpApi({ store, fetchImpl });
  await api.getMe(); assert.ok(store.getState().progress.wallet.ownedAvatars.includes('star'));
  await api.saveLearnerProfile({ avatarId: 'male', imageUrl: 'https://evil.test', ownedAvatars: ['jade'] });
  assert.equal(fetchImpl.calls[1].body.avatarId, 'male'); assert.equal(fetchImpl.calls[1].body.imageUrl, undefined);
  assert.equal(store.getState().buddyProfile.avatarId, 'male');
  assert.equal(store.getState().learnerProfile.onboarded, false);
});

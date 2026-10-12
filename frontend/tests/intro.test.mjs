import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StubElement } from './helpers/dom-stub.mjs';
import { createMemoryStorage, createStore } from '../src/app/store.js';
import { createTranslator } from '../src/i18n/i18n.js';

function fixture({ reduced = false, storage = createMemoryStorage() } = {}) {
  const body = new StubElement('body'); const root = new StubElement('div'); body.appendChild(root);
  const timers = new Map(); let next = 0;
  const doc = { body, createElement: name => new StubElement(name), getElementById: () => root };
  const win = { localStorage: storage, matchMedia: () => ({ matches: reduced }), setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
  const tick = ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } };
  return { body, root, doc, win, storage, timers, tick, t: key => key };
}

test('动画按已保存的语言偏好显示欢迎、标语和跳过，刷新后保留，品牌名固定', async () => {
  const { startIntro } = await import('../src/app/intro.js?locale');
  for (const [locale, greeting, skip, title] of [
    ['zh-Hans', '用粤语，连接你我', '跳过', '欢迎来到 CantoBridge'],
    ['zh-Hant', '用粵語，連接你我', '跳過', '歡迎來到 CantoBridge'],
    ['en', 'A conversation. A connection.', 'Skip', 'Welcome to CantoBridge'],
  ]) {
    const storage = createMemoryStorage();
    const store = createStore({ storage }); store.setLocale(locale);
    const restored = createStore({ storage });
    assert.equal(restored.getState().locale, locale);
    const ui = fixture();
    const intro = startIntro({ ...ui, preview: true, t: createTranslator(restored.getState().locale) });
    assert.equal(ui.body.querySelector('.intro-caption').textContent, greeting);
    assert.equal(ui.body.querySelector('button').textContent, skip);
    assert.equal(ui.body.querySelector('.brand-intro').getAttribute('aria-label'), title);
    assert.equal(ui.body.querySelector('img').getAttribute('alt'), 'CantoBridge');
    intro.close();
  }
});

test('设备首次播放：页面暂时 inert，平滑退场后恢复；同设备刷新与账号重置均不重播', async () => {
  const { startIntro } = await import('../src/app/intro.js?first');
  const ui = fixture(); const intro = startIntro(ui);
  assert.ok(intro); assert.equal(ui.root.inert, true); assert.ok(ui.body.querySelector('.brand-intro'));
  assert.equal(ui.body.style.overflow, 'hidden');
  assert.equal(ui.body.querySelector('img').getAttribute('src'), '/assets/branding/logo.png');
  ui.tick(2200); assert.ok(ui.body.querySelector('.brand-intro').classList.contains('is-leaving'));
  ui.tick(2650); assert.equal(ui.body.querySelector('.brand-intro'), null); assert.equal(ui.root.inert, false); assert.equal(ui.timers.size, 0);
  assert.equal(ui.body.style.overflow, '');
  assert.equal(startIntro(ui), null);
  const freshModule = await import('../src/app/intro.js?reloaded');
  assert.equal(freshModule.startIntro(fixture({ storage: ui.storage })), null, '设备记录跨页面加载保留，独立于账号存档');
});

test('跳过、Escape 与图片失败立即退出，不留下定时器或阻塞；预览不修改首次记录', async () => {
  const { startIntro } = await import('../src/app/intro.js?exit');
  for (const cause of ['skip', 'escape', 'image']) {
    const ui = fixture(); ui.root.inert = true;
    const intro = startIntro({ ...ui, preview: true }); assert.ok(intro);
    assert.equal(ui.storage.getItem('cantobridge:intro:v1'), null);
    if (cause === 'skip') ui.body.querySelector('button').click();
    if (cause === 'escape') ui.body.querySelector('.brand-intro').dispatch('keydown', { key: 'Escape' });
    if (cause === 'image') ui.body.querySelector('img').dispatch('error');
    assert.equal(ui.body.querySelector('.brand-intro'), null); assert.equal(ui.root.inert, true); assert.equal(ui.timers.size, 0);
    intro.close(); assert.equal(ui.timers.size, 0, '退出可重复调用');
  }
});

test('减少动态效果时直接入站；存储不可用仍能播放并在当前会话避免重复', async () => {
  const { startIntro } = await import('../src/app/intro.js?accessibility');
  const ui = fixture({ reduced: true }); assert.equal(startIntro(ui), null); assert.equal(ui.root.inert, undefined); assert.equal(ui.timers.size, 0);
  const privateModule = await import('../src/app/intro.js?private');
  const blocked = fixture({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } });
  const intro = privateModule.startIntro(blocked); assert.ok(intro); blocked.tick(2650); assert.equal(blocked.root.inert, false);
  assert.equal(privateModule.startIntro(blocked), null);
});

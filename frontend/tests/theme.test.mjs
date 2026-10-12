/**
 * 配色主题（mint / warm）：词表、文案、store 持久化与 ThemeSwitch 组件。
 *
 * 为什么单独一个文件：主题横跨「词表 -> 文案 -> 设置 -> 组件 -> <html data-theme>」五层，
 * 任何一层漏了都表现为「点了没反应 / 切过去是空白」这种现场很难查的问题，
 * 所以这里把每一层的契约都钉住。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installDom } from './helpers/dom-stub.mjs';

installDom();

const { h } = await import('../src/lib/dom.js');
const { ThemeSwitch } = await import('../src/components/base.js');
const { createTranslator } = await import('../src/i18n/i18n.js');
const { STORAGE_KEY, STORAGE_VERSION, createMemoryStorage, createStore } = await import('../src/app/store.js');
const { DEFAULT_THEME, THEMES, normalizeTheme, themeLabelKey } = await import('../src/data/themes.js');

const zh = createTranslator('zh-Hans');
const en = createTranslator('en');

test('主题词表：默认主题在列表里，未知值一律收敛回默认', () => {
  assert.deepEqual(THEMES, ['mint', 'warm', 'blue', 'night', 'eye']);
  assert.ok(THEMES.includes(DEFAULT_THEME));
  assert.equal(normalizeTheme('warm'), 'warm');
  assert.equal(normalizeTheme('neon-dark'), DEFAULT_THEME, '存档里的未知主题不能让界面落到「没有变量」的状态');
  assert.equal(normalizeTheme(undefined), DEFAULT_THEME);
  assert.equal(themeLabelKey('warm'), 'theme.warm');
  assert.equal(themeLabelKey('whatever'), themeLabelKey(DEFAULT_THEME));
});

test('主题文案：三语都有主题名，且不是把 key 原样吐回来', () => {
  for (const id of THEMES) {
    for (const locale of ['zh-Hans', 'zh-Hant', 'en']) {
      const label = createTranslator(locale)(themeLabelKey(id));
      assert.notEqual(label, themeLabelKey(id), locale + ' 缺少 ' + themeLabelKey(id) + ' 的文案');
      assert.ok(label.length > 0, locale + ' 的 ' + themeLabelKey(id) + ' 是空串');
    }
  }
});

test('store：主题默认 mint，切到 warm 后持久化，旧存档自动补默认值', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });
  assert.equal(store.getState().settings.theme, 'mint', '默认主题是 mint，不改动现有演示观感');

  store.setTheme('warm');
  assert.equal(store.getState().settings.theme, 'warm');
  assert.equal(store.getState().settings.anonymous, false, '切主题不该动其它设置');

  // 刷新（重新读存档）：主题还在
  assert.equal(createStore({ storage }).getState().settings.theme, 'warm');

  // 越界值收敛，不写进存档
  store.setTheme('neon-dark');
  assert.equal(store.getState().settings.theme, 'mint');
  assert.equal(createStore({ storage }).getState().settings.theme, 'mint');

  // 旧存档里根本没有这个字段 -> 合并默认值，不能是 undefined
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, settings: { anonymous: false } }));
  const old = createStore({ storage });
  assert.equal(old.getState().settings.theme, 'mint');
  assert.equal(old.getState().settings.anonymous, false, '旧存档的其它字段照旧生效');
});

test('store：重置演示数据把主题也带回默认', () => {
  const store = createStore({ storage: createMemoryStorage() });
  store.setTheme('warm');
  store.resetDemoData();
  assert.equal(store.getState().settings.theme, 'mint');
});

test('ThemeSwitch：两张药丸，选中态由 value 决定', () => {
  const node = h(ThemeSwitch, { value: 'mint', onChange: () => {}, t: zh });
  const buttons = node.querySelectorAll('button');
  assert.equal(buttons.length, 2, '一个主题一张药丸');
  assert.equal(buttons[0].getAttribute('class').includes('theme-option'), true);
  assert.equal(buttons[0].getAttribute('class').includes('theme-mint'), true);
  assert.equal(buttons[1].getAttribute('class').includes('theme-warm'), true);
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
  assert.equal(node.getAttribute('aria-label'), zh('theme.title'));
  assert.equal(node.querySelectorAll('.theme-dot').length, 2, '每张药丸都要有色点');
});

test('ThemeSwitch：点另一张立刻反白并回调，点当前这张不再回调', () => {
  const calls = [];
  const node = h(ThemeSwitch, { value: 'mint', onChange: (id) => calls.push(id), t: zh });
  const [mintButton, warmButton] = node.querySelectorAll('button');

  warmButton.click();
  assert.deepEqual(calls, ['warm']);
  assert.ok(warmButton.classList.contains('is-selected'), '点完要自己把选中态刷上去，不等整页重渲染');
  assert.equal(warmButton.getAttribute('aria-pressed'), 'true');
  assert.equal(mintButton.getAttribute('aria-pressed'), 'false');
  assert.equal(mintButton.classList.contains('is-selected'), false);

  mintButton.click();
  assert.deepEqual(calls, ['warm', 'mint']);
  mintButton.click();
  assert.deepEqual(calls, ['warm', 'mint'], '再点当前主题是空操作');
});

test('ThemeSwitch：两张药丸显示主题全名，当前主题带 aria-pressed', () => {
  const full = h(ThemeSwitch, { value: 'warm', onChange: () => {}, t: zh });
  assert.deepEqual(full.querySelectorAll('.theme-option-label').map((node) => node.textContent), ['薄荷绿', '暖橙']);
  assert.equal(full.querySelectorAll('button')[1].getAttribute('aria-pressed'), 'true');
  assert.equal(full.querySelectorAll('button')[0].getAttribute('aria-pressed'), 'false');
});

test('ThemeSwitch：没有 onChange 也不会炸（纯展示用法）', () => {
  const node = h(ThemeSwitch, { value: 'warm', t: zh });
  node.querySelectorAll('button')[0].click();
  assert.ok(node.querySelectorAll('button')[0].classList.contains('is-selected'));
});
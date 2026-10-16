import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// 注释里也有花括号（比如 `> * { margin: 0 }`），先把注释去掉再切开规则。
const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// 顶层规则（含 @media 里的）都摊平成「选择器 + 声明块」——够用，且不必引入 CSS 解析器。
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(match => ({ selector: match[1].replace(/\s+/g, ' ').trim(), body: match[2].trim() }));

test('首页AI导师入口在电脑双列布局中跨满整行，手机仍沿用全宽按钮', () => {
  const entry = rules.find(rule => rule.selector.split(',').map(selector => selector.trim()).includes(".page[data-page='home'] > section > .ai-tutor-entry"));
  assert.ok(entry, 'AI导师入口需显式跨列，width:100%只能占满单个格子');
  assert.match(entry.body, /grid-column:\s*1\s*\/\s*-1/);
  const block = rules.find(rule => rule.selector === '.btn-block');
  assert.match(block.body, /width:\s*100%/);
});

test('「我的」页的桌面栅格规则不会命中整页内置面板', () => {
  // 面板是 position: fixed 的整页覆盖层，却和页面内容一样挂在 .page > section 上。
  // 一旦被栅格规则命中：display:grid + align-content:stretch（网格默认值）会把标题和
  // 第一张卡片之间撑出一大段空白，`> * { margin: 0 }` 还会把靠 margin:auto 居中的
  // 内容顶到左内边距上——整块内容就偏到左边去了。
  const leaks = rules
    .filter(rule => rule.selector.includes(".page[data-page='me'] > section"))
    .filter(rule => /(^|;)\s*(display|gap|margin|margin-left|margin-right)\s*:/.test(rule.body))
    .filter(rule => !rule.selector.includes(':not(.sheet-fullscreen)'))
    .map(rule => rule.selector);
  assert.deepEqual(leaks, [], '这些「我的」页栅格规则都要带上 :not(.sheet-fullscreen)');
});

test('整页内置面板用 flex 居中，并给手机留出底部安全区', () => {
  const panel = rules.find(rule => rule.selector === '.sheet-fullscreen');
  assert.ok(panel, '缺少 .sheet-fullscreen 规则');
  assert.match(panel.body, /display:\s*flex/, '居中要走 flex，不能只靠 margin:auto');
  assert.match(panel.body, /align-items:\s*center/);
  assert.match(panel.body, /padding-bottom:[^;]*env\(safe-area-inset-bottom/, '手机底部要留安全区');
  const children = rules.find(rule => rule.selector === '.sheet-fullscreen > *');
  assert.ok(children, '缺少 .sheet-fullscreen > * 规则');
  assert.match(children.body, /max-width:\s*var\(--sheet-max\)/);
  const narrow = rules.find(rule => rule.selector === '.settings-fullscreen, .account-fullscreen');
  assert.ok(narrow, '设置 / 账号面板要收窄成单列');
  assert.match(narrow.body, /--sheet-max:\s*720px/);
});

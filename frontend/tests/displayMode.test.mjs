import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createStore } from '../src/app/store.js';

test('布局不再保存设备模式，也不暴露手动切换动作', () => {
  const store = createStore();
  assert.equal(Object.hasOwn(store.getState().settings, 'displayMode'), false);
  assert.equal('setDisplayMode' in store, false);
});

test('布局按视口宽度自动适配，且不再提供手动切换控件', () => {
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.ok(css.includes('@media (max-width: 899px)'));
  assert.ok(css.includes('@media (min-width: 900px)'));
  assert.ok(css.includes('--frame-max: 1180px'));
  assert.ok(css.includes('repeat(4, minmax(0,1fr))'));
  assert.equal(css.includes('data-display-mode'), false);
  assert.equal(css.includes('.display-mode-button'), false);
  for (const page of ['home', 'me', 'shop', 'leaderboard', 'profile', 'room']) assert.ok(css.includes(".page[data-page='" + page + "']"));
});

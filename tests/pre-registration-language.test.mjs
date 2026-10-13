import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boot, flush, restoreGlobalTimers } from '../frontend/tests/helpers/app-harness.mjs';
import { createStore } from '../frontend/src/app/store.js';
test('首页选择三种语言即时刷新，注册前不创建账号，刷新后保留偏好', async () => {
  let registrations=0;
  const ui = await boot({ learnerOnboarded:false, buddyOnboarded:false, apiWrapper:api=>({...api, signIn: (...args)=>{ registrations++;return api.signIn(...args); }}) });
  try {
    await flush();
    for(const [label,locale,cta] of [['English','en','Get Started'],['繁體中文','zh-Hant','開始使用'],['简体中文','zh-Hans','开始使用']]) {
      await ui.clickButton(label);
      assert.equal(ui.store.getState().locale,locale);
      assert.equal(ui.doc.documentElement.getAttribute('lang'),locale);
      assert.equal(ui.one('.landing-language .is-selected').textContent,label);
      assert.ok(ui.button(cta));
      assert.equal(createStore({storage:ui.storage}).getState().locale,locale);
    }
    assert.equal(registrations,0);
    await ui.clickButton('English'); await ui.clickButton('Get Started');
    assert.equal(ui.win.location.hash,'#/register');
    assert.ok(ui.text().includes('Create your account'));
    assert.equal(registrations,0);
  } finally { restoreGlobalTimers(); }
});

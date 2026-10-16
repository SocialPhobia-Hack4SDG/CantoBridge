import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { boot, flush, restoreGlobalTimers } from './helpers/app-harness.mjs';
import { createTranslator } from '../src/i18n/i18n.js';
after(() => restoreGlobalTimers());
const t = createTranslator('zh-Hans');

test('首页仅学习者有一个导师入口，不改变主导航；未注册资料和母语者不能进入', async () => {
  const ui = await boot({ hash: '#/home' }); await flush();
  assert.equal(ui.all('.ai-tutor-entry').length, 1); assert.equal(ui.all('.bottom-nav button').length, 4);
  assert.equal(ui.one('.home-practice-actions').children.filter(node => node.classList.contains('home-action')).length, 2, '两个入口均为同层卡片');
  assert.equal(ui.one('.home-practice-actions').children[1], ui.one('.ai-tutor-entry'));
  await ui.clickButton(t('tutor.entry')); assert.equal(ui.win.location.hash, '#/tutor');
  assert.ok(ui.text().includes(t('tutor.demoHint'))); assert.equal(ui.has('.bottom-nav'), false);
  await ui.clickButton(t('action.back')); assert.equal(ui.win.location.hash, '#/home');
  const buddy = await boot({ hash: '#/home', role: 'buddy' }); await flush();
  assert.equal(buddy.has('.ai-tutor-entry'), false); await buddy.goto('/tutor'); assert.equal(buddy.win.location.hash, '#/home');
  const fresh = await boot({ hash: '#/tutor', learnerOnboarded: false }); await flush();
  assert.equal(fresh.win.location.hash, '#/onboarding/role');
});

test('两条练习目标均可开始：调用卡片接口、模拟发言回复、提示换题、结束去真人匹配', async () => {
  for (const goal of ['life', 'opening']) {
    const calls = [];
    const ui = await boot({ hash: '#/tutor', storagePreset: { learnerProfile: { onboarded: true, cantoneseLevel: 'intermediate', interests: ['anime', 'food'] } }, apiWrapper: api => ({ ...api,
      generateTopicCards: async input => { calls.push(input); return api.generateTopicCards(input); },
      replyToTutor: async input => { calls.push(input); return api.replyToTutor(input); },
    }) }); await flush();
    ui.win.navigator.mediaDevices = { getUserMedia() { assert.fail('不得访问真实麦克风'); } };
    ui.win.speechSynthesis = { speak() { assert.fail('不得调用语音播放'); } };
    if (goal === 'opening') await ui.clickButton(t('tutor.opening'));
    const before = ui.store.getState();
    await ui.clickButton(t('tutor.start')); assert.ok(ui.one('.topic-card'));
    assert.equal(calls[0].cantoneseLevel, 'intermediate');
    assert.deepEqual(calls[0].buddyInterests, goal === 'life' ? ['food'] : ['anime', 'food']);
    assert.ok(ui.text().includes(t('tutor.listening')));
    await ui.clickButton(t('tutor.mute')); assert.equal(ui.button(t('tutor.exampleTurn')).disabled, true);
    await ui.clickButton(t('tutor.unmute'));
    await ui.clickButton(t('tutor.exampleTurn')); assert.ok(ui.text().includes(t('tutor.speaking')));
    assert.ok(ui.one('.tutor-reply')); assert.ok(calls[1].text); assert.ok(calls[1].currentCard.id);
    await ui.clickButton(t('tutor.interrupt')); assert.ok(ui.text().includes(t('tutor.listening')));
    await ui.clickButton(t('tutor.hint')); assert.ok(ui.text().includes(calls[1].currentCard.expressions[0].mandarin));
    const first = ui.one('.topic-card').dataset.cardId;
    await ui.clickButton(t('tutor.next')); assert.notEqual(ui.one('.topic-card').dataset.cardId, first);
    await ui.clickButton(t('tutor.end')); assert.ok(ui.one('.tutor-summary'));
    assert.ok(ui.text().includes(t('tutor.turns', { count: 1 }))); assert.ok(ui.text().includes(t('tutor.noEvaluation')));
    assert.deepEqual(ui.store.getState(), before, '练习不改资料、积分、房间或正式记录');
    assert.equal(ui.win.pendingTimers(), 0); assert.equal(ui.win.pendingIntervals(), 0);
    await ui.clickButton(t('tutor.realPartner')); assert.equal(ui.win.location.hash, '#/match');
    assert.equal(ui.store.getState().runtime.queue, null, '去大厅不自动排队');
    assert.equal(ui.win.pendingTimers(), 0);
  }
});

test('程度只影响本次请求；生活场景可选购物；回顾后重新练习清空上次轮次', async () => {
  const calls = [];
  const ui = await boot({ hash: '#/tutor', apiWrapper: api => ({ ...api, generateTopicCards: async args => { calls.push(args); return api.generateTopicCards(args); } }) }); await flush();
  const level = ui.one('.tutor-level'); level.value = 'advanced'; level.dispatch('change');
  const scene = ui.one('.tutor-scene'); scene.value = 'shopping'; scene.dispatch('change');
  const profile = ui.store.getState().learnerProfile;
  await ui.clickButton(t('tutor.start')); assert.equal(calls[0].cantoneseLevel, 'advanced'); assert.deepEqual(calls[0].buddyInterests, ['shopping']);
  await ui.clickButton(t('tutor.exampleTurn')); await ui.clickButton(t('tutor.end'));
  await ui.clickButton(t('tutor.again')); await ui.clickButton(t('tutor.start')); await ui.clickButton(t('tutor.end'));
  assert.ok(ui.text().includes(t('tutor.turns', { count: 0 }))); assert.deepEqual(ui.store.getState().learnerProfile, profile);
});

test('卡片或回复接口失败可重试，空卡片不能进入练习；失败不自动用本地假成功覆盖', async () => {
  let loads = 0; let turns = 0;
  const ui = await boot({ hash: '#/tutor', apiWrapper: api => ({ ...api,
    generateTopicCards: async args => { loads++; if (loads === 1) throw Error('offline'); if (loads === 2) return { mode: 'mock', cards: [] }; return api.generateTopicCards(args); },
    replyToTutor: async args => { turns++; if (turns === 1) throw Error('offline'); return api.replyToTutor(args); },
  }) }); await flush();
  for (let i = 0; i < 2; i++) { await ui.clickButton(t('tutor.start')); assert.ok(ui.text().includes(t('tutor.loadFailed'))); assert.equal(ui.one('.topic-card'), null); }
  await ui.clickButton(t('tutor.start')); await ui.clickButton(t('tutor.exampleTurn'));
  assert.ok(ui.text().includes(t('tutor.replyFailed')));
  await ui.clickButton(t('tutor.exampleTurn')); assert.ok(ui.text().includes(t('tutor.speaking')));
  await ui.goto('/home'); assert.equal(ui.win.pendingTimers(), 0);
});

test('离开页面忽略迟到卡片和回复；切换语言保留目标、卡片与轮次并清掉旧计时', async () => {
  let release;
  const ui = await boot({ hash: '#/tutor', apiWrapper: api => ({ ...api, generateTopicCards: args => new Promise(resolve => { release = async () => resolve(await api.generateTopicCards(args)); }) }) }); await flush();
  ui.button(t('tutor.start')).click(); await flush(); await ui.goto('/home'); await release(); await flush();
  assert.equal(ui.win.location.hash, '#/home'); assert.equal(ui.has('.topic-card'), false);
  const live = await boot({ hash: '#/tutor' }); await flush();
  await live.clickButton(t('tutor.opening')); await live.clickButton(t('tutor.start')); await live.clickButton(t('tutor.exampleTurn'));
  const card = live.one('.topic-card').dataset.cardId;
  live.store.setLocale('en'); await flush();
  assert.equal(live.one('.topic-card').dataset.cardId, card); assert.ok(live.text().includes(createTranslator('en')('tutor.listening')));
  assert.equal(live.win.pendingTimers(), 0);
  await live.clickButton(createTranslator('en')('tutor.end'));
  assert.ok(live.text().includes(createTranslator('en')('tutor.opening')));
  assert.ok(live.text().includes(createTranslator('en')('tutor.turns', { count: 1 })));
});

test('正式匹配或房间占用时不能开始；练习中切身份会退出页面并取消模拟计时', async () => {
  const ui = await boot({ hash: '#/tutor' }); await flush();
  ui.store.startQueue(); await flush();
  assert.equal(ui.button(t('tutor.start')).disabled, true);
  await ui.api.leaveQueue(); await ui.clickButton(t('tutor.start')); await ui.clickButton(t('tutor.exampleTurn'));
  ui.store.setRole('buddy'); await flush();
  assert.equal(ui.win.location.hash, '#/home'); assert.equal(ui.win.pendingTimers(), 0);
});

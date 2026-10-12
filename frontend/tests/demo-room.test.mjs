import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { boot, flush, restoreGlobalTimers } from './helpers/app-harness.mjs';
import { createTranslator } from '../src/i18n/i18n.js';
import { xpFor } from '../src/lib/logic.js';
after(() => restoreGlobalTimers());
const t = createTranslator('zh-Hans');

test('两身份从大厅进入模拟房间，翻卡、收藏、再发牌和结束不影响正式资料或积分', async () => {
  for (const role of ['learner', 'buddy']) {
    const writes = [];
    const ui = await boot({ hash: '#/match', role, apiWrapper: base => ({ ...base,
      getCards: async () => { writes.push('cards'); throw Error('real API called'); },
      savePhrase: async () => { writes.push('phrase'); throw Error('real API called'); },
      endRoom: async () => { writes.push('end'); throw Error('real API called'); },
    }) });
    await flush();
    const before = JSON.stringify(ui.store.getState());
    await ui.goto('/room/demo-preview');
    assert.equal(ui.win.location.hash, '#/room/demo-preview');
    assert.ok(ui.text().includes(t('demo.roomTitle'))); assert.ok(ui.text().includes(t('demo.roomHint')));
    assert.ok(!ui.text().includes(t('room.listenOnly')), '主动模拟模式不显示麦克风失败警告');
    assert.equal(ui.all('.call-controls button')[0].disabled, undefined);
    ui.all('.call-controls button')[0].click(); await flush();
    assert.ok(ui.text().includes(t('room.muted')));
    ui.all('.call-controls button')[0].click(); await flush();
    assert.equal(ui.one('.preset-avatar').getAttribute('data-avatar'), 'star');
    const first = ui.one('.topic-line.is-yue').textContent;
    assert.ok(ui.one('.topic-line.is-english').textContent); assert.ok(ui.one('.topic-line.is-mandarin').textContent);
    ui.all('.stack-nav button')[1].click(); await flush();
    assert.notEqual(ui.one('.topic-line.is-yue').textContent, first);
    ui.all('.stack-nav button')[0].click(); await flush();
    assert.equal(ui.one('.topic-line.is-yue').textContent, first);
    ui.one('.phrase-star').click(); await flush(); assert.ok(ui.one('.phrase-chip.is-saved'));
    for (let i = 0; i < 7; i++) { ui.all('.stack-nav button')[1].click(); await flush(); }
    assert.ok(ui.text().includes(t('room.deckEnd')));
    await ui.clickButton(t('room.dealMore'));
    assert.ok(ui.text().includes('1 / 8'));
    await ui.clickButton(t('room.hangup'));
    assert.equal(ui.win.location.hash, '#/room/demo-preview/summary');
    assert.ok(ui.text().includes(t('demo.summaryTitle')));
    await ui.clickButton(t('demo.exit'));
    assert.equal(ui.win.location.hash, '#/match');
    assert.equal(JSON.stringify(ui.store.getState()), before, '正式账号状态保持一致');
    assert.deepEqual(writes, [], '模拟功能不调用正式房间或收藏接口');
  }
});

test('模拟房间可直接打开或刷新；真实匹配中禁止进入，不影响队列', async () => {
  const direct = await boot({ hash: '#/room/demo-preview', learnerOnboarded: false });
  await flush();
  assert.equal(direct.win.location.hash, '#/room/demo-preview'); assert.ok(direct.one('.topic-card'));
  await direct.clickButton(t('demo.exit'));
  const ui = await boot({ hash: '#/match' });
  await flush();
  ui.store.startQueue({ anonymous: false }); ui.app.render(true); await flush();
  const queue = ui.store.getState().runtime.queue;
  await ui.goto('/room/demo-preview'); assert.equal(ui.win.location.hash, '#/match');
  assert.deepEqual(ui.store.getState().runtime.queue, queue);
});

test('两身份模拟结算显示实际时长和看卡积分，评价申请与再体验均不调用正式接口', async () => {
  for (const role of ['learner', 'buddy']) {
    const writes = [];
    const ui = await boot({ hash: '#/match', role, apiWrapper: base => ({ ...base,
      endRoom: async () => { writes.push('end'); throw Error('formal write'); },
      sendFeedback: async () => { writes.push('feedback'); throw Error('formal write'); },
      sendBuddyRequest: async () => { writes.push('buddy'); throw Error('formal write'); },
    }) }); await flush();
    const before = JSON.stringify(ui.store.getState());
    await ui.goto('/room/demo-preview');
    ui.all('.stack-nav button')[1].click(); await flush();
    ui.all('.stack-nav button')[1].click(); await flush();
    ui.advance(120000);
    const end = ui.button(t('room.hangup')); end.click(); end.click(); await flush();
    assert.equal(ui.win.location.hash, '#/room/demo-preview/summary');
    assert.ok(ui.text().includes(t('demo.summaryHint')));
    assert.equal(ui.one('.reward-xp').textContent, '+' + xpFor(120, 3));
    assert.equal(ui.all('.reward-row')[1].querySelector('strong').textContent, '3');
    assert.equal(ui.all('.reward-row')[0].querySelector('span').textContent, t('summary.durationLabel'));
    assert.equal(ui.all('.reward-row')[1].querySelector('span').textContent, t('summary.cardsUsed'));
    assert.ok(ui.one('.feedback-sheet'));
    ui.one('.feedback-sheet .pill').click(); await flush();
    await ui.clickButton(t('summary.saveFeedback')); assert.ok(ui.text().includes(t('demo.feedbackSaved')));
    await ui.clickButton(t('summary.sendRequest')); assert.ok(ui.text().includes(t('summary.requested')));
    assert.equal(JSON.stringify(ui.store.getState()), before);
    assert.deepEqual(writes, []);
    await ui.clickButton(t('demo.replay'));
    assert.equal(ui.win.location.hash, '#/room/demo-preview'); assert.ok(ui.text().includes('1 / 8'));
    await ui.clickButton(t('room.hangup'));
    assert.equal(ui.all('.reward-row')[1].querySelector('strong').textContent, '1');
    assert.ok(!ui.text().includes(t('summary.requested')), '新体验没有上次的模拟申请');
    await ui.clickButton(t('demo.exit')); assert.equal(ui.win.location.hash, '#/match');
    assert.equal(JSON.stringify(ui.store.getState()), before);
  }
});

test('刷新丢失模拟结算时重新进入模拟房间，正常退出不写正式记录', async () => {
  const ui = await boot({ hash: '#/room/demo-preview/summary' }); await flush();
  assert.equal(ui.win.location.hash, '#/room/demo-preview'); assert.ok(ui.one('.topic-card'));
  const before = JSON.stringify(ui.store.getState());
  await ui.clickButton(t('room.hangup'));
  assert.ok(ui.one('.reward-card'));
  await ui.clickButton(t('action.notNow'));
  assert.equal(ui.win.location.hash, '#/match'); assert.equal(JSON.stringify(ui.store.getState()), before);
});

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { boot, flush, restoreGlobalTimers } from './helpers/app-harness.mjs';
import { createTranslator } from '../src/i18n/i18n.js';
import { STORAGE_KEY } from '../src/app/store.js';
after(() => restoreGlobalTimers());
const t = createTranslator('zh-Hans');
const empty = { learners: [], buddies: [] };

async function queued(options = {}) {
  const ui = await boot({ hash: '#/match', candidates: empty, ...options });
  await flush();
  ui.store.startQueue();
  ui.app.render(true);
  await flush();
  return ui;
}
async function tick(ui, ms) { ui.advance(ms); ui.win.tick(1); await flush(); }

test('两身份等满10秒才提示，展示对应演示伙伴；再等10秒自动进房并退出正式队列', async () => {
  for (const role of ['learner', 'buddy']) {
    let leaves = 0;
    const ui = await queued({ role, signalUrl: 'wss://example.test/ws', apiWrapper: base => ({ ...base,
      leaveQueue: async () => { leaves++; return base.leaveQueue(); },
      getCards: async () => { throw Error('formal room API must not be used'); },
    }) });
    ui.win.__CANTOBRIDGE_DEV__ = false;
    await tick(ui, 9_000); assert.equal(ui.has('.demo-match-toast'), false);
    await tick(ui, 1_000); assert.ok(ui.has('.demo-match-toast'));
    assert.equal(ui.one('.match-toast-count').textContent, '10');
    assert.ok(ui.text().includes(t(role === 'buddy' ? 'demo.learnerName' : 'demo.buddyName')));
    assert.ok(ui.text().includes(t('demo.offerHint')), '自动进入规则必须在屏幕上可见');
    const account = ui.storage.getItem(STORAGE_KEY);
    await tick(ui, 9_000); assert.equal(ui.win.location.hash, '#/match');
    assert.equal(ui.one('.match-toast-count').textContent, '1');
    await tick(ui, 1_000);
    assert.equal(ui.win.location.hash, '#/room/demo-preview');
    assert.equal(leaves, 1); assert.equal(ui.store.getState().runtime.queue, null);
    assert.equal(ui.store.getState().runtime.room, null, '演示房间不写入正式运行状态');
    assert.ok(ui.one('.topic-card')); assert.ok(ui.text().includes(t('demo.roomHint')));
    ui.all('.stack-nav button')[1].click(); await flush();
    await ui.clickButton(t('room.hangup'));
    assert.equal(ui.win.location.hash, '#/room/demo-preview/summary');
    assert.equal(ui.storage.getItem(STORAGE_KEY), account, '正式存档不受模拟房间影响');
    await ui.clickButton(t('demo.replay')); assert.ok(ui.one('.topic-card'));
  }
});

test('立即接受只退出一次队列，后台页面也能体验房间', async () => {
  let leaves = 0;
  const ui = await queued({ apiWrapper: base => ({ ...base, leaveQueue: async () => { leaves++; return base.leaveQueue(); } }) });
  await ui.goto('/home'); await tick(ui, 10_000);
  const accept = ui.button(t('demo.accept')); accept.click(); accept.click(); await flush();
  assert.equal(ui.win.location.hash, '#/room/demo-preview'); assert.equal(leaves, 1);
});

test('继续等真人后跨页不重复提示；取消并重新入队可以再收到提示', async () => {
  const ui = await queued(); await tick(ui, 10_000);
  const joinedAt = ui.store.getState().runtime.queue.joinedAt;
  await ui.clickButton(t('demo.keepWaiting'));
  await ui.goto('/home'); await tick(ui, 60_000); await ui.goto('/match');
  assert.equal(ui.has('.demo-match-toast'), false);
  assert.equal(ui.store.getState().runtime.queue.joinedAt, joinedAt);
  await ui.api.leaveQueue(); ui.store.startQueue(); await tick(ui, 10_000);
  assert.ok(ui.has('.demo-match-toast'));
});

test('提示期间真人请求优先，收起演示提示且到期不进入演示房间', async () => {
  const ui = await queued(); await tick(ui, 10_000);
  ui.store.receiveMatchRequest({ roomId: 'real-offer', peer: { peerId: 'real-peer', displayName: 'Real' }, expiresAt: ui.store.now() + 30_000 });
  assert.equal(ui.has('.demo-match-toast'), false); assert.ok(ui.text().includes('Real'));
  await tick(ui, 10_000); assert.equal(ui.win.location.hash, '#/match');
  assert.equal(ui.store.getState().runtime.matchRequest.roomId, 'real-offer');
});

test('取消匹配或真人已成房会撤销演示倒计时', async () => {
  for (const action of ['cancel', 'room']) {
    const ui = await queued(); await tick(ui, 10_000);
    if (action === 'cancel') await ui.api.leaveQueue();
    else ui.store.startRoom({ roomId: 'live-room', peer: { peerId: 'real-peer' }, role: 'learner' });
    assert.equal(ui.has('.demo-match-toast'), false);
    await tick(ui, 15_000); assert.notEqual(ui.win.location.hash, '#/room/demo-preview');
  }
});

test('退出队列失败保留真人匹配并显示失败原因，不自动重试', async () => {
  let leaves = 0;
  const ui = await queued({ apiWrapper: base => ({ ...base, leaveQueue: async () => { leaves++; throw Error('offline'); } }) });
  await tick(ui, 10_000); await ui.clickButton(t('demo.accept'));
  assert.equal(ui.win.location.hash, '#/match'); assert.ok(ui.store.getState().runtime.queue);
  assert.ok(ui.text().includes(t('demo.enterFailed')));
  await tick(ui, 30_000); assert.equal(leaves, 1);
});

test('退出队列期间真人成房时保留真人房间，不覆盖为演示房间', async () => {
  let release;
  const ui = await queued({ apiWrapper: base => ({ ...base, leaveQueue: () => new Promise(resolve => { release = async () => { await base.leaveQueue(); resolve(); }; }) }) });
  await tick(ui, 10_000); ui.button(t('demo.accept')).click(); await flush();
  ui.store.startRoom({ roomId: 'live-wins', peer: { peerId: 'real-peer' }, role: 'learner' });
  await release(); await flush();
  assert.equal(ui.store.getState().runtime.room.roomId, 'live-wins');
  assert.notEqual(ui.win.location.hash, '#/room/demo-preview');
});

test('切换界面语言保留倒计时，翻译提示与演示伙伴名字', async () => {
  const ui = await queued(); await tick(ui, 10_000); await tick(ui, 3_000);
  ui.store.setLocale('en'); await flush();
  assert.ok(ui.text().includes(createTranslator('en')('demo.offerHint')));
  assert.equal(ui.one('.match-toast-count').textContent, '7');
  await ui.clickButton(createTranslator('en')('demo.accept'));
  assert.ok(ui.text().includes(createTranslator('en')('demo.buddyName')));
});

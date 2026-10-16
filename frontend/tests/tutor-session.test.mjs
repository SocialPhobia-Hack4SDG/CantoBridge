import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTutorSession } from '../src/services/tutorSession.js';
import { sampleTopicCards, sampleTutorReply } from '../src/services/tutorSample.js';

const card = sampleTopicCards({ learnerInterests: ['food'], buddyInterests: ['food'], cantoneseLevel: 'beginner', count: 1 }).cards[0];
function harness(api = { replyToTutor: async input => sampleTutorReply(input) }) {
  const timers = new Map(); const states = []; let seq = 0;
  const session = createTutorSession({ api, onChange: state => states.push(state), setTimer: (fn, ms) => { assert.equal(ms, 3000); timers.set(++seq, fn); return seq; }, clearTimer: id => timers.delete(id) });
  return { session, states, timers, tick() { const due = [...timers.values()]; timers.clear(); due.forEach(fn => fn()); } };
}

test('语音预览：等待→思考→回应→等待，示例发言和回复可见，不创建媒体对象', async () => {
  const ui = harness(); ui.session.start();
  const request = ui.session.finishExample(card);
  assert.equal(ui.session.getState().phase, 'thinking');
  await request; assert.equal(ui.session.getState().phase, 'speaking');
  assert.equal(ui.session.getState().utterance, card.expressions[0].cantonese);
  assert.equal(ui.session.getState().turns, 1); assert.equal(ui.timers.size, 1);
  ui.tick(); assert.equal(ui.session.getState().phase, 'listening');
  ui.session.dispose(); assert.equal(ui.timers.size, 0);
});

test('暂停阻止发言，恢复可继续，打断回应与换话题取消旧计时', async () => {
  const ui = harness(); ui.session.start(); ui.session.toggleMute();
  await ui.session.finishExample(card); assert.equal(ui.session.getState().turns, 0);
  ui.session.toggleMute(); await ui.session.finishExample(card); ui.session.interrupt();
  assert.equal(ui.session.getState().phase, 'listening'); assert.equal(ui.timers.size, 0);
  await ui.session.finishExample(card); ui.session.resetTopic();
  assert.equal(ui.session.getState().reply, null); assert.equal(ui.timers.size, 0);
});

test('重复发言只请求一次；结束或离开后忽略迟到回复，不残留计时', async () => {
  for (const action of ['end', 'dispose', 'resetTopic']) {
    let resolve; let calls = 0;
    const ui = harness({ replyToTutor: () => { calls++; return new Promise(done => { resolve = done; }); } });
    ui.session.start(); const pending = ui.session.finishExample(card);
    await ui.session.finishExample(card); assert.equal(calls, 1);
    ui.session[action](); const changes = ui.states.length;
    resolve(sampleTutorReply({ currentCard: card })); await pending;
    assert.equal(ui.states.length, changes); assert.equal(ui.timers.size, 0);
    assert.equal(ui.session.getState().turns, 0);
  }
});

test('失败或非mock回复不能伪装成AI语音成功，可在原卡重试', async () => {
  let count = 0;
  const ui = harness({ replyToTutor: async args => { count++; if (count === 1) throw Error('offline'); if (count === 2) return { ...sampleTutorReply(args), mode: 'live' }; return sampleTutorReply(args); } });
  ui.session.start();
  for (let i = 0; i < 2; i++) { await ui.session.finishExample(card); assert.equal(ui.session.getState().phase, 'listening'); assert.equal(ui.session.getState().error, true); }
  await ui.session.finishExample(card); assert.equal(ui.session.getState().turns, 1);
  ui.session.end(); assert.equal(ui.timers.size, 0);
});

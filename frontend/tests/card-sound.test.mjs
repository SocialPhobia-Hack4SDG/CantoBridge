import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createCardSound } from '../src/lib/cardSound.js';
import { boot, flush, restoreGlobalTimers } from './helpers/app-harness.mjs';
after(() => restoreGlobalTimers());

function audioFixture() {
  const nodes = []; const envelopes = []; let closed = 0;
  class AudioContext {
    sampleRate = 48000; currentTime = 1; state = 'suspended'; destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    createBuffer(channels, length) { assert.equal(channels, 1); assert.equal(length, 6240); return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { const node = { connect() {}, start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } }; nodes.push(node); return node; }
    createBiquadFilter() { return { frequency: {}, Q: {}, connect() {} }; }
    createGain() { return { connect() {}, gain: { setValueAtTime: (value, time) => envelopes.push([value, time]), linearRampToValueAtTime: (value, time) => envelopes.push([value, time]) } }; }
    close() { closed++; return Promise.resolve(); }
  }
  return { AudioContext, nodes, envelopes, closed: () => closed };
}

test('纸张滑动音效短且柔和，按手势唤醒，退出释放音频上下文', () => {
  const audio = audioFixture(); const sound = createCardSound(audio);
  assert.equal(sound.play(), true); assert.equal(sound.play(), true);
  assert.equal(audio.nodes.length, 2);
  for (const node of audio.nodes) assert.ok(Math.abs(node.stopTime - node.startTime - .13) < .00001);
  assert.ok(audio.envelopes.every(([gain]) => gain >= 0 && gain <= .085));
  sound.close(); assert.equal(audio.closed(), 1); sound.close(); assert.equal(audio.closed(), 1);
});
test('没有音频能力或浏览器拒绝创建音频时，翻卡不抛异常', () => {
  assert.equal(createCardSound({}).play(), false);
  assert.equal(createCardSound({ AudioContext: class { constructor() { throw Error('blocked'); } } }).play(), false);
});
test('滑动或按钮成功翻卡才播放，越界和关闭音效不播放，退出关闭；建议有正确提示', async () => {
  const ui = await boot({ hash: '#/room/demo-preview' }); await flush();
  const audio = audioFixture(); ui.win.AudioContext = audio.AudioContext;
  const swipe = delta => { const body = ui.one('.stack-body'); body.dispatch('pointerdown', { clientX: 150 }); body.dispatch('pointerup', { clientX: 150 + delta }); };
  assert.ok(ui.text().includes('或许你可以尝试这样说……'));
  swipe(100); await flush(); assert.equal(audio.nodes.length, 0, '首张不向前翻');
  swipe(-100); await flush(); assert.equal(audio.nodes.length, 1);
  ui.all('.stack-nav button')[1].click(); await flush(); assert.equal(audio.nodes.length, 2);
  ui.one('.card-sound-toggle').click(); await flush();
  assert.equal(ui.one('.card-sound-toggle').getAttribute('aria-pressed'), 'false');
  swipe(-100); await flush(); assert.equal(audio.nodes.length, 2);
  await ui.clickButton('返回匹配大厅'); assert.equal(audio.closed(), 1);
});

test('通话进行中：翻卡音效复用通话那条 AudioContext，既不新建、也不关它', () => {
  const audio = audioFixture();
  const shared = new audio.AudioContext();
  const sound = createCardSound(audio, { getContext: () => shared });

  assert.equal(sound.play(), true);
  assert.equal(audio.nodes.length, 1, '音效要在共享的那条上下文上播');

  sound.close();
  assert.equal(audio.closed(), 0, '共享的那条属于通话会话，翻卡音效绝不能关它');

  // 通话结束后那条上下文被会话关掉：退回自己建一条，并且这条才由 close() 释放
  shared.state = 'closed';
  assert.equal(sound.play(), true, '死掉的上下文要能退回自己建，不能硬往里面塞 buffer');
  assert.equal(audio.nodes.length, 2);
  sound.close();
  assert.equal(audio.closed(), 1, '自己建的那条才由这里释放');
});

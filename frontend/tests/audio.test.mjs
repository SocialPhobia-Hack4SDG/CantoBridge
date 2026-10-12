import assert from 'node:assert/strict';
import { test } from 'node:test';

import { barHeights, levelFromWaveform, simulatedLevel, smoothLevel } from '../src/lib/audio.js';

test('levelFromWaveform：静音为 0，越界输入不炸', () => {
  assert.equal(levelFromWaveform([]), 0);
  assert.equal(levelFromWaveform(null), 0);
  assert.equal(levelFromWaveform(new Uint8Array(64).fill(128)), 0);
});

test('levelFromWaveform：有声音时大于 0 且被限制在 1 以内', () => {
  const quiet = new Uint8Array(64);
  for (let index = 0; index < quiet.length; index += 1) quiet[index] = 150;
  const loud = new Uint8Array(64);
  for (let index = 0; index < loud.length; index += 1) loud[index] = index % 2 === 0 ? 0 : 255;
  assert.ok(levelFromWaveform(quiet) > 0);
  assert.ok(levelFromWaveform(loud) > levelFromWaveform(quiet));
  assert.ok(levelFromWaveform(loud) <= 1);
});

test('simulatedLevel：确定性、有起伏、始终在 0.04 ~ 1', () => {
  assert.equal(simulatedLevel(1000, 1), simulatedLevel(1000, 1));
  assert.notEqual(simulatedLevel(1000, 1), simulatedLevel(1300, 1));
  const samples = [];
  for (let time = 0; time < 4000; time += 50) samples.push(simulatedLevel(time, 2));
  assert.ok(samples.every((value) => value >= 0.04 && value <= 1));
  assert.ok(new Set(samples.map((value) => value.toFixed(2))).size > 20, '假波形要像人说话，不能是直线');
  assert.ok(Math.min(...samples) < 0.4, '要有停顿感');
});

test('smoothLevel：上升用 attack、回落用 release', () => {
  const rising = smoothLevel(0, 1, { attack: 0.5, release: 0.1 });
  assert.equal(rising, 0.5);
  const falling = smoothLevel(1, 0, { attack: 0.5, release: 0.1 });
  assert.equal(falling, 0.9);
  assert.equal(smoothLevel(0.5, 5), 0.5 + (1 - 0.5) * 0.55);
  assert.equal(smoothLevel(0.5, -3), 0.5 + (0 - 0.5) * 0.14);
});

test('barHeights：数量对得上、都在范围内、中间比两端高', () => {
  const heights = barHeights(0.8, 9);
  assert.equal(heights.length, 9);
  assert.ok(heights.every((value) => value >= 0.18 && value <= 1));
  assert.ok(heights[4] > heights[0]);
  assert.equal(barHeights(0, 5).length, 5);
  assert.ok(barHeights(0, 5).every((value) => value >= 0.18));
});
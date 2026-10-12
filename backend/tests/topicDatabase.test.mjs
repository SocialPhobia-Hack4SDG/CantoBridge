/**
 * 话题卡池**同源**：`src/data/topicDatabase.js` 与前端 `src/data/topicDatabase.js`
 * 必须逐字段一致（张数、顺序、id、主题、难度、三语问句、可照读句型，以及 `TOPIC_LABELS`）。
 *
 * 为什么要钉住：卡池是 Phase 3「三语话题卡」的唯一数据来源。后端下发、前端渲染，
 * 两边各存一份；一旦漂移（改了一张卡的粤语用字、少了一档难度），
 * 现场演示时同一个房间在两个屏幕上会显示不同的卡——而且不会报错。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TOPIC_DATABASE, TOPIC_LABELS } from '../src/data/topicDatabase.js';
import { INTERESTS } from '../src/data/vocabularies.js';
import {
  TOPIC_DATABASE as FRONTEND_DATABASE,
  TOPIC_LABELS as FRONTEND_LABELS,
} from '../../frontend/src/data/topicDatabase.js';

const DIFFICULTIES = ['beginner', 'elementary', 'intermediate', 'advanced'];

test('TOPIC_LABELS：二十种主题的文案逐值等于前端', () => {
  assert.deepEqual(TOPIC_LABELS, FRONTEND_LABELS);
});

test('TOPIC_DATABASE：472 张（13 个兴趣主题 × 4 档 × 8 张 + 7 个通用主题 × 4 档 × 2 张），顺序与前端一致', () => {
  assert.equal(TOPIC_DATABASE.length, 472, '兴趣主题每档 8 张（选卡主力），通用主题每档 2 张（只做兜底）');
  assert.equal(new Set(TOPIC_DATABASE.map((card) => card.id)).size, 472, 'id 不能重复');
  assert.deepEqual(
    TOPIC_DATABASE.map((card) => card.id),
    FRONTEND_DATABASE.map((card) => card.id),
    '顺序也要一致（选卡在同分时按题库顺序排）',
  );
});

test('TOPIC_DATABASE：逐张卡逐字段等于前端', () => {
  for (const expected of FRONTEND_DATABASE) {
    const actual = TOPIC_DATABASE.find((card) => card.id === expected.id);
    assert.ok(actual, `后端缺卡：${expected.id}`);
    assert.deepEqual(actual, expected, `${expected.id} 与前端不一致`);
  }
});

test('卡池结构：每个主题四档齐全；兴趣主题每档 8 张、通用主题每档 2 张，三语与句型都不缺', () => {
  const topics = [...new Set(TOPIC_DATABASE.map((card) => card.topic))];
  assert.equal(topics.length, 20, '二十个主题');
  assert.equal(INTERESTS.length, 13, '兴趣词表本身没变');
  for (const topic of topics) {
    const mine = TOPIC_DATABASE.filter((card) => card.topic === topic);
    const expected = INTERESTS.includes(topic) ? 8 : 2;
    assert.equal(mine.length, expected * 4, `${topic} 每档 ${expected} 张 × 4 档`);
    for (const difficulty of DIFFICULTIES) {
      const count = mine.filter((card) => card.difficulty === difficulty).length;
      assert.equal(count, expected, `${topic} / ${difficulty} 应当有 ${expected} 张，实际 ${count}`);
    }
  }

  for (const card of TOPIC_DATABASE) {
    assert.ok(card.cantonese && card.mandarin && card.english, `${card.id} 三语问句要齐`);
    assert.ok(card.jyutping?.trim(), `${card.id} 必须带粤拼`);
    assert.match(card.jyutping, /[a-z]+[1-6]/, `${card.id} 粤拼必须带声调`);
    assert.doesNotMatch(card.jyutping, /[\u3400-\u9fff]/, `${card.id} 不得留下未转换汉字`);
    assert.ok(Array.isArray(card.expressions) && card.expressions.length >= 1, `${card.id} 至少一句可照读句型`);
    for (const phrase of card.expressions) {
      assert.ok(phrase.cantonese && phrase.mandarin && phrase.english, `${card.id} 的句型三语要齐`);
    }
  }
});

test('卡池够用：每个难度的窗口里至少 8 张（一次预取一叠不会重复）', () => {
  // 与 topics.js 的窗口口径一致：这里只要求「最低限度够填满 count 默认值 8」
  const windows = {
    beginner: ['beginner'],
    elementary: ['beginner', 'elementary'],
    intermediate: ['elementary', 'intermediate'],
    advanced: ['intermediate', 'advanced'],
  };
  for (const [level, window] of Object.entries(windows)) {
    const count = TOPIC_DATABASE.filter((card) => window.includes(card.difficulty)).length;
    assert.ok(count >= 8, `${level} 的窗口只有 ${count} 张，不够默认一叠 8 张`);
  }
});

test('卡池够用：每个兴趣主题自己就能连开四叠 8 张不重复（每档 8 张的意义）', () => {
  for (const topic of INTERESTS) {
    const mine = TOPIC_DATABASE.filter((card) => card.topic === topic);
    assert.ok(mine.length >= 32, `${topic} 只有 ${mine.length} 张，单兴趣连四叠都凑不满`);
  }
});

test('对照能真的发现差异（防止比对形同虚设）', () => {
  const mutated = FRONTEND_DATABASE.map((card, index) =>
    index === 0 ? { ...card, cantonese: card.cantonese + '（被改了）' } : card,
  );
  assert.throws(
    () => {
      for (let index = 0; index < mutated.length; index += 1) {
        assert.deepEqual(TOPIC_DATABASE[index], mutated[index]);
      }
    },
    /deepStrictEqual|Expected/,
    '改一个字都要能被这张对照抓出来',
  );
});

/**
 * 积分 / 成就 / 等级**同源**：`src/lib/scoring.js` 与前端 `src/lib/logic.js` 逐值一致。
 *
 * 契约 4.5 节：「积分规则与前端纯函数保持一致：每分钟 6 点 + 每张卡 5 点（`xpFor`）」。
 * 两边各有一份实现（后端不能依赖前端源码目录），所以这里**把前端实现当预期值**：
 * 前端改了公式而没同步后端，这条用例立刻红——而不是靠人记得改两处。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as frontend from '../../frontend/src/lib/logic.js';
import * as backend from '../src/lib/scoring.js';

test('xpFor：逐值等于前端（0 秒 / 0 卡 / 四舍五入 / 大数值）', () => {
  const cases = [
    [0, 0],
    [60, 0],
    [0, 1],
    [59, 2],
    [89, 0],
    [90, 3],
    [125, 3],
    [3600, 0],
    [86400, 32],
    [1, 1],
    [30, 8],
  ];
  for (const [durationSec, cardsUsed] of cases) {
    assert.equal(
      backend.xpFor(durationSec, cardsUsed),
      frontend.xpFor(durationSec, cardsUsed),
      `xpFor(${durationSec}, ${cardsUsed}) 与前端不一致`,
    );
  }
});

test('xpFor：契约口径（每分钟 6 点 + 每张卡 5 点，四舍五入到整数）', () => {
  assert.equal(backend.xpFor(600, 0), 60, '10 分钟 = 60 点');
  assert.equal(backend.xpFor(0, 8), 40, '0 分钟 8 张卡 = 40 点');
  assert.equal(backend.xpFor(125, 3), 28, 'round(125/60*6)=13，加 3 张卡 15 点');
  assert.equal(backend.xpFor(30, 0), 3, 'round(3) = 3');
  assert.equal(backend.xpFor(5, 0), 1, 'round(0.5) = 1（JS 的 round 向上）');
});

test('xpFor：负数与非数字按 0 处理，不抛错、不出现负积分', () => {
  const weird = [
    [-10, -3],
    [Number.NaN, 2],
    [2, Number.NaN],
    ['不是数字', 1],
    [undefined, undefined],
  ];
  for (const [durationSec, cardsUsed] of weird) {
    const value = backend.xpFor(durationSec, cardsUsed);
    assert.equal(value, frontend.xpFor(durationSec, cardsUsed), `xpFor(${String(durationSec)}, ${String(cardsUsed)}) 与前端不一致`);
    assert.ok(value >= 0, '积分不能是负的');
  }
});

test('buddyLevel：三个台阶的边界逐值等于前端', () => {
  for (const peopleHelped of [0, 1, 2, 4, 5, 9, 10, 11]) {
    for (const totalMinutes of [0, 29, 30, 59, 60, 89, 90, 179, 180, 240]) {
      assert.equal(
        backend.buddyLevel({ totalMinutes, peopleHelped }),
        frontend.buddyLevel({ totalMinutes, peopleHelped }),
        `buddyLevel({totalMinutes: ${totalMinutes}, peopleHelped: ${peopleHelped}})`,
      );
    }
  }
});

test('buddyLevel：缺省参数是 newcomer（不炸、也不误判成 helper）', () => {
  assert.equal(backend.buddyLevel(), 'newcomer');
  assert.equal(backend.buddyLevel({}), frontend.buddyLevel({}));
  assert.equal(backend.buddyLevel({ peopleHelped: 2 }), 'helper');
  assert.equal(backend.buddyLevel({ totalMinutes: 180 }), 'ambassador');
});

test('ACHIEVEMENT_RULES：八条规则的身份与 id 一一对应', () => {
  assert.equal(backend.ACHIEVEMENT_RULES.length, 14, '两种身份各 4 项，另有 6 项共同成就');
  assert.deepEqual(
    backend.ACHIEVEMENT_RULES.map((rule) => `${rule.role}:${rule.id}`),
    frontend.ACHIEVEMENT_RULES.map((rule) => `${rule.role}:${rule.id}`),
  );
  assert.equal(new Set(backend.ACHIEVEMENT_RULES.map((rule) => rule.id)).size, 14, 'id 不能重复');
});

test('unlockedAchievements：统计网格扫一遍，两边逐个一致', () => {
  const conversations = [0, 1, 3];
  const totalMinutes = [0, 29, 30, 60, 180];
  const streakDays = [0, 7];
  const distinctTopics = [0, 5];
  const peopleHelped = [0, 3, 10];

  for (const role of ['learner', 'buddy']) {
    for (const a of conversations) {
      for (const b of totalMinutes) {
        for (const c of streakDays) {
          for (const d of distinctTopics) {
            for (const e of peopleHelped) {
              const stats = { conversations: a, totalMinutes: b, streakDays: c, distinctTopics: d, peopleHelped: e };
              assert.deepEqual(
                backend.unlockedAchievements(role, stats),
                frontend.unlockedAchievements(role, stats),
                `${role} ${JSON.stringify(stats)}`,
              );
            }
          }
        }
      }
    }
  }
});

test('unlockedAchievements：缺字段按 0 处理，不是 undefined 崩溃', () => {
  assert.deepEqual(backend.unlockedAchievements('learner', {}), []);
  assert.deepEqual(backend.unlockedAchievements('learner'), frontend.unlockedAchievements('learner'));
  // 身份只解锁自己那一侧的成就，不会串台
  const stats = { conversations: 1, peopleHelped: 10, totalMinutes: 200, distinctTopics: 8, streakDays: 9 };
  assert.ok(backend.unlockedAchievements('learner', stats).every((id) => id !== 'conversation_hero'));
  assert.ok(backend.unlockedAchievements('buddy', stats).every((id) => id !== 'seven_day_streak'));
});

test('newlyUnlocked：只报新增（契约：unlocked 只含本次新解锁）', () => {
  assert.deepEqual(backend.newlyUnlocked(['first_conversation'], ['first_conversation', 'cantonese_explorer']), [
    'cantonese_explorer',
  ]);
  assert.deepEqual(backend.newlyUnlocked([], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(backend.newlyUnlocked(['a', 'b'], ['a']), [], '已经解锁过的不再报');
  assert.deepEqual(backend.newlyUnlocked(undefined, ['a']), ['a'], '没有 before 时不能炸');
  assert.deepEqual(backend.newlyUnlocked(['a'], undefined), []);
  assert.deepEqual(
    backend.newlyUnlocked(['x'], ['x', 'y']),
    frontend.newlyUnlocked(['x'], ['x', 'y']),
    '与前端同源',
  );
});

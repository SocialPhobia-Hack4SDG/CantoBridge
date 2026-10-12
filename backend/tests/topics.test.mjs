/**
 * 选卡**同源**：`src/lib/topics.js` 与前端 `src/lib/topicPicker.js` 逐值一致。
 *
 * 选卡现在是「**双方兴趣优先 + 水平窗口 + 可复现洗牌**」：同一组入参（含 `seed`）
 * 必须给同一叠卡（后端靠它保证同一个房间的两侧看到同一张），换一个 `seed` 才换一叠。
 * 两边各一份实现，这里把前端当预期值扫组合：难度 × 兴趣 × 张数 × 种子，
 * 外加注入 `random`、循环补齐、空池这几个边界。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as frontend from '../../frontend/src/lib/topicPicker.js';
import * as backend from '../src/lib/topics.js';
import { GENERAL_TOPICS, TOPIC_DATABASE } from '../src/data/topicDatabase.js';

const LEVELS = ['beginner', 'elementary', 'intermediate', 'advanced', 'unknown'];
const INTEREST_SETS = [[], ['movies'], ['anime', 'food'], ['nonexistent'], ['movies', 'anime', 'food', 'gaming']];
const COUNTS = [1, 3, 8, 32, 40];
const SEEDS = [0, 1, 20261004];

const idsOf = (cards) => cards.map((card) => card.id);

test('对外接口逐项一致（少一个导出就是两边漂移了）', () => {
  assert.deepEqual(Object.keys(backend).sort(), Object.keys(frontend).sort());
});

test('difficultyWindow：四个档位 + 未知档位的兜底窗口等于前端', () => {
  for (const level of LEVELS) {
    assert.deepEqual(backend.difficultyWindow(level), frontend.difficultyWindow(level), `level=${level}`);
  }
  assert.deepEqual(backend.difficultyWindow(undefined), ['beginner', 'elementary'], '缺省是初学者的窗口');
});

test('difficultyDistance：离本人档位几档远，等于前端', () => {
  for (const level of LEVELS) {
    for (const difficulty of ['beginner', 'elementary', 'intermediate', 'advanced', 'nonsense']) {
      assert.equal(
        backend.difficultyDistance(difficulty, level),
        frontend.difficultyDistance(difficulty, level),
        `${difficulty} / ${level}`,
      );
    }
  }
});

test('pickCards：难度 × 兴趣 × 张数 × 种子的组合扫一遍，两边逐张一致', () => {
  for (const level of LEVELS) {
    for (const interests of INTEREST_SETS) {
      for (const count of COUNTS) {
        for (const seed of SEEDS) {
          const args = { level, interests, count, seed };
          assert.deepEqual(
            backend.pickCards(args),
            frontend.pickCards(args),
            `pickCards(${JSON.stringify(args)}) 与前端不一致`,
          );
        }
      }
    }
  }
});

test('pickCards：注入 random / seenCards / usedTopics 时也逐张一致', () => {
  // 注意 `random` 是**有状态**的（每调一次前进一格），所以两边必须各拿一个同种子的实例
  const makeRandom = (seed) => frontend.seededRandom(seed);
  const cases = [
    { level: 'beginner', interests: ['anime'], count: 8, random: makeRandom(5) },
    { level: 'intermediate', interests: [], count: 12, random: makeRandom(9) },
    { level: 'elementary', interests: ['food', 'music'], count: 8, seed: 7, usedTopics: ['food'] },
    { level: 'advanced', interests: ['technology'], count: 8, seed: 3, seenCards: ['technology-advanced-01'] },
  ];
  for (const args of cases) {
    const forBackend = { ...args };
    const forFrontend = { ...args };
    if (typeof args.random === 'function') {
      forBackend.random = makeRandom(5);
      forFrontend.random = makeRandom(5);
    }
    assert.deepEqual(backend.pickCards(forBackend), frontend.pickCards(forFrontend), JSON.stringify(args));
  }
});

test('pickCards：只从双方兴趣的主题里出卡（够填满一叠时一张无关的都不掺）', () => {
  const cards = backend.pickCards({ level: 'beginner', interests: ['anime', 'food'], count: 8, seed: 1 });
  assert.equal(cards.length, 8);
  assert.deepEqual(
    [...new Set(cards.map((card) => card.topic))].sort(),
    ['anime', 'food'],
    '只出这两个兴趣主题',
  );
  for (const card of cards) assert.equal(card.difficulty, 'beginner', '窗口里够 8 张就不越窗口');
});

test('pickCards：单个兴趣、窗口里不够时，放宽难度也只在兴趣主题内', () => {
  // anime 在 beginner 窗口里有 8 张，要 12 张就得放宽到相邻档；
  // 放宽只发生在**同一个兴趣主题内**，绝不掺无关主题。
  const cards = backend.pickCards({ level: 'beginner', interests: ['anime'], count: 12, seed: 5 });
  assert.equal(cards.length, 12);
  assert.deepEqual([...new Set(cards.map((card) => card.topic))], ['anime'], '绝不掺无关主题');
  assert.equal(cards.filter((card) => card.difficulty === 'beginner').length, 8, '先把本人档位给完');
  assert.equal(cards.filter((card) => card.difficulty === 'elementary').length, 4, '再给相邻的下一档');
});

test('pickCards：没有可用的兴趣主题时，兜底只用通用主题（不铺开全部 20 个主题）', () => {
  const cards = backend.pickCards({ level: 'beginner', interests: ['nonexistent'], count: 8, seed: 3 });
  assert.equal(cards.length, 8);
  assert.ok(
    [...new Set(cards.map((card) => card.topic))].every((topic) => GENERAL_TOPICS.includes(topic)),
    '兜底只能是通用主题，实际：' + [...new Set(cards.map((card) => card.topic))].join(', '),
  );
  assert.ok(new Set(cards.map((card) => card.topic)).size > 2, '通用主题也是铺开的');
  for (const card of cards) assert.equal(card.difficulty, 'beginner');
});

test('pickCards：同一个 seed 两次给同一叠，换 seed 就换一叠（「同房同步」与「不重复」同时成立）', () => {
  const args = { level: 'intermediate', interests: ['movies'], count: 8 };
  assert.deepEqual(idsOf(backend.pickCards({ ...args, seed: 11 })), idsOf(backend.pickCards({ ...args, seed: 11 })));
  assert.notDeepEqual(
    idsOf(backend.pickCards({ ...args, seed: backend.seedFrom('r-abc:0') })),
    idsOf(backend.pickCards({ ...args, seed: backend.seedFrom('r-abc:1') })),
    '同一个房间换一叠应当换一批卡',
  );
});

test('seedFrom / seededRandom：与前端同值（后端算种子、前端也能自己验）', () => {
  for (const text of ['r-abc:0', 'r-abc:1', '', 'preview-learner-demo-01:3']) {
    assert.equal(backend.seedFrom(text), frontend.seedFrom(text), text);
  }
  const a = backend.seededRandom(42);
  const b = frontend.seededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('pickCards：count 为 0 / 负数时至少给 1 张（与前端同一口径）', () => {
  for (const count of [0, -5]) {
    const cards = backend.pickCards({ level: 'beginner', count, seed: 1 });
    assert.equal(cards.length, 1, `count=${String(count)} 时至少 1 张`);
    assert.deepEqual(cards, frontend.pickCards({ level: 'beginner', count, seed: 1 }));
  }
});

test('pickCards：count 是 NaN 时两边都返回空数组（调用方必须给数字）', () => {
  // Math.max(1, Math.round(NaN)) === NaN，循环一次都不跑 —— 前端也是这个行为。
  // 这不是「后端特有的坑」：HTTP 层的 clampCount 会把缺省 / 非数字一律兜成 8，
  // 所以接口不可能把这个空数组发出去；这里只是把纯函数的口径钉住。
  const cards = backend.pickCards({ level: 'beginner', count: Number.NaN });
  assert.deepEqual(cards, []);
  assert.deepEqual(cards, frontend.pickCards({ level: 'beginner', count: Number.NaN }), '与前端一致');
});

test('pickCards：空卡池返回空数组，而不是循环出 undefined', () => {
  assert.deepEqual(backend.pickCards({ database: [], level: 'beginner', count: 8 }), []);
  assert.deepEqual(frontend.pickCards({ database: [], level: 'beginner', count: 8 }), []);
});

test('pickCards：要的比池子多时循环补齐（不传兴趣 → 只用通用主题那 14 张）', () => {
  // 不传兴趣 = 交集为空 → 选卡器只拿通用主题兜底；beginner 窗口里就是 7 × 2 = 14 张。
  const generalPool = TOPIC_DATABASE.filter(
    (card) => card.difficulty === 'beginner' && GENERAL_TOPICS.includes(card.topic),
  );
  assert.equal(generalPool.length, 14, '通用主题在 beginner 窗口里 7 个主题 × 2 张');
  const cards = backend.pickCards({ level: 'beginner', count: generalPool.length + 8, seed: 4 });
  assert.equal(cards.length, generalPool.length + 8);
  assert.equal(new Set(idsOf(cards)).size, generalPool.length, '同一批卡循环');
  assert.deepEqual(
    idsOf(cards).slice(generalPool.length),
    idsOf(cards).slice(0, 8),
    '第二轮与第一轮同一批、同一顺序（同 seed 可复现）',
  );
});

test('默认参数：不传 database 时用后端卡池，不传 level 时按 beginner', () => {
  const cards = backend.pickCards({ count: 4, seed: 2 });
  assert.equal(cards.length, 4);
  for (const card of cards) {
    assert.equal(card.difficulty, 'beginner');
  }
});

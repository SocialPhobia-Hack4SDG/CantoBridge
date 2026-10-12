import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TOPIC_DATABASE } from '../src/data/topicDatabase.js';
import { INTERESTS } from '../src/data/tags.js';
import {
  difficultyDistance,
  difficultyWindow,
  pickCards,
  seedFrom,
  seededRandom,
  sharedInterests,
} from '../src/lib/topicPicker.js';

const DIFFICULTIES = ['beginner', 'elementary', 'intermediate', 'advanced'];

/** 兴趣主题（「我的」页能勾的 13 个）与通用主题（只做兜底）。 */
const GENERIC_TOPICS = [...new Set(TOPIC_DATABASE.map((card) => card.topic))].filter(
  (topic) => !INTERESTS.includes(topic),
);

const idsOf = (cards) => cards.map((card) => card.id);
const topicsOf = (cards) => [...new Set(cards.map((card) => card.topic))];

test('difficultyWindow：四档水平各自给相邻档', () => {
  assert.deepEqual(difficultyWindow('beginner'), ['beginner']);
  assert.deepEqual(difficultyWindow('elementary'), ['beginner', 'elementary']);
  assert.deepEqual(difficultyWindow('intermediate'), ['elementary', 'intermediate']);
  assert.deepEqual(difficultyWindow('advanced'), ['intermediate', 'advanced']);
  assert.deepEqual(difficultyWindow('unknown'), ['beginner', 'elementary']);
});

test('difficultyDistance：离本人档位几档远，未知档位排到最后', () => {
  assert.equal(difficultyDistance('beginner', 'beginner'), 0);
  assert.equal(difficultyDistance('elementary', 'beginner'), 1);
  assert.equal(difficultyDistance('advanced', 'beginner'), 3);
  assert.equal(difficultyDistance('beginner', 'advanced'), 3);
  assert.equal(difficultyDistance('nonsense', 'beginner'), DIFFICULTIES.length);
  assert.equal(difficultyDistance('beginner', 'nonsense'), DIFFICULTIES.length);
});

test('话题卡池：20 个主题 × 4 档，兴趣主题每档 8 张、通用主题每档 2 张 = 472 张', () => {
  assert.equal(TOPIC_DATABASE.length, 472, '13 个兴趣主题 × 4 档 × 8 张 + 7 个通用主题 × 4 档 × 2 张');
  assert.equal(new Set(TOPIC_DATABASE.map((card) => card.topic)).size, 20);
  assert.equal(INTERESTS.length, 13, '兴趣词表本身没变');
  assert.equal(GENERIC_TOPICS.length, 7, '7 个通用主题（兜底用）');
  assert.equal(new Set(TOPIC_DATABASE.map((card) => card.id)).size, TOPIC_DATABASE.length);

  for (const card of TOPIC_DATABASE) {
    assert.ok(card.id && card.cantonese && card.mandarin && card.english, `${card.id} 三语要齐`);
    assert.ok(card.expressions.length >= 2, `${card.id} 至少两句可照读句型`);
    assert.ok(card.expressions.every((item) => item.cantonese && item.mandarin && item.english));
  }
});

test('话题卡池：每个主题四档齐全；兴趣主题每档 8 张（选卡的主力）', () => {
  for (const topic of [...new Set(TOPIC_DATABASE.map((card) => card.topic))]) {
    const mine = TOPIC_DATABASE.filter((card) => card.topic === topic);
    const expected = INTERESTS.includes(topic) ? 8 : 2;
    for (const difficulty of DIFFICULTIES) {
      const count = mine.filter((card) => card.difficulty === difficulty).length;
      assert.equal(count, expected, `${topic} / ${difficulty} 应当有 ${expected} 张，实际 ${count}`);
    }
  }
});

test('话题卡池：「我的」页能勾的每个兴趣都真的有卡（勾了不能等于没勾）', () => {
  const covered = new Set(TOPIC_DATABASE.map((card) => card.topic));
  const missing = INTERESTS.filter((interest) => !covered.has(interest));
  assert.deepEqual(missing, [], `这些兴趣选不到卡：${missing.join(', ')}`);
});

test('pickCards：兴趣主题够填满一叠时，**一张无关主题的卡都不掺**', () => {
  const cards = pickCards({ level: 'beginner', interests: ['anime', 'food'], count: 8, seed: 1 });
  assert.equal(cards.length, 8);
  assert.deepEqual(topicsOf(cards).sort(), ['anime', 'food'], '只出这两个兴趣主题');
  assert.ok(cards.every((card) => card.difficulty === 'beginner'), '窗口里够 8 张，难度不越窗口');
});

test('pickCards：没有可用的兴趣主题时，兜底**只用通用主题**（不铺开全部 20 个主题）', () => {
  // 一个卡池里不存在的兴趣 = 交集为空 → 只用那 7 个「谁都能聊」的通用主题
  const cards = pickCards({ level: 'beginner', interests: ['nonexistent'], count: 8, seed: 3 });
  assert.equal(cards.length, 8);
  assert.ok(
    topicsOf(cards).every((topic) => GENERIC_TOPICS.includes(topic)),
    '兜底只能是通用主题，实际：' + topicsOf(cards).join(', '),
  );
  assert.ok(topicsOf(cards).length > 2, '通用主题也是铺开的，不再局限于一两个兴趣');
  assert.ok(cards.every((card) => card.difficulty === 'beginner'));
});

test('pickCards：双方兴趣交集为空时，一方的单方面兴趣一张都不许出现（「不要并集」的回归）', () => {
  // A 只爱 anime、B 只爱 football → 交集为空。以前这里会退回**并集**，
  // 于是牌堆里既有 anime 又有 football；现在只该有通用主题。
  const cards = pickCards({ level: 'elementary', interests: [], count: 8, seed: 7 });
  const topics = topicsOf(cards);
  assert.equal(cards.length, 8);
  assert.ok(topics.every((topic) => GENERIC_TOPICS.includes(topic)), topics.join(', '));
  assert.ok(!topics.includes('anime') && !topics.includes('football'), '单方面兴趣一张都不许出现');
});

test('pickCards：单个兴趣自己就能连开四叠 8 张不重复（每档 8 张的意义）', () => {
  const seen = [];
  for (let round = 0; round < 4; round += 1) {
    const cards = pickCards({ level: 'beginner', interests: ['anime'], count: 8, seed: 5, seenCards: seen });
    assert.deepEqual(topicsOf(cards), ['anime'], '绝不掺无关主题');
    const ids = idsOf(cards);
    assert.deepEqual(ids.filter((id) => seen.includes(id)), [], `第 ${round} 叠与前几叠零交集`);
    seen.push(...ids);
  }
  assert.equal(new Set(seen).size, 32, '四叠下来正好把 anime 的 32 张用完');
});

test('pickCards：换一叠 —— 把上一叠传进 exclude，新一叠与它零交集', () => {
  const first = pickCards({ level: 'beginner', interests: ['anime', 'food'], count: 8, seed: 11 });
  const second = pickCards({
    level: 'beginner',
    interests: ['anime', 'food'],
    count: 8,
    seed: 11,
    seenCards: idsOf(first),
  });
  assert.equal(second.length, 8);
  assert.deepEqual(topicsOf(second).sort(), ['anime', 'food'], '换一叠也只在兴趣主题里换');
  assert.deepEqual(
    idsOf(second).filter((id) => idsOf(first).includes(id)),
    [],
    '「全新的 8 张」要真的全新：不该把看过的那 8 张再洗一遍',
  );
});

test('pickCards：窗口里还有没看过的兴趣卡时，难度不越窗口（exclude 不会顺手放宽难度）', () => {
  const first = pickCards({ level: 'elementary', interests: ['music'], count: 8, seed: 13 });
  assert.ok(first.every((card) => ['beginner', 'elementary'].includes(card.difficulty)));
  // 只排除一部分：窗口里还剩 4 张没看过 → 仍然只给窗口内的
  const again = pickCards({
    level: 'elementary',
    interests: ['music'],
    count: 4,
    seed: 13,
    seenCards: idsOf(first).slice(0, 4),
  });
  assert.equal(again.length, 4);
  assert.ok(
    again.every((card) => ['beginner', 'elementary'].includes(card.difficulty)),
    '窗口里还有新卡就不该越窗口',
  );
});

test('pickCards：同一个 seed 给同一叠（「双方看同一张」的前提）', () => {
  const seed = seedFrom('r-abc123:0');
  const mine = pickCards({ level: 'intermediate', interests: ['movies', 'travel'], count: 8, seed });
  const theirs = pickCards({ level: 'intermediate', interests: ['movies', 'travel'], count: 8, seed });
  assert.deepEqual(idsOf(mine), idsOf(theirs), '同房同 round 两侧必须拿到同一叠');
});

test('pickCards：不同 seed 给不同的一叠（每次开房 / 每换一叠都不一样）', () => {
  const a = idsOf(pickCards({ level: 'intermediate', interests: ['movies', 'travel'], count: 8, seed: seedFrom('r-a:0') }));
  const b = idsOf(pickCards({ level: 'intermediate', interests: ['movies', 'travel'], count: 8, seed: seedFrom('r-b:0') }));
  const c = idsOf(pickCards({ level: 'intermediate', interests: ['movies', 'travel'], count: 8, seed: seedFrom('r-a:1') }));
  assert.notDeepEqual(a, b, '换个房间就该换一叠');
  assert.notDeepEqual(a, c, '同一个房间换一叠也该换');
});

test('pickCards：seedFrom / seededRandom 是确定性的（后端靠它做同房同步）', () => {
  assert.equal(seedFrom('r-abc:0'), seedFrom('r-abc:0'));
  assert.notEqual(seedFrom('r-abc:0'), seedFrom('r-abc:1'));
  assert.notEqual(seedFrom('r-abc:0'), seedFrom('r-abd:0'));

  const first = seededRandom(7);
  const second = seededRandom(7);
  const third = seededRandom(8);
  const sequence = [first(), first(), first()];
  assert.deepEqual([second(), second(), second()], sequence, '同种子同序列');
  assert.notDeepEqual([third(), third(), third()], sequence, '异种子异序列');
  for (const value of sequence) {
    assert.ok(value >= 0 && value < 1, '取值落在 [0, 1)：' + value);
  }
});

test('pickCards：不传 seed / random 时退到真随机（现场不重复），但一样是合法的一叠', () => {
  const seen = new Set();
  for (let index = 0; index < 20; index += 1) {
    const cards = pickCards({ level: 'beginner', interests: ['gaming', 'hiking'], count: 8 });
    assert.equal(cards.length, 8);
    assert.deepEqual(topicsOf(cards).sort(), ['gaming', 'hiking']);
    seen.add(idsOf(cards).join(','));
  }
  assert.ok(seen.size > 1, '20 次里应当出现不止一种排法');
});

test('pickCards：注入 random 会被真的用上（测试与后端都用它钉住结果）', () => {
  const constant = () => 0;
  const makeAlternating = () => {
    let n = 0;
    return () => (n++ % 2 === 0 ? 0.1 : 0.9);
  };
  const args = { level: 'beginner', interests: ['anime', 'food'], count: 8 };

  // 抖动全相同 → 同分内部退回题库顺序（主题轮流发牌，所以是 anime/food 交替）
  const natural = [
    'anime-beginner-01',
    'food-beginner-01',
    'anime-beginner-02',
    'food-beginner-02',
    'anime-beginner-03',
    'food-beginner-03',
    'anime-beginner-04',
    'food-beginner-04',
  ];
  assert.deepEqual(idsOf(pickCards({ ...args, random: constant })), natural);

  const first = idsOf(pickCards({ ...args, random: makeAlternating() }));
  const second = idsOf(pickCards({ ...args, random: makeAlternating() }));
  assert.deepEqual(first, second, '同一串注入值给同一结果');
  assert.notDeepEqual(first, natural, '换一串注入值就换一种排法 —— 说明真的读了注入源');
});

test('pickCards：按主题轮流发牌，相邻两张不撞主题（只要还有别的主题可选）', () => {
  const cards = pickCards({ level: 'intermediate', count: 12, seed: 17 });
  for (let index = 1; index < cards.length; index += 1) {
    assert.notEqual(cards[index].topic, cards[index - 1].topic, `第 ${index} 张和第 ${index + 1} 张撞主题`);
  }
});

test('pickCards：聊过的主题排到后面，但一张都不少', () => {
  const fresh = pickCards({ level: 'beginner', count: 8, seed: 19 });
  const again = pickCards({ level: 'beginner', count: 8, seed: 19, usedTopics: [fresh[0].topic] });
  assert.notEqual(again[0].topic, fresh[0].topic, '聊过的主题不该再排第一');
  assert.equal(new Set(idsOf(again)).size, 8);

  // beginner 窗口里一共 118 张（13 个兴趣主题 × 8 + 7 个通用主题 × 2），
  // 但**不传兴趣**时选卡器只用通用主题那 14 张（交集为空的兜底口径）。
  const generalPool = TOPIC_DATABASE.filter(
    (card) => card.difficulty === 'beginner' && GENERIC_TOPICS.includes(card.topic),
  );
  assert.equal(generalPool.length, 14, '通用主题在 beginner 窗口里 7 × 2 张');
  const full = pickCards({ level: 'beginner', count: 14, seed: 19, usedTopics: [fresh[0].topic] });
  assert.equal(full.length, 14, '通用主题那 14 张一张不少（只排序、不筛掉）');
  assert.equal(new Set(idsOf(full)).size, 14);
});

test('pickCards：兴趣比「聊过」更优先（上次聊过动漫，这次仍然先给动漫）', () => {
  const cards = pickCards({ level: 'beginner', interests: ['anime'], usedTopics: ['anime'], count: 8, seed: 23 });
  assert.deepEqual(topicsOf(cards), ['anime']);
});

test('pickCards：要的比池子多时循环补齐，至少 1 张', () => {
  // 不传兴趣 → 只用通用主题，beginner 窗口里就是那 14 张
  const cards = pickCards({ level: 'beginner', count: 22, seed: 29 });
  assert.equal(cards.length, 22);
  assert.equal(new Set(idsOf(cards)).size, 14, '同一批 14 张循环');
  assert.deepEqual(idsOf(cards).slice(14), idsOf(cards).slice(0, 8), '第二轮与第一轮同一批、同一顺序');
  assert.equal(pickCards({ level: 'beginner', count: 0 }).length, 1);
  assert.equal(pickCards({ level: 'beginner', count: -5 }).length, 1);
});

test('pickCards：count 是 NaN 时返回空数组（调用方必须给数字）', () => {
  // Math.max(1, Math.round(NaN)) === NaN，循环一次都不跑。HTTP 层的 clampCount 会把
  // 缺省 / 非数字一律兜成 8，所以接口不可能把这个空数组发出去；这里只是把纯函数的口径钉住。
  assert.deepEqual(pickCards({ level: 'beginner', count: Number.NaN }), []);
});

test('pickCards：空数据库返回空数组，而不是循环出 undefined', () => {
  assert.deepEqual(pickCards({ database: [], count: 3 }), []);
});

test('pickCards：卡池里一张窗口内的卡都没有时，退回整池而不是空手', () => {
  const tiny = [{ id: 'x-1', topic: 'anime', difficulty: 'advanced', cantonese: 'a', mandarin: 'b', english: 'c', expressions: [] }];
  const cards = pickCards({ database: tiny, level: 'beginner', interests: ['anime'], count: 1, seed: 1 });
  assert.deepEqual(idsOf(cards), ['x-1']);
});

test('sharedInterests：取交集且保持我的顺序', () => {
  assert.deepEqual(sharedInterests(['anime', 'food', 'travel'], ['food', 'anime']), ['anime', 'food']);
  assert.deepEqual(sharedInterests([], ['food']), []);
});

/**
 * 匹配算法**同源**：后端 `src/lib/matching.js` 与前端 `src/lib/logic.js` 必须逐值一致。
 *
 * 为什么值得单独一个文件：排序与匹配度百分比是**服务端算完下发**的（契约 4.4 节），
 * 两边各有一份实现；口径一旦漂移，前端界面上的排序与后端返回的顺序就会不一样，
 * 而且这种 bug 不会报错、只会「看起来有点怪」。所以这里**把前端实现当预期值**，
 * 而不是把数字抄死在用例里——前端改了公式，这条用例立刻红。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as frontend from '../../frontend/src/lib/logic.js';
import * as backend from '../src/lib/matching.js';

/** 五类代表输入：空数组 / 只有 goal 命中 / 交集含 preferredTopics / 上限 4 / 一方为空。 */
const TAG_PAIRS = [
  { name: '空数组对空数组', my: [], peer: [] },
  { name: '只有 goal 命中', my: ['daily_conversation'], peer: ['food', 'daily_conversation'] },
  {
    name: '交集含 preferredTopics',
    my: ['movies', 'gaming', 'hong_kong_food'],
    peer: ['movies', 'gaming', 'travel'],
  },
  { name: '上限 4：标签再多也只按 4 算', my: ['a', 'b', 'c', 'd', 'e', 'f'], peer: ['a', 'b', 'c', 'd', 'e'] },
  { name: '一方为空', my: ['anime'], peer: [] },
  { name: '完全相同', my: ['anime', 'food'], peer: ['anime', 'food'] },
];

/** 互补相关的四组 wantToLearn，覆盖 yue / english / other / 空。 */
const WANT_TO_LEARN_CASES = [[], ['yue'], ['english'], ['other'], ['mandarin', 'english']];

const PEER_LANGUAGES = [['yue'], ['mandarin'], ['english'], ['other'], [], ['yue', 'english']];

const RANK_ENTRIES = [
  { matchScore: 58, nativeLanguages: ['yue'] },
  { matchScore: 54, nativeLanguage: 'mandarin' },
  { matchScore: 68, nativeLanguages: ['english', 'yue'] },
  { matchScore: 40, nativeLanguages: [] },
  { matchScore: 95, nativeLanguage: 'other' },
];

test('常量同源：互补加成与「学习者恒想练粤语」', () => {
  assert.equal(backend.COMPLEMENT_BOOST, frontend.COMPLEMENT_BOOST);
  assert.deepEqual(backend.LEARNER_WANT_TO_LEARN, frontend.LEARNER_WANT_TO_LEARN);
  assert.equal(backend.COMPLEMENT_BOOST, 8, '契约与前端都是 8：互补只值 8 分，压不过大分差');
});

test('matchScore：逐值等于前端（含空数组与上限 4）', () => {
  for (const { name, my, peer } of TAG_PAIRS) {
    assert.equal(
      backend.matchScore(my, peer),
      frontend.matchScore(my, peer),
      `matchScore(${JSON.stringify(my)}, ${JSON.stringify(peer)}) —— ${name}`,
    );
  }
});

test('matchScore：标签集合的组合扫一遍，两边都不许漂移', () => {
  const universe = ['yue', 'english', 'anime', 'food', 'daily_conversation'];
  const subsets = [[]];
  for (let i = 0; i < universe.length; i += 1) {
    subsets.push([universe[i]]);
    for (let j = i + 1; j < universe.length; j += 1) subsets.push([universe[i], universe[j]]);
  }

  let compared = 0;
  for (const mine of subsets) {
    for (const theirs of subsets) {
      assert.equal(backend.matchScore(mine, theirs), frontend.matchScore(mine, theirs));
      assert.deepEqual(backend.sharedTags(mine, theirs), frontend.sharedTags(mine, theirs));
      compared += 1;
    }
  }
  assert.equal(compared, subsets.length * subsets.length, '组合数对得上（防止循环被写空）');
  assert.ok(compared >= 100, '至少扫过上百组，这条用例才有意义：实际 ' + compared);
});

test('uniqueList：去重 + 丢掉非字符串与空串，与前端一致', () => {
  const cases = [
    [],
    ['a', 'a', 'b'],
    ['', 'a', null, 'b', undefined, 'a'],
    [1, 'a', 'b', 2],
    ['yue', 'yue', 'yue'],
  ];
  for (const values of cases) {
    assert.deepEqual(backend.uniqueList(values), frontend.uniqueList(values), JSON.stringify(values));
  }
});

test('complementLanguage / complementBoost：wantToLearn 覆盖 yue / english / other / 空', () => {
  for (const wantToLearn of WANT_TO_LEARN_CASES) {
    for (const peerNativeLanguages of PEER_LANGUAGES) {
      const label = `wantToLearn=${JSON.stringify(wantToLearn)} peer=${JSON.stringify(peerNativeLanguages)}`;
      assert.equal(backend.complementLanguage(wantToLearn, peerNativeLanguages), frontend.complementLanguage(wantToLearn, peerNativeLanguages), label);
      assert.equal(backend.complementBoost(wantToLearn, peerNativeLanguages), frontend.complementBoost(wantToLearn, peerNativeLanguages), label);
    }
  }
  assert.equal(backend.complementLanguage([], ['yue']), null, '没填回礼 = 谁都不命中');
  assert.equal(backend.complementBoost([], ['yue']), 0, '没填回礼 = 没有加成');
  assert.equal(backend.complementBoost(['english'], ['yue', 'english']), 8);
});

test('matchRank：匹配度 + 互补加成，逐值等于前端（含单片 nativeLanguage 写法）', () => {
  for (const viewer of WANT_TO_LEARN_CASES.map((wantToLearn) => ({ wantToLearn }))) {
    for (const entry of RANK_ENTRIES) {
      assert.equal(
        backend.matchRank(entry, viewer),
        frontend.matchRank(entry, viewer),
        `matchRank(${JSON.stringify(entry)}, ${JSON.stringify(viewer)})`,
      );
    }
  }
  // 互补只加 8 分：大分差排不动，小分差能翻转（这条是产品口径，不只是数学）
  const viewer = { wantToLearn: ['mandarin'] };
  assert.ok(backend.matchRank({ matchScore: 68, nativeLanguages: ['yue'] }, viewer) > backend.matchRank({ matchScore: 58, nativeLanguages: ['mandarin'] }, viewer), '14 分差距压不过');
  assert.ok(backend.matchRank({ matchScore: 58, nativeLanguages: ['mandarin'] }, viewer) > backend.matchRank({ matchScore: 54, nativeLanguages: ['yue'] }, viewer), '4 分差距被互补翻转');
});

test('withComplement：补上互补三个字段（后端专用的对外拼装）', () => {
  const hit = backend.withComplement({ peerId: 'ka-ho', matchScore: 60 }, ['english'], ['yue', 'english']);
  assert.equal(hit.complement, true);
  assert.equal(hit.complementLanguage, 'english');
  assert.equal(hit.peerId, 'ka-ho', '不丢原有字段');

  const miss = backend.withComplement({ peerId: 'siu-fung', matchScore: 60 }, [], ['yue']);
  assert.equal(miss.complement, false);
  assert.equal(miss.complementLanguage, null, '没命中也要有这两个字段（前端徽标靠它判断）');
});

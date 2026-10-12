/** 纯逻辑单测：匹配度、积分、成就、匿名化。 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACHIEVEMENT_RULES,
  COMPLEMENT_BOOST,
  LEARNER_WANT_TO_LEARN,
  buddyLevel,
  clampInterests,
  complementBoost,
  complementLanguage,
  coversAllOptions,
  formatDuration,
  intentForRole,
  matchRank,
  matchScore,
  newlyUnlocked,
  peerDisplayName,
  sharedTags,
  toggleInList,
  uniqueList,
  unlockedAchievements,
  visibleTags,
  xpFor,
} from '../src/lib/logic.js';

test('uniqueList 去重且保留顺序', () => {
  assert.deepEqual(uniqueList(['b', 'a', 'b', '', null, 'a']), ['b', 'a']);
});

test('sharedTags 只返回交集', () => {
  assert.deepEqual(sharedTags(['anime', 'food', 'travel'], ['food', 'movies']), ['food']);
  assert.deepEqual(sharedTags([], ['food']), []);
});

test('matchScore 对同样的输入稳定，且落在 40 ~ 95', () => {
  assert.equal(matchScore(['anime', 'food'], ['anime', 'food', 'travel']), 95);
  assert.equal(matchScore(['anime', 'food'], ['movies']), 40);
  assert.equal(matchScore([], []), 40);
  const score = matchScore(['anime', 'food', 'travel'], ['food', 'travel', 'gaming']);
  assert.equal(score, matchScore(['anime', 'food', 'travel'], ['food', 'travel', 'gaming']));
  assert.ok(score >= 40 && score <= 95, `分数越界：${score}`);
});

test('formatDuration 一分钟以内走特殊文案', () => {
  assert.deepEqual(formatDuration(45), { key: 'duration.lessThanMinute', minutes: 0 });
  assert.deepEqual(formatDuration(1080), { key: 'duration.minutes', minutes: 18 });
  assert.deepEqual(formatDuration(-5), { key: 'duration.lessThanMinute', minutes: 0 });
});

test('xpFor 每分钟 6 点、每张卡 5 点', () => {
  assert.equal(xpFor(1080, 4), 128);
  assert.equal(xpFor(60, 0), 6);
  assert.equal(xpFor(0, 0), 0);
});

test('buddyLevel 按帮助人数与时长成长', () => {
  assert.equal(buddyLevel({}), 'newcomer');
  assert.equal(buddyLevel({ peopleHelped: 3 }), 'helper');
  assert.equal(buddyLevel({ peopleHelped: 5 }), 'guide');
  assert.equal(buddyLevel({ totalMinutes: 200 }), 'ambassador');
});

test('unlockedAchievements 按身份分别判定', () => {
  const learnerStats = { conversations: 1, totalMinutes: 46, streakDays: 3, distinctTopics: 6 };
  assert.deepEqual(unlockedAchievements('learner', learnerStats), [
    'three_day_streak',
    'first_conversation',
    'cantonese_explorer',
    'culture_explorer',
  ]);
  assert.deepEqual(unlockedAchievements('buddy', { conversations: 1, totalMinutes: 64, peopleHelped: 1 }), [
    'first_buddy_session',
    'culture_ambassador',
  ]);
  assert.deepEqual(unlockedAchievements('learner', {}), []);
});

test('成就规则里每个 id 唯一，且角色只有 learner / buddy', () => {
  const ids = ACHIEVEMENT_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, '成就 id 重复');
  for (const rule of ACHIEVEMENT_RULES) {
    assert.ok(['learner', 'buddy', 'all'].includes(rule.role), `未知角色：${rule.role}`);
  }
});

test('newlyUnlocked 只返回新增的成就', () => {
  assert.deepEqual(newlyUnlocked(['a', 'b'], ['a', 'b', 'c']), ['c']);
  assert.deepEqual(newlyUnlocked(undefined, ['a']), ['a']);
  assert.deepEqual(newlyUnlocked(['a'], ['a']), []);
});

test('匿名时显示名被强制覆盖，不信任数据源', () => {
  assert.equal(peerDisplayName({ anonymous: true, userId: 'learner-demo-01' }, '匿名伙伴'), '匿名伙伴');
  assert.equal(peerDisplayName({ anonymous: false, userId: 'mingzhu' }, '匿名伙伴'), 'mingzhu');
  assert.equal(peerDisplayName(null, '匿名伙伴'), '匿名伙伴');
});

test('visibleTags 遵守公开范围开关', () => {
  const entry = { interests: ['anime', 'food'], topics: ['movies'] };
  assert.deepEqual(visibleTags(entry, { interests: false }), ['movies']);
  assert.deepEqual(visibleTags(entry, {}), ['anime', 'food', 'movies']);
});

test('clampInterests 去重并截断到上限', () => {
  assert.deepEqual(clampInterests(['a', 'b', 'a', 'c'], 2), ['a', 'b']);
});

test('toggleInList 加一个 / 去掉一个，不改原数组', () => {
  const base = ['anime', 'food'];
  assert.deepEqual(toggleInList(base, 'travel'), ['anime', 'food', 'travel']);
  assert.deepEqual(toggleInList(base, 'anime'), ['food']);
  assert.deepEqual(base, ['anime', 'food'], '原数组不该被改');
  assert.deepEqual(toggleInList(null, 'anime'), ['anime']);
});

test('coversAllOptions：「全选」只认全选，空选与半选都不算', () => {
  const all = ['a', 'b', 'c'];
  assert.equal(coversAllOptions(['a', 'b', 'c'], all), true);
  assert.equal(coversAllOptions(['c', 'a', 'b'], all), true, '顺序不影响判定');
  assert.equal(coversAllOptions(['a', 'b', 'c', 'd'], all), true, '多选出来的不算「没覆盖」');
  assert.equal(coversAllOptions(['a', 'b'], all), false);
  assert.equal(coversAllOptions([], all), false, '一个都没选不等于「都行」');
  assert.equal(coversAllOptions(['a'], []), false, '词表为空时不该判成全选');
});

test('intentForRole：教 / 学 标签由身份派生，认不出就不贴标签', () => {
  assert.equal(intentForRole('buddy'), 'teach', '粤语母语者 = 教粤语');
  assert.equal(intentForRole('learner'), 'learn', '粤语学习者 = 学粤语');
  assert.equal(intentForRole('guest'), null, '不认识的取值不硬猜，宁可不显示');
  assert.equal(intentForRole(''), null);
  assert.equal(intentForRole(), null);
});

/** 「语言交换」的三条硬约束：只加权不筛选、权重 8、只在母语者视角生效。 */

test('complementLanguage：只认交集，「没填」不等于「什么都想练」', () => {
  assert.equal(complementLanguage(['mandarin'], ['yue', 'mandarin']), 'mandarin');
  // 真实调用里对端只给一门母语（`uniqueList([view.nativeLanguage])`），多对多只是防御性地不抛错
  const multi = complementLanguage(['english', 'mandarin'], ['mandarin', 'english']);
  assert.ok(multi === 'english' || multi === 'mandarin', '多对多时返回交集里的一个');
  assert.equal(multi, complementLanguage(['english', 'mandarin'], ['mandarin', 'english']), '同一输入结果稳定');
  assert.equal(complementLanguage([], ['mandarin']), null, '空数组不是通配符');
  assert.equal(complementLanguage(['mandarin'], []), null);
  assert.equal(complementLanguage(['mandarin'], ['yue', 'other']), null, '取值不相交就是没命中，不报错');
  assert.equal(complementLanguage(null, null), null);
  assert.equal(complementLanguage(['mandarin', 'mandarin'], ['mandarin']), 'mandarin', '重复项不影响判定');
});

test('complementBoost：命中给 COMPLEMENT_BOOST(8)，否则 0', () => {
  assert.equal(COMPLEMENT_BOOST, 8, '权重取 8 是决策，不是随手写的常数（见 docs/07 第 9.4 节）');
  assert.equal(complementBoost(['mandarin'], ['mandarin']), 8);
  assert.equal(complementBoost(['english'], ['yue', 'english']), 8);
  assert.equal(complementBoost(['english'], ['mandarin']), 0);
  assert.equal(complementBoost([], ['mandarin']), 0);
  assert.equal(complementBoost(['mandarin'], undefined), 0);
});

test('matchRank：排序键 = 匹配度 + 互补加成，单数 / 复数母语都认', () => {
  const viewer = { wantToLearn: ['mandarin'] };
  assert.equal(matchRank({ matchScore: 80, nativeLanguage: 'mandarin' }, viewer), 88);
  assert.equal(matchRank({ matchScore: 80, nativeLanguages: ['yue', 'mandarin'] }, viewer), 88);
  assert.equal(matchRank({ matchScore: 80, nativeLanguage: 'english' }, viewer), 80);
  assert.equal(matchRank({ matchScore: 80 }, viewer), 80, '没有母语字段时只按匹配度，不抛错');
  assert.equal(matchRank({ nativeLanguage: 'mandarin' }, viewer), 8, '缺 matchScore 时按 0 起算');
  assert.equal(matchRank(null, viewer), 0);
  assert.equal(matchRank({ matchScore: 80, nativeLanguage: 'mandarin' }, {}), 80, '没人要学时没有加成');
});

test('学习者视角：wantToLearn 恒为粤语，每位粤语母语者拿到同样的加成', () => {
  assert.deepEqual(LEARNER_WANT_TO_LEARN, ['yue']);
  const viewer = { wantToLearn: LEARNER_WANT_TO_LEARN };
  const scores = [68, 40, 40];
  const ranks = scores.map((matchScore) => matchRank({ matchScore, nativeLanguage: 'yue' }, viewer));
  assert.deepEqual(ranks.map((rank) => rank - COMPLEMENT_BOOST), scores, '加成相等 ⇒ 排序结果与纯 matchScore 完全一致');
  assert.deepEqual([...ranks].sort((a, b) => b - a), ranks, '降序排列仍然成立');
});

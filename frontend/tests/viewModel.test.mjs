import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACHIEVEMENT_CATALOG } from '../src/data/achievements.js';
import { UI_STRINGS, createTranslator } from '../src/i18n/i18n.js';
import { labelOf as labelOfReal } from '../src/data/labels.js';
import {
  achievementStates,
  complementProps,
  complementView,
  deckPosition,
  deckProgress,
  elapsedSeconds,
  formatClock,
  formatShortDateTime,
  historyRows,
  homePrimaryAction,
  homeTiles,
  effectiveMatchCriteria,
  matchCriteriaSummary,
  onboardingProgress,
  privacyPreview,
  resolveTile,
  roomStatusKey,
  summaryModel,
} from '../src/lib/viewModel.js';

const labelOf = (group, value) => group + ':' + value;
const fakeT = (key, vars) => (vars ? key + JSON.stringify(vars) : key);

test('formatClock：计时器文本', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9), '0:09');
  assert.equal(formatClock(754), '12:34');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(undefined), '0:00');
  assert.equal(formatClock(3599), '59:59');
});

test('formatShortDateTime：可读的日期，非法输入给空串', () => {
  assert.equal(formatShortDateTime('2026-09-21T21:10:00+08:00'), '09-21 21:10');
  assert.equal(formatShortDateTime('not-a-date'), '');
});

test('elapsedSeconds：排队时长', () => {
  assert.equal(elapsedSeconds(null), 0);
  assert.equal(elapsedSeconds(1000, 4000), 3);
  assert.equal(elapsedSeconds(5000, 4000), 0);
});

test('onboardingProgress：1 / 3 这类标记', () => {
  assert.deepEqual(onboardingProgress(1), { current: 1, total: 3, label: '1 / 3', ratio: 1 / 3 });
  assert.equal(onboardingProgress(9).current, 3);
  assert.equal(onboardingProgress(0).current, 1);
});

test('homeTiles：两种身份看到不同的数字', () => {
  const stats = { conversations: 2, streakDays: 3, totalMinutes: 46, peopleHelped: 0 };
  const learner = homeTiles({ role: 'learner', stats, progress: { practiceMinutesThisWeek: 46 }, achievementCount: 2 });
  assert.deepEqual(learner.map((tile) => tile.id), ['practice', 'conversations', 'streak', 'achievements']);
  assert.equal(learner[0].value, '46');
  assert.equal(learner[0].unit, 'minute');

  const buddy = homeTiles({ role: 'buddy', stats, progress: {}, achievementCount: 1 });
  assert.deepEqual(buddy.map((tile) => tile.id), ['hours', 'people', 'level', 'achievements']);
  assert.equal(buddy[2].labelGroup, 'buddyLevels');
  assert.equal(buddy[2].labelValue, 'helper'); // 46 分钟 = 帮过新手（newcomer -> helper）
});

test('resolveTile：时长与枚举值都能落到文案', () => {
  const tile = resolveTile({ id: 'a', labelKey: 'home.practiceTime', value: '46', unit: 'minute' }, { t: fakeT, labelOf });
  assert.equal(tile.label, 'home.practiceTime');
  assert.equal(tile.value, 'duration.minutes{"minutes":"46"}');

  const levelTile = resolveTile({ id: 'b', labelKey: 'home.buddyLevel', labelGroup: 'buddyLevels', labelValue: 'guide' }, { t: fakeT, labelOf });
  assert.equal(levelTile.value, 'buddyLevels:guide');

  const dayTile = resolveTile({ id: 'c', labelKey: 'home.streak', value: '3', unit: 'day' }, { t: fakeT, labelOf });
  assert.equal(dayTile.value, 'duration.days{"days":"3"}');
});

test('homePrimaryAction：学习者与母语者文案不同，等待人数只在母语者侧出现', () => {
  const learner = homePrimaryAction({ role: 'learner', waitingCount: 4 });
  assert.equal(learner.headlineKey, 'home.learnerHeadline');
  assert.equal(learner.badge, null);
  assert.equal(learner.to, '/match');

  const buddy = homePrimaryAction({ role: 'buddy', waitingCount: 4 });
  assert.equal(buddy.headlineKey, 'home.buddyHeadline');
  assert.deepEqual(buddy.badge, { key: 'home.buddyWaiting', vars: { count: 4 } });
  assert.equal(homePrimaryAction({ role: 'buddy' }).badge, null);
});

test('achievementStates：按身份过滤并按规则判定解锁', () => {
  const learner = achievementStates(ACHIEVEMENT_CATALOG, 'learner', { conversations: 1, totalMinutes: 46 });
  assert.equal(learner.length, 10);
  assert.equal(learner.find((item) => item.id === 'first_conversation').unlocked, true);
  assert.equal(learner.find((item) => item.id === 'cantonese_explorer').unlocked, true);
  assert.equal(learner.find((item) => item.id === 'seven_day_streak').unlocked, false);
  assert.ok(learner.every((item) => item.hint.length > 0));

  const buddy = achievementStates(ACHIEVEMENT_CATALOG, 'buddy', { conversations: 1, peopleHelped: 1 });
  assert.equal(buddy.length, 10);
  assert.deepEqual(buddy.slice(0, 4).map((item) => item.id), ['first_buddy_session', 'helpful_local', 'culture_ambassador', 'conversation_hero']);
  assert.equal(buddy.find((item) => item.id === 'first_buddy_session').unlocked, true);
  assert.equal(buddy.find((item) => item.id === 'helpful_local').unlocked, false);
});

test('summaryModel：同一份时长，两种身份两套文案；太短不发徽章', () => {
  const learner = summaryModel({ role: 'learner', durationSec: 720, cardsUsed: 4, xpEarned: 92, unlocked: ['first_conversation'] });
  assert.equal(learner.headlineKey, 'summary.great');
  assert.equal(learner.durationKey, 'duration.minutes');
  assert.deepEqual(learner.durationVars, { minutes: 12 });
  assert.deepEqual(learner.unlocked, ['first_conversation']);
  assert.equal(learner.showBadges, true);

  const buddy = summaryModel({ role: 'buddy', durationSec: 720, cardsUsed: 2, xpEarned: 82, unlocked: [], });
  assert.equal(buddy.headlineKey, 'summary.buddyHeadline');
  assert.equal(buddy.cardsUsed, 2);

  const tooShort = summaryModel({ role: 'learner', durationSec: 20, cardsUsed: 1, xpEarned: 7, unlocked: ['first_conversation'] });
  assert.equal(tooShort.showBadges, false);
  assert.deepEqual(tooShort.unlocked, []);
  assert.equal(tooShort.durationKey, 'duration.lessThanMinute');
});

test('historyRows：倒序、时长文案、伙伴状态由 buddies + requests 推导', () => {
  const rows = historyRows(
    [
      { sessionId: 'a', peerId: 'wai-ling', startedAt: '2026-09-19T20:30:00+08:00', durationSec: 720, topics: ['travel'] },
      { sessionId: 'b', peerId: 'ka-ho', startedAt: '2026-09-21T21:10:00+08:00', durationSec: 40, topics: ['anime', 'anime'] },
    ],
    {
      buddies: [{ peerId: 'ka-ho' }],
      requests: [{ peerId: 'wai-ling', direction: 'incoming', status: 'pending' }],
    },
  );
  assert.deepEqual(rows.map((row) => row.sessionId), ['b', 'a']);
  assert.equal(rows[0].durationKey, 'duration.lessThanMinute');
  assert.equal(rows[1].durationVars.minutes, 12);
  assert.deepEqual(rows[0].topics, ['anime']);
  assert.equal(rows[0].buddyState, 'buddy');
  assert.equal(rows[1].buddyState, 'pending-in');
  assert.equal(rows[1].buddyRequest.peerId, 'wai-ling');
});

test('historyRows：只看我的伙伴、没有伙伴关系时是 none、空输入不炸', () => {
  const entries = [
    { sessionId: 'a', peerId: 'stranger', startedAt: '2026-09-19T20:30:00+08:00', durationSec: 720 },
    { sessionId: 'b', peerId: 'ka-ho', startedAt: '2026-09-21T21:10:00+08:00', durationSec: 1080 },
  ];
  assert.deepEqual(historyRows(entries, { buddies: [{ peerId: 'ka-ho' }] }).map((row) => row.buddyState), [
    'buddy',
    'none',
  ]);
  assert.deepEqual(
    historyRows(entries, { buddies: [{ peerId: 'ka-ho' }], buddyOnly: true }).map((row) => row.sessionId),
    ['b'],
  );
  assert.deepEqual(historyRows(null), []);
});

test('deckPosition：第几张 / 共几张，空牌堆要能识别', () => {
  assert.deepEqual(deckPosition(0, 8), { empty: false, index: 1, total: 8, vars: { index: 1, total: 8 } });
  assert.equal(deckPosition(7, 8).index, 8);
  assert.equal(deckPosition(99, 8).index, 8);
  assert.equal(deckPosition(0, 0).empty, true);
});

test('deckProgress：到头置灰、看过几张、进度条百分比', () => {
  const start = deckProgress({ index: 0, total: 4, seen: ['a'] });
  assert.equal(start.atStart, true);
  assert.equal(start.atEnd, false);
  assert.equal(start.visited, 1);
  assert.equal(start.percent, 25);
  assert.deepEqual(start.vars, { done: 1, total: 4 });

  const end = deckProgress({ index: 3, total: 4, seen: ['a', 'b', 'c', 'd'] });
  assert.equal(end.atStart, false);
  assert.equal(end.atEnd, true);
  assert.equal(end.percent, 100);
});

test('deckProgress：来回滑不该把进度刷上去（看过的卡按 id 去重）', () => {
  assert.equal(deckProgress({ index: 1, total: 4, seen: ['a', 'a', 'a', 'b'] }).visited, 2);
  assert.equal(deckProgress({ index: 1, total: 4, seen: ['a', 'a', 'a', 'b'] }).percent, 50);
});

test('deckProgress：空牌堆与缺参数都不炸', () => {
  const empty = deckProgress({ index: 0, total: 0, seen: [] });
  assert.equal(empty.empty, true);
  assert.equal(empty.atEnd, true);
  assert.equal(empty.percent, 0);
  assert.deepEqual(deckProgress().vars, { done: 0, total: 0 });
  assert.deepEqual(deckProgress({ index: 99, total: 2, seen: ['a', 'b', 'c'] }).vars, { done: 2, total: 2 });
});

test('roomStatusKey：连接中 / 通话中 / 旁听 / 模拟 / 对方离开', () => {
  assert.equal(roomStatusKey({ status: 'connecting', mode: 'local', hasMic: true }), 'room.connecting');
  assert.equal(roomStatusKey({ status: 'live', mode: 'local', hasMic: true }), 'room.live');
  assert.equal(roomStatusKey({ status: 'degraded', mode: 'local', hasMic: true }), 'room.degraded');
  assert.equal(roomStatusKey({ status: 'live', mode: 'local', hasMic: false }), 'room.listenOnly');
  assert.equal(roomStatusKey({ status: 'live', mode: 'sim', hasMic: true }), 'room.simulated');
  assert.equal(roomStatusKey({ status: 'ended', mode: 'sim', hasMic: true, peerLeft: true }), 'room.peerLeft');
});

test('effectiveMatchCriteria：设置过就用设置过的，没设置过回落到资料里的兴趣', () => {
  const profile = { interests: ['anime', 'food'] };
  assert.deepEqual(effectiveMatchCriteria(profile, null), ['anime', 'food']);
  assert.deepEqual(effectiveMatchCriteria(profile, ['travel']), ['travel']);
  assert.deepEqual(effectiveMatchCriteria(profile, []), [], '自定义成空数组是「一个都没选」，不该又回落到资料');
  assert.deepEqual(effectiveMatchCriteria({}, null), []);
});

test('matchCriteriaSummary：把水平与兴趣拼成一句', () => {
  const summary = matchCriteriaSummary({ cantoneseLevel: 'beginner', interests: ['anime', 'food', 'travel', 'movies'] }, { labelOf });
  assert.equal(summary, 'levels:beginner、interests:anime、interests:food、interests:travel');
  assert.equal(matchCriteriaSummary({}, { labelOf }), '');

  // 自定义条件：覆盖掉资料里的兴趣，但水平仍然照旧显示
  assert.equal(
    matchCriteriaSummary({ cantoneseLevel: 'beginner', interests: ['anime'] }, { labelOf, criteria: ['travel', 'music'] }),
    'levels:beginner、interests:travel、interests:music',
  );
  assert.equal(matchCriteriaSummary({ cantoneseLevel: 'beginner', interests: ['anime'] }, { labelOf, criteria: [] }), 'levels:beginner');

  // 自定义条件把全部主题都勾上 = 「随便聊」：用一句话代替罗列十几个标签
  const allInterests = ['anime', 'food', 'travel'];
  assert.equal(
    matchCriteriaSummary(
      { cantoneseLevel: 'beginner', interests: ['anime'] },
      { labelOf, criteria: ['food', 'travel', 'anime'], anyLabel: '随便聊', allInterests },
    ),
    'levels:beginner、随便聊',
  );
  // 没传 anyLabel / allInterests 时仍然老老实实罗列，行为跟以前一致
  assert.equal(
    matchCriteriaSummary({ interests: [] }, { labelOf, criteria: ['food', 'travel', 'anime'] }),
    'interests:food、interests:travel、interests:anime',
  );
});

test('privacyPreview：关掉的项直接不出现，全关时给兜底', () => {
  const profile = { cantoneseLevel: 'beginner', identity: 'exchange_student', interests: ['anime'], nativeLanguage: 'english' };
  const open = privacyPreview(profile, {}, { labelOf, anonymous: false });
  assert.equal(open.rows.length, 4);
  assert.equal(open.empty, false);
  assert.equal(open.anonymous, false);

  const closed = privacyPreview(profile, { level: false, identity: false, interests: false, nativeLanguage: false }, { labelOf });
  assert.deepEqual(closed.rows, []);
  assert.equal(closed.empty, true);
});

test('viewModel 返回的每个 key 都真实存在于语言包里（避免页面上出现裸 key）', () => {
  const seen = new Set();
  const collect = (value) => {
    if (typeof value === 'string' && /^[a-z]+(\.[a-zA-Z0-9]+)+$/.test(value)) seen.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(homeTiles({ role: 'learner', stats: { conversations: 1 }, progress: { practiceMinutesThisWeek: 5 }, achievementCount: 1 }));
  collect(homeTiles({ role: 'buddy', stats: { totalMinutes: 70 }, progress: {}, achievementCount: 1 }));
  collect(homePrimaryAction({ role: 'buddy', waitingCount: 2 }));
  collect(homePrimaryAction({ role: 'learner' }));
  collect(summaryModel({ role: 'buddy', durationSec: 900, cardsUsed: 3, xpEarned: 105, unlocked: ['first_buddy_session'] }));
  collect(['room.degraded', 'room.gesture', 'state.roomLost', 'dev.autoLevel', 'dev.mode.sim']);
  for (const status of [
    { status: 'connecting', mode: 'local', hasMic: true },
    { status: 'live', mode: 'local', hasMic: true },
    { status: 'degraded', mode: 'local', hasMic: true },
    { status: 'live', mode: 'local', hasMic: false },
    { status: 'live', mode: 'sim', hasMic: true },
    { status: 'ended', mode: 'sim', hasMic: true, peerLeft: true },
  ]) {
    seen.add(roomStatusKey(status));
  }
  assert.ok(seen.size >= 12, '应该收集到足够多的 key，实际 ' + seen.size);
  for (const key of seen) {
    assert.ok(UI_STRINGS[key], '语言包里缺少 ' + key);
  }
});

test('complementView：没命中整块不显示，命中才给徽标 + 调用方指定的模板', () => {
  const t = createTranslator('zh-Hans');
  const label = (group, value) => labelOfReal(group, value, 'zh-Hans');
  assert.equal(complementView({ complement: false }, { t, label, noteKey: 'match.complementPeerNative' }), null);
  assert.equal(complementView(null, { t, label, noteKey: 'match.complementPeerNative' }), null, '缺字段时不炸');

  // 母语者看学习者：说清「TA 的母语是 X」——这枚徽标是排序变化在台上唯一的可见证据
  const peer = { complement: true, complementLanguage: 'mandarin' };
  assert.deepEqual(complementView(peer, { t, label, noteKey: 'match.complementPeerNative' }), {
    label: '语言互补',
    note: 'TA 的母语是普通话',
  });
  // 学习者看母语者：同一个位置换一句模板（TA 也想练 X），徽标本身不变
  assert.deepEqual(complementView(peer, { t, label, noteKey: 'home.complementWants' }), {
    label: '语言互补',
    note: 'TA 也想练普通话',
  });
  assert.deepEqual(complementView({ complement: true }, { t, label, noteKey: 'home.complementWants' }), { label: '语言互补', note: null }, '没给出具体语言时只留徽标');

  // 组件友好形态：就是这两个 prop，没命中时都是 null（组件据此整行不画）
  assert.deepEqual(complementProps(peer, { t, label, noteKey: 'home.complementWants' }), { complementLabel: '语言互补', complementNote: 'TA 也想练普通话' });
  assert.deepEqual(complementProps({ complement: false }, { t, label, noteKey: 'home.complementWants' }), { complementLabel: null, complementNote: null });
});

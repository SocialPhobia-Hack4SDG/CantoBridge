/**
 * 积分 / 成就 / 等级：与前端 `frontend/src/lib/logic.js` **逐行同源**。
 *
 * 契约 4.5 节：「积分规则与前端纯函数保持一致：每分钟 6 点 + 每张卡 5 点（`xpFor`）」。
 * 一致性由 `tests/scoring.test.mjs` 钉住：同一组输入下两边必须给出同一个数。
 */

/** 每分钟 6 点 + 每张卡 5 点。四舍五入到整数（弱网重试时同一份结算要一模一样）。 */
export function xpFor(durationSec, cardsUsed) {
  const seconds = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const cards = Number.isFinite(cardsUsed) ? Math.max(0, cardsUsed) : 0;
  return Math.round((seconds / 60) * 6) + cards * 5;
}

/** 等级（契约 4.7 节的 `buddyLevel`）：看「帮助过多少人」与「累计时长」。 */
export function buddyLevel({ totalMinutes = 0, peopleHelped = 0 } = {}) {
  if (peopleHelped >= 10 || totalMinutes >= 180) return 'ambassador';
  if (peopleHelped >= 5 || totalMinutes >= 90) return 'guide';
  if (peopleHelped >= 2 || totalMinutes >= 30) return 'helper';
  return 'newcomer';
}

/** 成就规则（与前端 `ACHIEVEMENT_RULES` 一一对应；id 就是契约 4.9 成就表的 id）。 */
export const ACHIEVEMENT_RULES = [
  { id: 'conversation_starter', role: 'all', test: (s) => s.conversations >= 5 },
  { id: 'conversation_regular', role: 'all', test: (s) => s.conversations >= 10 },
  { id: 'conversation_veteran', role: 'all', test: (s) => s.conversations >= 25 },
  { id: 'three_day_streak', role: 'all', test: (s) => s.streakDays >= 3 },
  { id: 'bridge_builder', role: 'all', test: (s) => s.totalMinutes >= 180 },
  { id: 'topic_adventurer', role: 'all', test: (s) => s.distinctTopics >= 10 },
  { id: 'first_conversation', role: 'learner', test: (s) => s.conversations >= 1 },
  { id: 'cantonese_explorer', role: 'learner', test: (s) => s.totalMinutes >= 30 },
  { id: 'seven_day_streak', role: 'learner', test: (s) => s.streakDays >= 7 },
  { id: 'culture_explorer', role: 'learner', test: (s) => s.distinctTopics >= 5 },
  { id: 'first_buddy_session', role: 'buddy', test: (s) => s.conversations >= 1 },
  { id: 'helpful_local', role: 'buddy', test: (s) => s.peopleHelped >= 3 },
  { id: 'culture_ambassador', role: 'buddy', test: (s) => s.totalMinutes >= 60 },
  { id: 'conversation_hero', role: 'buddy', test: (s) => s.peopleHelped >= 10 },
];

const ACHIEVEMENT_IDS = ACHIEVEMENT_RULES.map((rule) => rule.id);

/** 某个身份此刻应当解锁的成就 id（不区分「刚刚」解锁）。 */
export function unlockedAchievements(role, stats = {}) {
  const normalized = {
    conversations: 0,
    totalMinutes: 0,
    streakDays: 0,
    distinctTopics: 0,
    peopleHelped: 0,
    ...stats,
  };
  return ACHIEVEMENT_RULES.filter((rule) => (rule.role === role || rule.role === 'all') && rule.test(normalized)).map(
    (rule) => rule.id,
  );
}

/** 本次会话**新**解锁的成就 = 结算后应解锁 - 结算前已解锁（契约：`unlocked` 只含新增）。 */
export function newlyUnlocked(before, after) {
  const previous = new Set(before ?? []);
  return (after ?? []).filter((id) => !previous.has(id));
}

export { ACHIEVEMENT_IDS };

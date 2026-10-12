/**
 * 成就表。
 *
 * 这个文件以前叫 `fixtures.js`，里面还装着 4 位假学习者、3 位假母语者、四组假榜单、
 * 一份假进度和一份假伙伴关系。**全部删掉了**，理由只有一条：列表里必须只有真实注册的人。
 *
 * 为什么非删不可：那些假人没有对应的设备在等。对面点了「开始」前端照样成房、
 * 照样跳进房间页，但另一台设备永远收不到 `match:matched` —— 现场表现就是
 * 「两台设备连不上」，而且当场看不出来（详见后端 `src/store/seed.js` 的说明）。
 *
 * 剩下这一个表是**展示用的定义**，不是数据：它只有 id / 身份 / 提示文案，
 * 「解锁了没有」一律由 `lib/logic.js` 按真实进度现算（与后端 `lib/scoring.js` 同源）。
 */

/** 成就定义：id 与 docs/05 第 9 节一致，判定规则在 src/lib/logic.js。 */
export const ACHIEVEMENT_CATALOG = [
  { id: 'conversation_starter', role: 'all', hint: '完成 5 次对话' },
  { id: 'conversation_regular', role: 'all', hint: '完成 10 次对话' },
  { id: 'conversation_veteran', role: 'all', hint: '完成 25 次对话' },
  { id: 'three_day_streak', role: 'all', hint: '连续 3 天练习' },
  { id: 'bridge_builder', role: 'all', hint: '累计对话满 180 分钟' },
  { id: 'topic_adventurer', role: 'all', hint: '聊过 10 个不同话题' },
  { id: 'first_conversation', role: 'learner', hint: '完成第一次对话' },
  { id: 'cantonese_explorer', role: 'learner', hint: '累计练习满 30 分钟' },
  { id: 'seven_day_streak', role: 'learner', hint: '连续 7 天练习' },
  { id: 'culture_explorer', role: 'learner', hint: '聊过 5 个不同话题' },
  { id: 'first_buddy_session', role: 'buddy', hint: '完成第一次搭档对话' },
  { id: 'helpful_local', role: 'buddy', hint: '帮助过 3 位学习者' },
  { id: 'culture_ambassador', role: 'buddy', hint: '累计对话满 60 分钟' },
  { id: 'conversation_hero', role: 'buddy', hint: '帮助过 10 位学习者' },
];

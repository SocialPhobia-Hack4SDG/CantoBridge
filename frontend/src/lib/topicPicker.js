/**
 * 话题卡选卡逻辑（Mock AI Service 的核心）。
 * 输入：学习者粤语水平 + 双方兴趣 + 已经聊过 / 已经看过的卡；输出：一叠可滑的卡。
 * 未来接真实 GenAI 时，只要保持同样的入参与出参结构即可替换。
 *
 * 四条口径（2026-10-04 起，2026-10-11 收紧兜底）：
 *
 *   1. **只从双方兴趣的主题里出卡**。兴趣主题的卡够填满一叠时，一张无关的卡都不掺；
 *      不够就先在兴趣主题里放宽难度（同一主题的四档都能用）。
 *   2. **兜底只用通用主题**（`GENERAL_TOPICS` 那 7 个「谁都能聊」的题）。双方兴趣
 *      **交集为空**时（一个都不重合，或者填了卡池里没有的自定义标签）走这条——
 *      绝不退回「两侧兴趣并集」：并集会把只有一方感兴趣的主题发出去，现场就是
 *      「这张卡跟我不相干」（2026-10-11 用户明确否掉并集）。通用主题都凑不满时
 *      才退到整池，那只是给自造小卡池的测试留的最后一格。
 *   3. **随机洗牌**。同优先级内部随机排列，所以每次开房、每换一叠看到的卡都不一样。
 *      洗牌源可以注入：后端用 `roomId + 第几叠` 派生 `seed`，于是
 *      **同一个房间的两侧拿到同一叠**，不同房间 / 不同一叠互不相同（`seededRandom`）。
 *   4. 优先级（高 → 低）：兴趣命中 > 本次会话没看过 > 历史上没聊过 > 离本人档位越近越好。
 *      四档是「分层」而不是「打分」：先按第一档分组，同组内才看第二档，以此类推。
 */

import { GENERAL_TOPICS, TOPIC_DATABASE } from '../data/topicDatabase.js';

const DIFFICULTY_ORDER = ['beginner', 'elementary', 'intermediate', 'advanced'];

/** 水平到难度的窗口：低水平只给低难度，高水平允许相邻档。 */
export function difficultyWindow(level) {
  switch (level) {
    case 'beginner':
      return ['beginner'];
    case 'elementary':
      return ['beginner', 'elementary'];
    case 'intermediate':
      return ['elementary', 'intermediate'];
    case 'advanced':
      return ['intermediate', 'advanced'];
    default:
      return ['beginner', 'elementary'];
  }
}

/**
 * 难度离本人档位有多远（0 = 正好是自己的档）。
 * 用在「兴趣主题里放宽难度」那一档：宁可给 elementary，也不要跳到 advanced。
 */
export function difficultyDistance(difficulty, level) {
  const mine = DIFFICULTY_ORDER.indexOf(level);
  const theirs = DIFFICULTY_ORDER.indexOf(difficulty);
  if (mine < 0 || theirs < 0) return DIFFICULTY_ORDER.length;
  return Math.abs(theirs - mine);
}

/**
 * mulberry32：同一个种子给同一串伪随机数。
 * 为什么不用 `Math.random`：一叠卡要**同时**满足「每次不一样」与
 * 「同一个房间的两侧看到同一张」——只有可复现的洗牌才能两头都占。
 */
export function seededRandom(seed) {
  let state = Math.floor(Number(seed)) >>> 0 || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把「房间号 + 第几叠」这样的字符串折成一个 32 位种子（FNV-1a）。 */
export function seedFrom(text) {
  let hash = 2166136261;
  for (const ch of String(text ?? '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 四个优先级的比较（小者优先）：[兴趣命中, 看过没有, 聊过没有, 是不是本人档位]。 */
function compareRank(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * 选卡。
 *
 * `random` / `seed` 二选一：给了 `random` 就用它，给了 `seed` 就用 `seededRandom(seed)`，
 * 两个都不给就退到 `Math.random`（真随机）。**测试与后端都要显式给**，
 * 否则「同一个房间两侧同一叠」这条就保不住了。
 *
 * 排完之后**按主题轮流发牌**（每个主题先发第一张，一圈发完再回头发第二张），
 * 所以一叠卡里各主题是轮着来的，不会开头几张全是同一个主题。
 * `count` 大于候选数时循环补齐（前端 `TopicCardStack` 一次预取一叠，需要固定张数）。
 */
export function pickCards({
  database = TOPIC_DATABASE,
  level = 'beginner',
  interests = [],
  usedTopics = [],
  seenCards = [],
  count = 8,
  seed = null,
  random = null,
} = {}) {
  const next =
    typeof random === 'function'
      ? random
      : seed === null || seed === undefined
        ? Math.random
        : seededRandom(seed);

  const all = database.slice();
  if (all.length === 0) return [];

  const window = difficultyWindow(level);
  const inWindow = all.filter((card) => window.includes(card.difficulty));
  // 卡池里一张窗口内的卡都没有（自造的小卡池）时，别返回空——退回整池
  const windowPool = inWindow.length > 0 ? inWindow : all;

  const interestSet = new Set(interests ?? []);
  const generalSet = new Set(GENERAL_TOPICS);
  const usedSet = new Set(usedTopics ?? []);
  const seenSet = new Set(seenCards ?? []);

  const byInterest = interestSet.size > 0 ? all.filter((card) => interestSet.has(card.topic)) : [];
  const byInterestInWindow = byInterest.filter((card) => window.includes(card.difficulty));
  const freshInWindow = byInterestInWindow.filter((card) => !seenSet.has(card.id));
  // 通用主题（不属于任何一方兴趣、谁都能聊）：**交集为空时唯一的兜底来源**。
  // 注意这里用的是 `windowPool` 而不是 `all`，所以「窗口里一张卡都没有」的
  // 自造小卡池照样退到整池（见下面最后一格）。
  const generalInWindow = windowPool.filter((card) => generalSet.has(card.topic));

  const target = Math.max(1, Math.round(count));

  // 一叠的来源，按「越贴题越优先」分四级挑：
  //   1) 双方兴趣 ∩ 水平窗口 ∩ 本次会话没看过 —— 最贴题，也不会冒出超纲的卡；
  //   2) 双方兴趣（放宽难度、含看过的）      —— 宁可同一主题里难一点，也不掺无关主题；
  //   3) 通用主题 ∩ 水平窗口                —— 交集为空时的兜底，**不是并集**；
  //   4) 全部主题（最后一格）               —— 只有通用主题也凑不满才用（自造小卡池）。
  // 第 1 级带上「没看过」是为了「换一叠」真的换得掉：窗口里只剩几张新卡时，
  // 与其把看过的那几张再洗一遍，不如去同一主题的下一档拿新卡。
  let source;
  if (freshInWindow.length >= target) source = freshInWindow;
  else if (byInterest.length >= target) source = byInterest;
  else if (generalInWindow.length > 0) source = generalInWindow;
  else source = windowPool;

  // 每张候选先抽一个随机键：**同优先级内部**靠它洗牌，跨优先级仍然按 rank 分层。
  // 抽签顺序跟着 `source` 走，所以同一个 seed 一定给同一串键（可复现）。
  const jitter = new Map();
  source.forEach((card, index) => jitter.set(card, next()));

  const rankOf = (card) => [
    interestSet.has(card.topic) ? 0 : 1,
    seenSet.has(card.id) ? 1 : 0,
    usedSet.has(card.topic) ? 1 : 0,
    difficultyDistance(card.difficulty, level),
  ];
  const order = (a, b) => compareRank(a.rank, b.rank) || a.jitter - b.jitter;

  // 先按主题归堆：主题的排名取它名下最好的那张卡
  const topics = [];
  const byTopic = new Map();
  source.forEach((card, index) => {
    const entry = { card, rank: rankOf(card), jitter: jitter.get(card), index };
    let group = byTopic.get(card.topic);
    if (!group) {
      group = { rank: entry.rank, jitter: entry.jitter, first: index, cards: [] };
      byTopic.set(card.topic, group);
      topics.push(group);
    } else if (compareRank(entry.rank, group.rank) < 0) {
      group.rank = entry.rank;
      group.jitter = entry.jitter;
    }
    group.cards.push(entry);
  });

  // 同堆内：按四档优先级，同档再按随机键（这就是「洗牌」发生的地方）
  for (const group of topics) group.cards.sort(order);

  // 按优先级排好主题顺序，然后**轮流发牌**：一轮里每个主题最多发一张。
  topics.sort((a, b) => compareRank(a.rank, b.rank) || a.jitter - b.jitter || a.first - b.first);
  const ordered = [];
  for (let round = 0; ; round += 1) {
    let dealt = 0;
    for (const group of topics) {
      const item = group.cards[round];
      if (!item) continue;
      ordered.push(item.card);
      dealt += 1;
    }
    if (dealt === 0) break;
  }

  const out = [];
  for (let index = 0; index < target; index += 1) {
    out.push(ordered[index % ordered.length]);
  }
  return out;
}

/** 双方兴趣交集（用于卡片排序与「为什么会匹配」的说明）。 */
export function sharedInterests(a, b) {
  const right = new Set(b ?? []);
  return (a ?? []).filter((tag) => right.has(tag));
}

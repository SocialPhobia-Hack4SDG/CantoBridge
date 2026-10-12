/**
 * 纯逻辑：标签交集、匹配度、时长与积分、成就判定、匿名化。
 * 全部为无副作用函数，便于单测与在 mock / 真实接口之间复用。
 */

export function uniqueList(values) {
  const seen = new Set();
  const out = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sharedTags(a, b) {
  const right = new Set(b ?? []);
  return uniqueList(a ?? []).filter((tag) => right.has(tag));
}

/**
 * 匹配度：共同标签占「较小标签集（上限 4）」的比例，映射到 40 ~ 95。
 * 没有共同标签时给 40，避免出现 0% 让人以为匹配失败。
 */
export function matchScore(myTags, peerTags) {
  const mine = uniqueList(myTags);
  const theirs = uniqueList(peerTags);
  const shared = sharedTags(mine, theirs).length;
  const denominator = Math.max(1, Math.min(mine.length, theirs.length, 4));
  const score = 40 + Math.round((shared / denominator) * 55);
  return Math.max(40, Math.min(95, score));
}

/** 语言互补的排序权重（B 的「回礼」）。只加权、不筛选：不互补的人照样在列表里。
 *  权重取 8 的来历：matchScore 里每多一个共同标签约值 13.75 分，8 分能破平局、
 *  能翻转挨得很近的两个人，但压不过「少两个共同话题」的人——这才叫软条件。
 *  （推导与三条硬约束见 docs/07-open-questions.md 第 9.4 节。）
 */
export const COMPLEMENT_BOOST = 8;

/** 学习者的「想练」恒为粤语：这是身份自带的，不是用户填的（所以不落库、不进设置）。
 *  推论：学习者视角下每位粤语母语者都同样 +8，排序结果与纯 matchScore 一致。
 */
export const LEARNER_WANT_TO_LEARN = ['yue'];

/**
 * 命中的那门语言（给徽标文案用：TA 的母语是普通话 / TA 也想练普通话），没命中返回 null。
 * 「互补」只有这一处定义，权重与文案都从它派生。
 * 空集合返回 null——「没填」不等于「什么都想练」。
 */
export function complementLanguage(wantToLearn, peerNativeLanguages) {
  const wanted = new Set(uniqueList(wantToLearn));
  if (wanted.size === 0) return null;
  const speaks = uniqueList(peerNativeLanguages);
  return speaks.find((language) => wanted.has(language)) ?? null;
}

/**
 * 语言互补加成：母语者填了「我也想练 X」，而对面正好以 X 为母语时命中。
 * 命中给 8 分，否则 0。取值完全不相交（例如对面母语是 other）也只是 0——
 * 不报错、不过滤、不降级：小规模冷启动下，筛掉人就等于匹配不到人。
 */
export function complementBoost(wantToLearn, peerNativeLanguages) {
  return complementLanguage(wantToLearn, peerNativeLanguages) ? COMPLEMENT_BOOST : 0;
}

/**
 * 候选人排序键 = 匹配度 + 语言互补加成。
 * entry 同时认单数 nativeLanguage 与复数 nativeLanguages：等待列表里是单数，
 * 推荐块里会先归一化成复数，这里容错一下，免得两处各写一遍。
 */
export function matchRank(entry, viewer) {
  const languages = uniqueList(
    entry?.nativeLanguages ?? (entry?.nativeLanguage ? [entry.nativeLanguage] : []),
  );
  return (entry?.matchScore ?? 0) + complementBoost(viewer?.wantToLearn, languages);
}

export function formatDuration(durationSec) {
  const seconds = Number.isFinite(durationSec) ? Math.max(0, Math.round(durationSec)) : 0;
  if (seconds < 60) return { key: 'duration.lessThanMinute', minutes: 0 };
  return { key: 'duration.minutes', minutes: Math.round(seconds / 60) };
}

/** 积分：每分钟 6 点，每翻一张卡 5 点。 */
export function xpFor(durationSec, cardsUsed) {
  const seconds = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const cards = Number.isFinite(cardsUsed) ? Math.max(0, cardsUsed) : 0;
  return Math.round((seconds / 60) * 6) + cards * 5;
}

/** 母语者等级：按累计帮助时长与人数成长。 */
export function buddyLevel({ totalMinutes = 0, peopleHelped = 0 } = {}) {
  if (peopleHelped >= 10 || totalMinutes >= 180) return 'ambassador';
  if (peopleHelped >= 5 || totalMinutes >= 90) return 'guide';
  if (peopleHelped >= 2 || totalMinutes >= 30) return 'helper';
  return 'newcomer';
}

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

/** 返回当前应解锁的成就 id（不区分是否「刚刚」解锁）。 */
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

/** 本次会话新解锁的成就 = 结算后应解锁 - 结算前已解锁。 */
export function newlyUnlocked(before, after) {
  const previous = new Set(before ?? []);
  return (after ?? []).filter((id) => !previous.has(id));
}

/** 匿名时强制覆盖显示名，不信任后端是否已裁剪。 */
export function peerDisplayName(entry, anonymousLabel) {
  if (!entry) return anonymousLabel;
  if (entry.anonymous) return anonymousLabel;
  return entry.userId ?? anonymousLabel;
}

/** 按公开范围裁剪要展示的标签。 */
export function visibleTags(entry, visibility = {}, kinds = ['interests', 'topics']) {
  const out = [];
  for (const kind of kinds) {
    if (visibility[kind] === false) continue;
    out.push(...uniqueList(entry?.[kind]));
  }
  return uniqueList(out);
}

export function clampInterests(list, max = 5) {
  return uniqueList(list).slice(0, max);
}

/** 在列表里加一个 / 去掉一个（标签勾选），不改变原数组。 */
export function toggleInList(values, value) {
  const list = uniqueList(values);
  return list.includes(value) ? list.filter((item) => item !== value) : list.concat(value);
}

/**
 * 身份 -> 教 / 学 标签。**派生**值，唯一真源是「我的」页里的身份。
 *
 * 粤语母语者 = 教粤语、粤语学习者 = 学粤语——这两枚标签描述的是「这个人站哪一边」，
 * 不是一项可以自己挑的偏好。所以它不进设置、也不给选择开关：在「我的」页（或演示
 * 控制台）换身份，标签自己就跟着换；房间头部那枚徽标用的也是同一个函数。
 *
 * 身份缺失或取值不认识时不硬猜，返回 null：宁可不显示，也不要给人贴错标签。
 */
export function intentForRole(role) {
  if (role === 'buddy') return 'teach';
  if (role === 'learner') return 'learn';
  return null;
}

/**
 * 选中的集合是否覆盖了全部选项（「随便聊」的判定）。
 * 空选项表或空选择都不算「全选」——「一个都没选」和「都行」是两件事。
 */
export function coversAllOptions(values, options) {
  const all = uniqueList(options);
  if (all.length === 0) return false;
  const picked = new Set(uniqueList(values));
  return all.every((option) => picked.has(option));
}

/**
 * 伙伴关系判定（纯函数，供 store 与页面共用）。
 *
 * 伙伴关系是**双向**的：一场对话结束后只能「发出申请」，对方接受之后才算伙伴。
 * 这里把 buddies（已互相接受）与 buddyRequests（待确认的申请）两张表合成一个状态位，
 * 页面只认这个状态位，避免历史页、个人主页、结算页各写一套判断。
 *
 * 状态取值：
 *   - `buddy`       已是伙伴（互相同意）
 *   - `pending-out` 我已发出申请，等对方确认
 *   - `pending-in`  对方发来申请，等我确认
 *   - `none`        没有任何关系
 */
export function buddyRelation(peerId, { buddies = [], buddyRequests = [] } = {}) {
  const buddy = (buddies ?? []).find((item) => item.peerId === peerId) ?? null;
  if (buddy) return { state: 'buddy', buddy, request: null };
  const request =
    (buddyRequests ?? []).find((item) => item.peerId === peerId && (item.status ?? 'pending') === 'pending') ??
    null;
  if (request) {
    return { state: request.direction === 'outgoing' ? 'pending-out' : 'pending-in', buddy: null, request };
  }
  return { state: 'none', buddy: null, request: null };
}

/** 把申请列表拆成「收到的」与「我发出的」两组，顺序保持传入顺序。 */
export function splitBuddyRequests(buddyRequests = []) {
  const pending = (buddyRequests ?? []).filter((item) => (item.status ?? 'pending') === 'pending');
  return {
    incoming: pending.filter((item) => item.direction === 'incoming'),
    outgoing: pending.filter((item) => item.direction === 'outgoing'),
  };
}

/**
 * 后台匹配的时序常量：排队满 8 秒后自动产出一条匹配请求（demo 专用假时序，
 * 真实实现应由服务端 match:matched 驱动，见 docs/07 的 Q-G11）。
 * 与匹配页「等太久出现演示伙伴入口」共用同一个阈值，避免两处各写一个数字。
 */
export const MATCH_FOUND_AFTER_MS = 8000;

/**
 * 接受弹窗的剩余秒数：向上取整，最小 0。
 * 上限（总秒数）来自 settings.matchAcceptSeconds，可在 /dev/mock 现场调整。
 */
export function acceptCountdown(expiresAt, nowMs = Date.now()) {
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
}

/**
 * 页面视图模型（纯函数）：
 * 把 store / service 的原始数据整理成「组件直接能摆上去」的结构。
 * 组件只管画，这里管换算，所以换算逻辑全部可以在 Node 里单测。
 */

import { buddyLevel, buddyRelation, coversAllOptions, formatDuration, uniqueList, unlockedAchievements } from './logic.js';

/**
 * 「语言互补」徽标 + 一行说明。两个方向共用一处换算（组件只负责画）：
 *   label 恒为「语言互补」；note 把命中的那门语言填进模板。
 * 没命中（complement 假）就整块返回 null——不做「无互补」的灰徽标，
 * 那种「人人都有徽标」的画面等于没有徽标。
 * noteKey 由调用方给：母语者看学习者用 match.complementPeerNative（TA 的母语是 X），
 * 学习者看母语者用 home.complementWants（TA 也想练 X）。
 */
export function complementView(peer, { t, label, noteKey }) {
  if (!peer?.complement) return null;
  const language = peer.complementLanguage ? label(NATIVE_LANGUAGE_GROUP, peer.complementLanguage) : null;
  return { label: t(COMPLEMENT_BADGE_KEY), note: language ? t(noteKey, { language }) : null };
}

/**
 * `complementView` 的组件友好形态：摊成 `complementLabel` / `complementNote` 两个 prop，
 * 没命中时两者都是 null（组件据此整行不画）。
 * 抽出来的理由：一个结果要喂两个 prop，写成两次 `complementView(...)?.x` 既啰嗦又容易只改一半。
 */
export function complementProps(peer, { t, label, noteKey }) {
  const view = complementView(peer, { t, label, noteKey });
  return { complementLabel: view?.label ?? null, complementNote: view?.note ?? null };
}

const NATIVE_LANGUAGE_GROUP = 'nativeLanguages';
const COMPLEMENT_BADGE_KEY = 'match.complementBadge';

/** 计时器文本 mm:ss（房间计时、等待计时共用）。 */
export function formatClock(totalSeconds) {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(seconds / 60);
  return minutes + ':' + String(seconds % 60).padStart(2, '0');
}

/** ISO 时间戳 -> 「09-21 21:10」，只用于连线记录这类列表。 */
export function formatShortDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** 从排队时间算出已等待秒数（演示时按秒跳动）。 */
export function elapsedSeconds(joinedAt, now = Date.now()) {
  if (!joinedAt) return 0;
  return Math.max(0, Math.round((now - joinedAt) / 1000));
}

/** onboarding 三段进度：1/3、2/3、3/3。 */
export function onboardingProgress(step, total = 3) {
  const current = Math.max(1, Math.min(total, Math.round(step)));
  return { current, total, label: current + ' / ' + total, ratio: current / total };
}

/** 首页统计小块：两种身份看不同的数字（同一份数据，两套视角）。 */
export function homeTiles({ role, stats = {}, progress = {}, achievementCount = 0 }) {
  const unlocked = String(achievementCount);
  if (role === 'buddy') {
    return [
      { id: 'hours', labelKey: 'home.conversationHours', value: round1(stats.totalMinutes / 60), unit: 'hour' },
      { id: 'people', labelKey: 'home.peopleHelped', value: String(stats.peopleHelped ?? 0), unit: 'count' },
      { id: 'level', labelKey: 'home.buddyLevel', labelGroup: 'buddyLevels', labelValue: buddyLevel(stats) },
      { id: 'achievements', labelKey: 'home.achievements', value: unlocked, unit: 'count' },
    ];
  }
  return [
    { id: 'practice', labelKey: 'home.practiceTime', value: String(Math.round(progress.practiceMinutesThisWeek ?? 0)), unit: 'minute' },
    { id: 'conversations', labelKey: 'home.conversations', value: String(stats.conversations ?? 0), unit: 'count' },
    { id: 'streak', labelKey: 'home.streak', value: String(stats.streakDays ?? 0), unit: 'day' },
    { id: 'achievements', labelKey: 'home.achievements', value: unlocked, unit: 'count' },
  ];
}

/** 把 tile 渲染成文案：注入 t 与 labelOf，保持纯函数可测。 */
export function resolveTile(tile, { t, labelOf }) {
  if (tile.labelGroup) {
    return { id: tile.id, label: t(tile.labelKey), value: labelOf(tile.labelGroup, tile.labelValue) };
  }
  if (tile.unit === 'minute') return { id: tile.id, label: t(tile.labelKey), value: t('duration.minutes', { minutes: tile.value }) };
  if (tile.unit === 'hour') return { id: tile.id, label: t(tile.labelKey), value: t('duration.hours', { hours: tile.value }) };
  if (tile.unit === 'day') return { id: tile.id, label: t(tile.labelKey), value: t('duration.days', { days: tile.value }) };
  return { id: tile.id, label: t(tile.labelKey), value: String(tile.value) };
}

/** 首页主 CTA：按身份给不同的标题与按钮文字。 */
export function homePrimaryAction({ role, waitingCount = 0 }) {
  if (role === 'buddy') {
    return {
      headlineKey: 'home.buddyHeadline',
      ctaKey: 'home.buddyCta',
      badge: waitingCount > 0 ? { key: 'home.buddyWaiting', vars: { count: waitingCount } } : null,
      to: '/match',
    };
  }
  return { headlineKey: 'home.learnerHeadline', ctaKey: 'home.learnerCta', badge: null, to: '/match' };
}

/** 成就墙：当前身份、按规则判定解锁状态（未解锁的灰显并给出条件）。 */
export function achievementStates(catalog, role, stats = {}) {
  const list = Array.isArray(catalog) ? catalog : [];
  const unlocked = new Set(role ? unlockedAchievements(role, stats) : []);
  return list
    .filter((item) => !role || item.role === role || item.role === 'all')
    .sort((a, b) => Number(a.role === 'all') - Number(b.role === 'all'))
    .map((item) => ({ id: item.id, role: item.role, hint: item.hint, unlocked: unlocked.has(item.id) }));
}

/** 结算页视图模型：同一份时长，两种身份的文案。 */
export function summaryModel({ role, durationSec, cardsUsed, xpEarned, unlocked = [], minSeconds = 60 } = {}) {
  const duration = formatDuration(durationSec);
  const showBadges = Number(durationSec) >= minSeconds;
  return {
    role,
    durationKey: duration.key,
    durationVars: { minutes: duration.minutes },
    cardsUsed: Number(cardsUsed) || 0,
    xpEarned: Number(xpEarned) || 0,
    unlocked: showBadges ? uniqueList(unlocked) : [],
    showBadges,
    headlineKey: role === 'buddy' ? 'summary.buddyHeadline' : 'summary.great',
  };
}

/**
 * 连线记录：只看我的伙伴 / 全部，按时间倒序。
 *
 * 每行带一个由 buddies + buddyRequests 推导出来的 `buddyState`，页面据此决定显示
 * 「申请成为伙伴 / 等待确认 / 待你确认 / 已连接」以及对应的按钮，历史记录本身
 * 不再存「是否已标记」这种会跟真实关系脱节的布尔值。
 */
export function historyRows(entries, { buddies = [], requests = [], buddyOnly = false } = {}) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  return list
    .map((entry) => {
      const relation = buddyRelation(entry.peerId, { buddies, buddyRequests: requests });
      return { ...entry, buddyState: relation.state, buddyRequest: relation.request };
    })
    .filter((entry) => (buddyOnly ? entry.buddyState === 'buddy' : true))
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
    .map((entry) => ({
      ...entry,
      when: formatShortDateTime(entry.startedAt),
      durationKey: formatDuration(entry.durationSec).key,
      durationVars: { minutes: formatDuration(entry.durationSec).minutes },
      topics: uniqueList(entry.topics),
    }));
}

/** 话题卡牌堆位置：「第 3 / 8 张」，聊完时给空态。 */
export function deckPosition(index, total) {
  const count = Math.max(0, Number(total) || 0);
  const position = count === 0 ? 0 : Math.max(1, Math.min(count, Number(index) + 1));
  return { empty: count === 0, index: position, total: count, vars: { index: position, total: count } };
}

/**
 * 牌堆进度：到没到头、看过几张、进度条走多少。
 * `seen` 是**看过的卡 id**（可重复、可乱序），去重后才算数——来回滑不该把进度刷上去。
 * `atStart` / `atEnd` 用来把「‹」「›」置灰：到头了要给明确出路，而不是按下去没反应。
 */
export function deckProgress({ index = 0, total = 0, seen = [] } = {}) {
  const count = Math.max(0, Number(total) || 0);
  const current = count === 0 ? 0 : Math.max(0, Math.min(count - 1, Number(index) || 0));
  const visited = Math.min(count, new Set(seen ?? []).size);
  return {
    empty: count === 0,
    atStart: current <= 0,
    atEnd: count === 0 || current >= count - 1,
    visited,
    total: count,
    percent: count === 0 ? 0 : Math.round((visited / count) * 100),
    vars: { done: visited, total: count },
  };
}

/** 房间状态 -> 文案 key（含降级模式）。 */
export function roomStatusKey({ status, mode, hasMic, peerLeft } = {}) {
  if (peerLeft) return 'room.peerLeft';
  if (!hasMic) return 'room.listenOnly';
  if (mode === 'sim') return 'room.simulated';
  if (status === 'connecting') return 'room.connecting';
  if (status === 'degraded') return 'room.degraded';
  return 'room.live';
}

/**
 * 自定义匹配条件的「有效值」：设置过就用设置过的，没设置过就用资料里的兴趣。
 * 条件编辑器打开时也用它做初始草稿——在「原本的条件」上放宽比从空白开始顺手。
 */
export function effectiveMatchCriteria(profile = {}, criteria = null) {
  return uniqueList(Array.isArray(criteria) ? criteria : profile.interests);
}

/**
 * 匹配大厅的等待条件摘要（水平 + 主题）。
 *
 * `criteria` 传 null / undefined = 还没自定义过，用资料里的兴趣；传数组 = 用自定义的那一套。
 * 自定义的那一套把全部主题都勾上时，用 `anyLabel`（「随便聊」）代替逐个罗列——
 * 十几个标签铺满一行既读不完也读不懂。全部主题由调用方从词表传进来（`allInterests`），
 * 这样这个函数仍然不依赖 data 层。
 */
export function matchCriteriaSummary(profile = {}, { labelOf, criteria = null, anyLabel = null, allInterests = [] } = {}) {
  const parts = [];
  if (profile.cantoneseLevel) parts.push(labelOf('levels', profile.cantoneseLevel));
  const effective = uniqueList(Array.isArray(criteria) ? criteria : profile.interests);
  if (anyLabel && coversAllOptions(effective, allInterests)) {
    parts.push(anyLabel);
  } else {
    for (const interest of effective.slice(0, 3)) parts.push(labelOf('interests', interest));
  }
  return parts.join('、');
}

/** 隐私预览：别人会看到我什么（全部关闭时给兜底文案）。 */
export function privacyPreview(profile = {}, visibility = {}, { labelOf, anonymous = false } = {}) {
  const rows = [];
  if (visibility.level !== false && profile.cantoneseLevel) {
    rows.push(labelOf('levels', profile.cantoneseLevel));
  }
  if (visibility.identity !== false && profile.identity) {
    rows.push(labelOf('identities', profile.identity));
  }
  if (visibility.interests !== false) {
    for (const interest of uniqueList(profile.interests).slice(0, 4)) rows.push(labelOf('interests', interest));
  }
  if (visibility.nativeLanguage !== false && profile.nativeLanguage) {
    rows.push(labelOf('nativeLanguages', profile.nativeLanguage));
  }
  return { rows, anonymous: Boolean(anonymous), empty: rows.length === 0 };
}

function round1(value) {
  const number = Number.isFinite(value) ? value : 0;
  return String(Math.round(number * 10) / 10);
}

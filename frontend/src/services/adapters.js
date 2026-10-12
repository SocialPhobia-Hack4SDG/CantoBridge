/**
 * 适配层：把**后端契约形状**翻译成**页面期望形状**（纯函数，最容易测也最容易出 bug）。
 *
 * 为什么必须有这一层：契约是「服务端视角的字段名」，页面用的是历史沿用下来的叫法，
 * 两者在几处不一样（`{entries}` vs 裸数组、`reasons` vs `reason`、`roomAvailable` 在顶层 vs
 * 嵌在人对象里、`expiresAt` 是 ISO 字符串 vs 倒计时需要的毫秒数）。
 * 把翻译集中在这里，页面代码一行都不用改。
 *
 * 参考：`frontend/docs/09-frontend-logic-and-api.md` 第 3.4 节（核心数据结构）。
 */

/**
 * 列表类：后端给 `{ entries: [...] }`，页面要**裸数组**。
 * 容错：万一后端直接给了数组（或字段缺失），也不要让页面拿到 undefined。
 */
export function toEntries(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.entries) ? data.entries : [];
}

/**
 * 通用解包：后端给 `{ <key>: [...] }`，页面要**裸数组**。
 * 容错同上：后端直接给了数组、或字段缺失，也不让页面拿到 undefined。
 */
function toList(data, key) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.[key]) ? data[key] : [];
}

/** `{ buddies: [...] }` → 伙伴列表（裸数组）。 */
export function toBuddies(data) {
  return toList(data, 'buddies');
}

/** `{ requests: [...] }` → 伙伴申请列表（裸数组，含收到与发出）。 */
export function toBuddyRequests(data) {
  return toList(data, 'requests');
}

/**
 * 进度（`GET /api/me/progress`）：契约与 mock **键集合一致**（xp / streakDays / totalMinutes /
 * conversations / peopleHelped / distinctTopics / practiceMinutesThisWeek / buddyLevel /
 * achievements），所以直接透传；这里只保证数组字段永远是数组，页面 map 它时不会炸。
 */
export function toProgress(data) {
  const source = data ?? {};
  return {
    ...source,
    xp: Number.isFinite(source.xp) ? source.xp : 0,
    achievements: Array.isArray(source.achievements) ? source.achievements : [],
  };
}

/** `{ learnerProfile }` / `{ buddyProfile }` → 资料本身（页面要的就是资料对象）。 */
export function toProfile(data, key) {
  if (!data) return null;
  if (data[key]) return data[key];
  return data;
}

/** `{ settings }` → 设置本身。 */
export function toSettings(data) {
  if (!data) return null;
  return data.settings ?? data;
}

/**
 * 候选人预览：后端给 `{candidate, matchedTags, matchScore, reasons, roomAvailable}`，
 * 页面读的是**扁平**对象里的 `roomAvailable` / `reason`（预览页就是这么写的）。
 */
export function toCandidate(data) {
  if (!data) return null;
  const candidate = data.candidate ?? data;
  const reasons = data.reasons ?? candidate.reasons ?? data.reason ?? candidate.reason ?? [];
  return {
    ...candidate,
    matchedTags: data.matchedTags ?? candidate.matchedTags ?? [],
    matchScore: data.matchScore ?? candidate.matchScore ?? null,
    // 页面叫 reason（单数），契约叫 reasons（复数）——两个键都给，方便前端逐步收敛
    reason: reasons,
    reasons,
    roomAvailable: data.roomAvailable ?? candidate.roomAvailable ?? true,
  };
}

/**
 * `expiresAt`：契约是 ISO 8601 字符串，而前端的倒计时（`acceptCountdown`）
 * 要求**毫秒数**（`Number.isFinite` 不过就当成 0 秒立刻过期）。null 原样透传。
 */
export function isoToMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 入队：契约 `{queueEntryId, joinedAt(ISO)}` → 前端沿用同一对字段（`joinedAt` 转毫秒）。 */
export function toQueueEntry(data) {
  return {
    queueEntryId: data?.queueEntryId ?? null,
    joinedAt: isoToMs(data?.joinedAt),
  };
}

/** 匹配请求：`{requestId, roomId, peer, expiresAt(ISO), acceptSeconds}` → 弹窗要的毫秒数。 */
export function toMatchRequest(data) {
  return {
    requestId: data?.requestId ?? null,
    roomId: data?.roomId ?? null,
    peer: data?.peer ?? null,
    expiresAt: isoToMs(data?.expiresAt),
    acceptSeconds: Number.isFinite(data?.acceptSeconds) ? data.acceptSeconds : null,
  };
}

/** 成房：`{roomId, peer, expiresAt}` → 与 mock 同形状（`expiresAt` 转毫秒）。 */
export function toRoom(data) {
  return {
    roomId: data?.roomId ?? null,
    peer: data?.peer ?? null,
    expiresAt: isoToMs(data?.expiresAt),
  };
}

/** 房间元信息（`GET /api/rooms/:roomId`）：摊平成前端 `runtime.room` 的样子。 */
export function toRoomRecord(data) {
  const room = data?.room ?? {};
  return {
    roomId: room.roomId ?? null,
    peer: data?.peer ?? null,
    // 发起人视角：对方是学习者 ⇒ 我是母语者
    role: room.peerRole === 'learner' ? 'buddy' : 'learner',
    status: data?.status ?? room.status ?? null,
    startedAt: isoToMs(data?.startedAt ?? room.createdAt),
  };
}

/**
 * 设置写入：**只挑服务端认识的字段**，并把前端的 `locale` 映射成契约里的 `interfaceLanguage`。
 * 不做这层过滤的话，前端本地的偏好（`theme` / `signalMode` / `mockDelayMs` …）会被后端
 * 判成未知字段直接 400。
 */
const SETTINGS_WRITABLE = ['anonymous', 'visibility', 'leaderboardVisible', 'equippedTitleId'];

export function toSettingsPatch(patch = {}) {
  const out = {};
  for (const key of SETTINGS_WRITABLE) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  if (patch.interfaceLanguage !== undefined) out.interfaceLanguage = patch.interfaceLanguage;
  else if (patch.locale !== undefined) out.interfaceLanguage = patch.locale;
  return out;
}

/** 结算：契约与 mock 同形状，直接透传（这里保留一个函数，方便以后加字段）。 */
export function toSettlement(data, fallback = {}) {
  return {
    durationSec: data?.durationSec ?? fallback.durationSec ?? 0,
    cardsUsed: data?.cardsUsed ?? fallback.cardsUsed ?? 0,
    xpEarned: data?.xpEarned ?? 0,
    unlocked: Array.isArray(data?.unlocked) ? data.unlocked : [],
    topics: Array.isArray(data?.topics) ? data.topics : (fallback.topics ?? []),
  };
}

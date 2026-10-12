/**
 * 候选人的对外视图：**匿名与可见范围由服务端裁剪**（契约 4.4 节的硬要求）。
 *
 * 规则与前端 mock 的 `publicView` / `buddyPublicView` 一致：
 *   - 匿名行不下发 `displayName`（前端用语言包兜底成「匿名伙伴」），但 `peerId` 要给
 *     —— 预览页与成房都靠它定位；
 *   - `visibility.identity === false` → `identity: null`；`visibility.interests === false` → `interests: []`；
 *   - 教 / 学 标签（`intent`）**不随可见范围裁剪**：藏了它，对面就不知道这位站哪一边。
 *
 * 这里是唯一一处拼候选人响应的地方：两个方向（母语者看学习者、学习者看母语者）
 * 共用它，避免两边各拼一套字段、「一边多一个字段」这种漂移。
 */

import { uniqueList } from '../lib/matching.js';
import { publicTitle } from '../lib/achievementTitles.js';

/** 粤语母语者 = 教粤语、粤语学习者 = 学粤语（与前端 `intentForRole` 同源）。 */
export function intentForRole(role) {
  if (role === 'buddy') return 'teach';
  if (role === 'learner') return 'learn';
  return null;
}

/** 默认全公开；行上带了 `visibility` 就按它裁剪。 */
export const DEFAULT_VISIBILITY = { interests: true, level: true, identity: true };

export function cropPeer(row) {
  if (!row) return null;
  const visibility = { ...DEFAULT_VISIBILITY, ...(row.visibility ?? {}) };
  return {
    peerId: row.userId,
    role: row.role,
    anonymous: Boolean(row.anonymous),
    // 匿名行不给名字：前端用自己的语言包写「匿名伙伴」，后端不掺 UI 文案
    avatarId: row.anonymous ? 'neutral' : (row.avatarId ?? 'neutral'),
    frameId: row.anonymous ? 'none' : (row.frameId ?? 'none'),
    equippedTitleId: row.equippedTitleId ?? null,
    displayName: row.anonymous ? null : (row.displayName ?? row.userId),
    nativeLanguage: visibility.nativeLanguage === false ? null : (row.nativeLanguage ?? null),
    cantoneseLevel: visibility.level === false ? null : (row.cantoneseLevel ?? null),
    identity: visibility.identity === false ? null : (row.identity ?? null),
    interests: visibility.interests === false ? [] : uniqueList(row.interests),
    intent: intentForRole(row.role),
    goal: row.goal ?? null,
    languagesSpoken: uniqueList(row.languagesSpoken),
    wantToLearn: uniqueList(row.wantToLearn),
  };
}

/**
 * 一个人此刻的对外视图。
 *
 * 优先用**队列行**（有 `goal`、有 `anonymous`，而且加入队列时已经按可见范围定过）；
 * 队列里没有就退回**资料行** —— 母语者挑人时他自己可能根本不在队列里，
 * 但 `match:matched` 要把「对方是谁」推给学习者，不能因为查不到队列行就推个 null。
 *
 * `cropPeer` 的输出**只取决于这一行自己**（不取决于看的人），所以这个函数
 * 不需要「谁在看」这个参数：给出去的永远是这个人的公开视图。
 */
export function peerViewOf(db, userId, role) {
  const row = db.findQueueRow?.(userId);
  if (row) return cropPeer({ ...row, equippedTitleId: publicTitle(db, row.ownerAccountId) });
  const profile = db.getProfile(userId, role);
  if (!profile) return null;
  const settings = db.getSettings(userId) ?? {};
  return cropPeer({
    ...profile,
    userId,
    // 资料行上没有匿名概念（匿名是「设置」），所以从设置里取
    anonymous: settings.anonymous ?? false,
    visibility: settings.visibility,
    equippedTitleId: publicTitle(db, profile.accountId ?? userId),
    // 队列行叫 `goal`，资料行叫 `learningGoal`，统一一次
    goal: profile.learningGoal ?? null,
  });
}

/** 房间号 / 请求号：带上 peerId 方便现场对着日志读。 */
export function newRoomId(peerUserId, at = Date.now()) {
  return 'r-' + peerUserId + '-' + at.toString(36).slice(-5);
}

let requestSeq = 0;
export function newRequestId(at = Date.now()) {
  requestSeq += 1;
  return 'req-' + at.toString(36).slice(-5) + '-' + requestSeq;
}

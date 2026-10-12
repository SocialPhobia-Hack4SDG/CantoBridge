/**
 * 匹配（契约 4.4 节）：入队 / 取消 / 两个方向的候选列表 / 匹配条件 / 候选人预览。
 *
 * 四条容易写错的硬要求，都在这里落地：
 *   1. **两边排的是同一批候选、同一套排序键**（`matchRank` = matchScore + 互补加成）；
 *   2. **只加权不筛选**：语言互补只决定顺序，谁都不从列表里消失；
 *   3. **取消等待要连坐**：取消时在同一个动作里作废还没接受的匹配请求；
 *   4. **匿名与可见范围由服务端裁剪**：统一走 `peerView.cropPeer`，两个方向一套字段。
 */

import { ApiError } from '../http/envelope.js';
import { requireSession } from '../http/auth.js';
import { INTERESTS, ROLES } from '../data/vocabularies.js';
import {
  LEARNER_WANT_TO_LEARN,
  matchRank,
  matchScore,
  sharedTags,
  uniqueList,
  withComplement,
} from '../lib/matching.js';
import { cropPeer } from './peerView.js';
import { publicTitle } from '../lib/achievementTitles.js';
import { assertEnumArray, assertKnownKeys } from './validate.js';

/** 列表默认上限：演示池很小，给 20 够用，也避免客户端传个巨大 limit 拖垮响应。 */
const DEFAULT_LIMIT = 20;

function limitOf(query) {
  const raw = query?.get?.('limit');
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), DEFAULT_LIMIT);
}

/** `?interests=a,b` 覆盖看的人的标签；不给就用资料里的。 */
function interestsFromQuery(query) {
  const raw = query?.get?.('interests');
  if (!raw) return null;
  return uniqueList(String(raw).split(',').map((item) => item.trim()));
}

/** 看的人的标签：查询参数 > 自定义条件 > 资料（母语者还带上「想聊的话题」）。 */
export function viewerTagsOf(db, accountId, role, { criteria = null, override = null } = {}) {
  if (override && override.length > 0) return override;
  if (Array.isArray(criteria) && criteria.length > 0) return uniqueList(criteria);
  const profile = db.getProfile(accountId, role);
  if (!profile) return [];
  return uniqueList([...(profile.interests ?? []), ...(profile.preferredTopics ?? [])]);
}

/** 学习者视角的标签：只看兴趣（`preferredTopics` 是母语者的字段）。 */
function learnerTagsOf(db, accountId, role, { criteria = null, override = null } = {}) {
  if (override && override.length > 0) return override;
  if (Array.isArray(criteria) && criteria.length > 0) return uniqueList(criteria);
  return uniqueList(db.getProfile(accountId, role)?.interests ?? []);
}

/** 一位等待中的学习者，按**母语者视角**算分（peerTags = 兴趣 + 学习目标）。 */
export function learnerEntryOf(row, myTags, viewerWantToLearn) {
  const view = cropPeer(row);
  const peerTags = [...view.interests, row.goal].filter(Boolean);
  const languages = uniqueList([view.nativeLanguage]);
  return withComplement(
    {
      ...view,
      nativeLanguages: languages,
      matchScore: matchScore(myTags, peerTags),
      matchedTags: sharedTags(myTags, peerTags),
      topics: view.interests,
    },
    viewerWantToLearn,
    languages,
  );
}

/** 一位有空的母语者，按**学习者视角**算分（peerTags = 兴趣）；互补问的是反方向。 */
export function buddyEntryOf(row, myTags, learnerNativeLanguage) {
  const view = cropPeer(row);
  const languages = uniqueList([view.nativeLanguage]);
  return withComplement(
    {
      ...view,
      nativeLanguages: languages,
      matchScore: matchScore(myTags, view.interests),
      matchedTags: sharedTags(myTags, view.interests),
    },
    view.wantToLearn,
    uniqueList([learnerNativeLanguage]),
  );
}

/**
 * 任意一行候选 → 对外条目（含 matchScore / matchedTags / complement）。
 * **房间域也用它**：成房响应里的 `peer` 与列表里的同一个人必须是同一套字段与同一个分数。
 */
export function peerEntryFor(db, row, accountId, role, { override = null } = {}) {
  const criteria = db.getSettings(accountId)?.matchCriteria ?? null;
  if (row.role === 'buddy') {
    const profile = db.getProfile(accountId, role);
    const myTags = learnerTagsOf(db, accountId, role, { criteria, override });
    return buddyEntryOf(row, myTags, profile?.nativeLanguage ?? null);
  }
  const profile = db.getProfile(accountId, role);
  const myTags = viewerTagsOf(db, accountId, role, { criteria, override });
  return learnerEntryOf(row, myTags, uniqueList(profile?.wantToLearn ?? []));
}

function byRankDesc(viewerWantToLearn) {
  const viewer = { wantToLearn: viewerWantToLearn };
  return (a, b) => matchRank(b, viewer) - matchRank(a, viewer);
}

/** 把 `topics` 写进设置：null / [] = 清掉自定义；越界取值 400。 */
function applyCriteria(db, accountId, topics) {
  if (topics === null || topics === undefined) {
    db.updateSettings(accountId, { matchCriteria: null });
    return null;
  }
  const list = assertEnumArray(topics, INTERESTS, 'topics', { max: INTERESTS.length });
  const criteria = list.length === 0 ? null : list;
  db.updateSettings(accountId, { matchCriteria: criteria });
  return criteria;
}

/**
 * 母语者视角：此刻正在等待的学习者，按 `matchRank` 降序。
 *
 * 抽成导出函数是**故意的**：REST 的 `GET /api/match/queue` 和信令的
 * `queue:updated` 事件必须是同一份列表 —— 一份代码两个出口，
 * 才不会出现「页面刷新是新的、推送来的是旧的」这种只有现场才会发现的漂移。
 */
export function waitingLearnersFor(db, { userId, role, limit = DEFAULT_LIMIT, override = null } = {}) {
  const criteria = db.getSettings(userId)?.matchCriteria ?? null;
  const myTags = viewerTagsOf(db, userId, role, { criteria, override });
  const viewerWantToLearn = uniqueList(db.getProfile(userId, role)?.wantToLearn ?? []);
  return db
    .listQueue({ role: 'learner', unclaimedOnly: true })
    // **别把自己列给自己**：一个账号两种身份，同一个人用母语者视角看时，
    // 自己排的那行学习者会出现在列表里——点下去就成房给「自己」，是死局。
    .filter((row) => row.ownerAccountId !== userId)
    .map((row) => learnerEntryOf(row, myTags, viewerWantToLearn))
    .sort(byRankDesc(viewerWantToLearn))
    .slice(0, limit);
}

/** 学习者视角：此刻有空的粤语母语者。与 `GET /api/match/recommendations` 同源。 */
export function availableBuddiesFor(db, { userId, role, limit = DEFAULT_LIMIT, override = null } = {}) {
  const criteria = db.getSettings(userId)?.matchCriteria ?? null;
  const myTags = learnerTagsOf(db, userId, role, { criteria, override });
  const learnerNativeLanguage = db.getProfile(userId, 'learner')?.nativeLanguage ?? null;
  return db
    .listQueue({ role: 'buddy', unclaimedOnly: true })
    // 同上：自己的行不该出现在自己的推荐里
    .filter((row) => row.ownerAccountId !== userId)
    .map((row) => buddyEntryOf(row, myTags, learnerNativeLanguage))
    .sort(byRankDesc(LEARNER_WANT_TO_LEARN))
    .slice(0, limit);
}

export function createMatchHandlers({ db, now = () => Date.now(), events = null }) {
  /** 通知信令层「队列变了」。信令没接（单测、纯 REST 部署）时是空操作。 */
  function emit(type, payload) {
    try {
      events?.(type, payload);
    } catch {
      void 0;
    }
  }

  return {
    /**
     * POST /api/match/queue —— 入队。
     * 同一个账号只留一行；已经在队列里（且没被摘走）再打一次就是 409 `already_queued`，
     * 前端拿到它就当「直接进等待面板」，不当错误弹红页。
     */
    async joinQueue(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(
        ctx.body,
        {
          allowed: ['learnerProfileSnapshot', 'anonymous', 'criteria'],
          // 身份以令牌为准：契约 4.4 的请求字段里没有 role，带了也忽略
          ignored: ['requestId', 'role'],
        },
        'match/queue',
      );

      const role = ROLES.includes(session.role) ? session.role : 'learner';
      const profile = db.getProfile(session.userId, role) ?? {};
      const userId = profile.userId ?? session.userId;

      // 只有「自己排过、还没被摘走」才算重复入队；种子池里的同名行（ownerAccountId 为 null）
      // 是这个账号的另一个身份在等，接管它即可，不该把用户挡在门外。
      const existing = db.findQueueRow(userId);
      if (existing && existing.ownerAccountId === session.userId && existing.claimedRoomId === null) {
        throw new ApiError('already_queued', 'already in queue');
      }

      const snapshot = ctx.body.learnerProfileSnapshot ?? {};
      const settings = db.getSettings(session.userId) ?? {};
      const row = {
        queueEntryId: 'q-' + userId,
        userId,
        role,
        anonymous: ctx.body.anonymous ?? settings.anonymous ?? false,
        // 队列行也带上账号的显示名：不匿名时对面至少看得到一个称呼，
        // 而不是一串 `learner-u-ab12cd34`（「有谁注册了就看见谁」要看得见是谁）
        avatarId: db.getUser(session.userId)?.avatarId ?? 'neutral',
        frameId: db.getUser(session.userId)?.frameId ?? 'none',
        displayName: db.getUser(session.userId)?.displayName ?? null,
        nativeLanguage: snapshot.nativeLanguage ?? profile.nativeLanguage ?? null,
        cantoneseLevel: snapshot.cantoneseLevel ?? profile.cantoneseLevel ?? null,
        identity: snapshot.identity ?? profile.identity ?? null,
        interests: uniqueList(snapshot.interests ?? profile.interests ?? []),
        goal: snapshot.learningGoal ?? profile.learningGoal ?? null,
        languagesSpoken: uniqueList(profile.languagesSpoken ?? []),
        wantToLearn: uniqueList(profile.wantToLearn ?? []),
        visibility: settings.visibility ?? null,
        equippedTitleId: publicTitle(db, session.userId),
        ownerAccountId: session.userId,
        joinedAt: new Date(now()).toISOString(),
        claimedRoomId: null,
      };
      const saved = db.upsertQueueRow(row);
      if (ctx.body.criteria !== undefined) applyCriteria(db, session.userId, ctx.body.criteria);
      // 队列变了就推一把：母语者的列表里要立刻多出这个人，不用等轮询
      emit('queue:updated');

      return { data: { queueEntryId: saved.queueEntryId, joinedAt: saved.joinedAt } };
    },

    /**
     * DELETE /api/match/queue —— 取消等待。
     * **在同一个动作里**作废还没接受的匹配请求（连坐），否则对面会干等到倒计时结束；
     * 而且先连坐再报错：队列早就没了的人来取消，也不该让别人的弹窗继续挂着。
     */
    async leaveQueue(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(ctx.body ?? {}, { allowed: ['queueEntryId'], ignored: ['requestId'] }, 'match/queue');
      // 只退自己排的那一行：种子里的演示池不能被一次「取消匹配」清空
      const removed = db.removeOwnedQueueRows(session.userId);
      // 先连坐再报错：队列早就没了的人来取消，也不该让别人的弹窗继续挂着
      const invalidated = db.invalidateMatchRequests(session.userId);
      if (removed === 0) throw new ApiError('queue_expired', 'no active queue entry');
      emit('queue:updated');
      return { data: { ok: true, invalidatedRequests: invalidated } };
    },

    /** GET /api/match/queue —— 母语者视角的等待者列表（按 matchRank 降序）。 */
    async listQueue(ctx) {
      const session = requireSession(ctx.req, db);
      const entries = waitingLearnersFor(db, {
        userId: session.userId,
        role: session.role,
        limit: limitOf(ctx.query),
        override: interestsFromQuery(ctx.query),
      });
      return { data: { entries } };
    },

    /** GET /api/match/recommendations —— 学习者视角：此刻有空的粤语母语者。 */
    async listRecommendations(ctx) {
      const session = requireSession(ctx.req, db);
      const entries = availableBuddiesFor(db, {
        userId: session.userId,
        role: session.role,
        limit: limitOf(ctx.query),
        override: interestsFromQuery(ctx.query),
      });
      return { data: { entries } };
    },

    /**
     * PUT /api/match/criteria —— 自定义匹配条件。
     * `topics` 为 null 或空数组 = 清掉自定义，回到按资料里的兴趣找（不发明新语义）。
     */
    async updateCriteria(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(ctx.body, { allowed: ['topics'], ignored: ['requestId'] }, 'match/criteria');
      const criteria = applyCriteria(db, session.userId, ctx.body.topics);
      return { data: { ok: true, criteria } };
    },

    /**
     * GET /api/match/candidates/:learnerId —— 候选人预览。
     * 被摘走的人**仍然可以预览**（`roomAvailable: false`），前端据此换空态，
     * 而不是把页面变成 404——「人已经被聊走了」和「人不存在」是两件事。
     */
    async getCandidate(ctx) {
      const session = requireSession(ctx.req, db);
      const row = db.findQueueRow(ctx.params.learnerId);
      if (!row) throw new ApiError('not_found', 'candidate not found: ' + ctx.params.learnerId);

      const override = interestsFromQuery(ctx.query);
      const entry = peerEntryFor(db, row, session.userId, session.role, { override });

      return {
        data: {
          candidate: entry,
          matchedTags: entry.matchedTags,
          matchScore: entry.matchScore,
          // v1 定名 reasons（共同标签等）；前端服务层负责把它映射到页面字段
          reasons: entry.matchedTags,
          roomAvailable: row.claimedRoomId === null,
        },
      };
    },
  };
}

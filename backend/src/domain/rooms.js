/**
 * 房间与匹配请求（契约 4.4 / 4.5 节）：接受 / 不接受 / 成房。
 *
 * 核心只有一句：**成房必须原子**。`accept` 与 `POST /api/rooms` 都可能成房，
 * 谁先到谁赢，第二个必须 409 `room_taken` —— 不能靠前端把列表项删掉来假装。
 * 原子性由 `db.claimQueueRow()` 保证（检查 + 置位在同一个同步调用里完成）。
 *
 * 另一条同样重要：**不接受 ≠ 退出匹配**。`decline` 只是不接这一位，
 * 队列行原封不动，等待计时不清零；彻底退出只有 `DELETE /api/match/queue` 一条路。
 */

import { ApiError } from '../http/envelope.js';
import { requireSession } from '../http/auth.js';
import { BUDDY_FEEDBACK_TAGS, LEARNER_FEEDBACK_TAGS } from '../data/vocabularies.js';
import {
  LEARNER_WANT_TO_LEARN,
  matchRank,
  uniqueList,
} from '../lib/matching.js';
import { newlyUnlocked, unlockedAchievements, xpFor } from '../lib/scoring.js';
import { pickCards, seedFrom } from '../lib/topics.js';
import { cropPeer, newRequestId, newRoomId, peerViewOf } from './peerView.js';
import { peerEntryFor } from './match.js';
import {
  assertBoolean,
  assertEnumArray,
  assertInt,
  assertKnownKeys,
  assertString,
  assertStringArray,
} from './validate.js';

const DEFAULT_ACCEPT_SECONDS = 10;
const MAX_ACCEPT_SECONDS = 60;

/**
 * @param events 信令层的通知口（可选）。领域层只喊「发生了什么」，
 *   谁该收到由 `ws/signaling.js` 决定。没接信令（单测 / 纯 REST）时是空操作，
 *   而且**绝不让信令的异常冒泡** —— 推不动消息不该把一次成功的成房变成 500。
 */
export function createRoomHandlers({ db, now = () => Date.now(), events = null }) {
  function iso(at) {
    return new Date(at).toISOString();
  }

  function emit(type, payload) {
    try {
      events?.(type, payload);
    } catch {
      void 0;
    }
  }

  /**
   * 配对成功：告诉**被摘走的那个人**「房号是哪个、对方是谁」。
   * `requestId` 为 `null` 表示对方直接把房开好了，不用接受，直接进房。
   * 目标带上 `role`：demo 的两种身份共用一个账号，只按账号推会推错设备。
   */
  function announceMatched({ accountId, role, requestId, roomId, peer, expiresAt }) {
    if (!accountId) return 0;
    return emit('match:matched', { accountId, role, requestId, roomId, peer, expiresAt });
  }

  /** 取一条**仍然有效**的待接受请求；过期 / 不是自己的 / 已经处理过都按 410 处理。 */
  function requireLiveRequest(ctx, session, requestId) {
    const request = db.getMatchRequest(requestId);
    if (!request || request.accountId !== session.userId) {
      throw new ApiError('match_request_expired', 'unknown match request: ' + requestId);
    }
    if (request.status !== 'pending') {
      throw new ApiError('match_request_expired', 'match request is ' + request.status);
    }
    if (request.expiresAt && Date.parse(request.expiresAt) <= now()) {
      db.updateMatchRequest(requestId, { status: 'expired' });
      throw new ApiError('match_request_expired', 'match request expired');
    }
    return request;
  }

  /** 成房：先原子摘人，再落房间。摘不到就是 409。 */
  function openRoom({ peerRow, initiatorAccountId, roomId }) {
    const claim = db.claimQueueRow(peerRow.userId, roomId);
    if (!claim.ok) {
      if (claim.reason === 'taken') throw new ApiError('room_taken', 'room already claimed');
      throw new ApiError('not_found', 'peer not found: ' + peerRow.userId);
    }
    const room = {
      roomId,
      peerUserId: peerRow.userId,
      peerRole: peerRow.role,
      initiatorAccountId,
      peerAccountId: peerRow.ownerAccountId ?? db.findAccountByPeerId(peerRow.userId),
      initiatorRole: peerRow.role === 'buddy' ? 'learner' : 'buddy',
      status: 'active',
      createdAt: iso(now()),
      expiresAt: null,
    };
    db.createRoom(room);
    // 队列里少了一个人：所有在看列表的人都该立刻看到（成房唯一的收口就在这）
    emit('queue:updated');
    return room;
  }

  return {
    /**
     * POST /api/rooms —— 母语者挑人（传 `learnerId`）或学习者在首页点「直接聊」（传 `buddyId`）。
     * 发起人两种、接口一个：服务端只保证「同一个伙伴只能被摘走一次」。
     */
    async createRoom(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(ctx.body, { allowed: ['learnerId', 'buddyId'], ignored: ['requestId'] }, 'rooms');

      const peerUserId = ctx.body.learnerId ?? ctx.body.buddyId ?? null;
      if (!peerUserId) throw new ApiError('bad_request', 'learnerId or buddyId is required');

      const peerRow = db.findQueueRow(peerUserId);
      if (!peerRow) throw new ApiError('not_found', 'peer not found: ' + peerUserId);

      const room = openRoom({
        peerRow,
        initiatorAccountId: session.userId,
        roomId: newRoomId(peerUserId, now()),
      });

      // 被摘走的人要立刻知道（他的设备在等 `/ws/match`）：
      // `requestId: null` = 房已经开好了，不用接受，直接进房
      emit('match:taken', { learnerId: peerRow.userId });
      announceMatched({
        accountId: peerRow.ownerAccountId,
        role: peerRow.role,
        requestId: null,
        roomId: room.roomId,
        peer: peerViewOf(db, session.userId, session.role),
        expiresAt: room.expiresAt,
      });

      return {
        status: 201,
        data: {
          roomId: room.roomId,
          peer: peerEntryFor(db, peerRow, session.userId, session.role),
          expiresAt: room.expiresAt,
        },
      };
    },

    /** POST /api/match/requests/:requestId/accept —— 接受 → 原子成房（第二次拿 409）。 */
    async acceptRequest(ctx) {
      const session = requireSession(ctx.req, db);
      const request = requireLiveRequest(ctx, session, ctx.params.requestId);

      const peerRow = db.findQueueRow(request.peerUserId);
      if (!peerRow) {
        db.updateMatchRequest(request.requestId, { status: 'expired' });
        throw new ApiError('match_request_expired', 'peer left the queue');
      }

      let room;
      try {
        room = openRoom({
          peerRow,
          initiatorAccountId: session.userId,
          roomId: request.roomId,
        });
      } catch (error) {
        db.updateMatchRequest(request.requestId, {
          status: error.code === 'room_taken' ? 'taken' : 'expired',
        });
        throw error;
      }
      db.updateMatchRequest(request.requestId, { status: 'accepted', acceptedAt: iso(now()) });

      // 发起人（母语者）的设备此刻正挂着等待面板：推给他「对方接受了，房号是 X」
      emit('match:taken', { learnerId: request.peerUserId });
      // `peer` 是**收件人眼里的对方**，不是「我这台设备是谁」：
      // 请求拥有者看到的是被他摘走的那位，被摘的那位看到的是点头的人。
      announceMatched({
        accountId: request.accountId,
        role: request.role,
        requestId: request.requestId,
        roomId: room.roomId,
        peer: peerEntryFor(db, peerRow, request.accountId, request.role),
        expiresAt: null,
      });

      // 被摘走的那一位（对面）也要知道房号：他在自己的设备上等着，不会自己进房。
      // `requestId: null` = 房已经开好了，不用接受，直接进房——和 `POST /api/rooms`
      // 摘人时给的那条完全同形。同一个账号（一台设备两个身份）就不重复推了。
      if (peerRow.ownerAccountId && peerRow.ownerAccountId !== request.accountId) {
        announceMatched({
          accountId: peerRow.ownerAccountId,
          role: peerRow.role,
          requestId: null,
          roomId: room.roomId,
          peer: peerViewOf(db, session.userId, session.role),
          expiresAt: null,
        });
      }

      return {
        status: 201,
        data: {
          roomId: room.roomId,
          peer: peerEntryFor(db, peerRow, session.userId, session.role),
          expiresAt: request.expiresAt ?? null,
        },
      };
    },

    /**
     * POST /api/match/requests/:requestId/decline —— 不接受（或倒计时到点）。
     * 人**留在队列**、等待计时不清零：这里绝不碰队列行。
     */
    async declineRequest(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(ctx.body ?? {}, { allowed: ['reason'], ignored: ['requestId'] }, 'match/requests/decline');
      const request = requireLiveRequest(ctx, session, ctx.params.requestId);
      db.updateMatchRequest(request.requestId, {
        status: 'declined',
        declinedAt: iso(now()),
        reason: ctx.body?.reason ?? null,
      });
      return { data: { ok: true } };
    },

    /**
     * POST /api/dev/match-request —— **契约外的演示口子**。
     *
     * 真实环境里「待接受的匹配请求」由匹配引擎产出并经 `/ws/match` 推送（Phase 4）；
     * 这一阶段先用它把队列里的人配成一条请求，好让 `accept` / `decline` 能端到端演。
     * 前端 mock 层的 `requestMatch({ reason: 'demo' })` 对应的就是它。
     */
    async createDemoMatchRequest(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(
        ctx.body ?? {},
        { allowed: ['acceptSeconds'], ignored: ['requestId', 'reason'] },
        'dev/match-request',
      );

      const wantRole = session.role === 'buddy' ? 'learner' : 'buddy';
      const candidates = db.listQueue({ role: wantRole, unclaimedOnly: true });
      if (candidates.length === 0) throw new ApiError('not_found', 'no available peer');

      // 排序键与列表完全一致：母语者用自己的 wantToLearn，学习者恒为粤语
      const viewerWantToLearn =
        session.role === 'buddy'
          ? uniqueList(db.getProfile(session.userId, 'buddy')?.wantToLearn ?? [])
          : LEARNER_WANT_TO_LEARN;
      const peer = candidates
        .map((row) => peerEntryFor(db, row, session.userId, session.role))
        .sort(
          (a, b) =>
            matchRank(b, { wantToLearn: viewerWantToLearn }) -
            matchRank(a, { wantToLearn: viewerWantToLearn }),
        )[0];
      const peerRow = db.findQueueRow(peer.peerId);
      if (!peerRow) throw new ApiError('not_found', 'no available peer');

      const seconds = clampSeconds(ctx.body?.acceptSeconds);
      const at = now();
      const request = {
        requestId: newRequestId(at),
        accountId: session.userId,
        role: session.role,
        peerUserId: peerRow.userId,
        peerRole: peerRow.role,
        roomId: newRoomId(peerRow.userId, at),
        status: 'pending',
        createdAt: iso(at),
        expiresAt: iso(at + seconds * 1000),
      };
      db.createMatchRequest(request);

      // 这个口子演的就是匹配引擎：产出一条待接受请求之后，**立刻推给该收到的那个人**。
      // 「该收到的人」= **请求的拥有者**，也就是调用方自己 —— 只有他能 `accept`
      // （`acceptRequest` 校验 `request.accountId === session.userId`）。推给对面的话，
      // 对面拿着 requestId 却接受不了，弹窗一点就是 410：两台设备之间这条路径是断的。
      // 真实引擎接上之后，这一段就是它该做的事。
      announceMatched({
        accountId: session.userId,
        role: session.role,
        requestId: request.requestId,
        roomId: request.roomId,
        peer,
        expiresAt: request.expiresAt,
      });

      return {
        status: 201,
        data: {
          requestId: request.requestId,
          roomId: request.roomId,
          peer,
          expiresAt: request.expiresAt,
          acceptSeconds: seconds,
        },
      };
    },

    /**
     * GET /api/rooms/:roomId/cards —— 三语话题卡。
     * 先返回**固定卡池**（`src/data/topicDatabase.js`，472 张 = 13 个兴趣主题 × 4 档 × 8 张
     * + 7 个通用主题 × 4 档 × 2 张），按 `level` 与 `interests` 选卡；
     * 真 LLM 生成后置，接口形状不变（只换 cards 的来源）。
     *
     * 三个查询参数（契约 4.5 节）：
     *   - `level`：缺省取**学习者**那一侧的水平；
     *   - `interests`：缺省取**双方**资料里的兴趣**交集**（各按自己在房间里扮演的身份取），
     *     交集为空时由选卡器拿**通用主题**兜底 —— 不是并集；
     *   - `round`：第几叠（`?round=0` 是开场那一叠，「再来八张」加一）；
     *   - `exclude`：本次会话已经看过的卡 id（逗号分隔），选卡时往后排 —— 「换一叠」要真的换得掉。
     *
     * **洗牌的种子由 `roomId + round` 派生**：同一个房间的两侧请求同一个 round 会拿到
     * 一模一样的一叠（「双方看同一张」的前提），换一叠 / 换一个房间则不一样。
     * 用真随机的话这条就断了 —— 两侧各拿一叠不同的卡，对方翻到的那张在本机根本找不到。
     */
    async getCards(ctx) {
      requireSession(ctx.req, db);
      const room = requireRoom(ctx, db);
      const peerRow = db.findQueueRow(room.peerUserId);
      const learnerSide = learnerSideOf(room, peerRow);

      const level = ctx.query.get('level') ?? learnerLevelOf(db, learnerSide) ?? 'beginner';
      const requested = ctx.query.get('interests');
      const interests = requested
        ? uniqueList(String(requested).split(',').map((item) => item.trim()))
        : bothSidesSharedInterests(db, room, peerRow);

      const count = clampCount(ctx.query.get('count'));
      const round = clampRound(ctx.query.get('round'));
      // 已经看过的卡：只在「本次会话」这一层起作用（历史话题由 `usedTopics` 管）。
      // 传得再长也不会撑爆 URL —— 一叠最多 32 张，前端的 `visited` 也就这个量级。
      const seenCards = uniqueList(
        String(ctx.query.get('exclude') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );

      // 「已经聊过的话题」取**学习者一侧**的历史（和 level 同一个人）：
      // 同一个账号第二次开房时，上一轮聊过的主题会排到后面。
      // 注意这里要的是**账号 id**：队列行上的 `userId` 是「身份 id」
      // （如 `learner-u-ab12cd34`，一个账号两份人格就靠它区分），
      // 而进度表是按 `accountId` 存的——拿 `room.peerUserId` 去查永远是空。
      const usedTopics = uniqueList(db.getProgress(learnerSide.accountId)?.topicsSeen ?? []);

      return {
        data: {
          roomId: room.roomId,
          level,
          round,
          cards: pickCards({
            level,
            interests,
            usedTopics,
            seenCards,
            count,
            seed: seedFrom(room.roomId + ':' + round),
          }),
        },
      };
    },

    /**
     * POST /api/rooms/:roomId/end —— 结算。
     *
     * **必须幂等**：同一个 `requestId` 重复提交由外壳层的幂等表回放第一次结果；
     * 这里再加一道保险——房间上存了 `settlement`，换一个 `requestId` 重打也只会拿到同一份，
     * **绝不会把 XP 加两次**（弱网重试是现场最常见的坑）。
     */
    async endRoom(ctx) {
      const session = requireSession(ctx.req, db);
      const room = requireRoom(ctx, db);
      assertKnownKeys(
        ctx.body ?? {},
        { allowed: ['durationSec', 'cardsUsed', 'topics'], ignored: ['requestId'] },
        'rooms/end',
      );
      const peerAccountId = room.peerAccountId ?? db.findAccountByPeerId(room.peerUserId);
      if (![room.initiatorAccountId, peerAccountId].includes(session.userId)) throw new ApiError('forbidden', 'not a room participant');
      if (room.settlement) return { data: room.settlements?.[session.userId] ?? room.settlement };
      const durationSec = assertInt(ctx.body?.durationSec, 'durationSec', { min: 0, max: 86400, defaultValue: 0 });
      const cardsUsed = assertInt(ctx.body?.cardsUsed, 'cardsUsed', { min: 0, max: 64, defaultValue: 0 });
      const topics = assertStringArray(ctx.body?.topics ?? [], 'topics', { max: 16 }) ?? [];
      const initiatorRole = room.initiatorRole ?? (room.peerRole === 'buddy' ? 'learner' : 'buddy');
      const result = db.transaction(() => {
        const settlements = {};
        const participants = [...new Set([room.initiatorAccountId, peerAccountId].filter(Boolean))];
        for (const accountId of participants) {
          const role = accountId === room.initiatorAccountId ? initiatorRole : room.peerRole;
          const progress = db.getProgress(accountId) ?? {};
          const before = unlockedAchievements(role, progress);
          const xpEarned = xpFor(durationSec, cardsUsed);
          const minutes = Math.round(durationSec / 60);
          const topicsSeen = uniqueList([...(progress.topicsSeen ?? []), ...topics]);
          db.creditPoints(accountId, xpEarned, 'room:' + room.roomId, 'conversation');
          const next = db.updateProgress(accountId, {
            conversations: (progress.conversations ?? 0) + 1,
            totalMinutes: (progress.totalMinutes ?? 0) + minutes,
            practiceMinutesThisWeek: (progress.practiceMinutesThisWeek ?? 0) + minutes,
            peopleHelped: role === 'buddy' ? (progress.peopleHelped ?? 0) + 1 : (progress.peopleHelped ?? 0),
            topicsSeen,
            distinctTopics: Math.max(progress.distinctTopics ?? 0, topicsSeen.length),
          });
          const unlocked = newlyUnlocked(before, unlockedAchievements(role, next));
          const peerRow = db.findQueueRow(room.peerUserId);
          db.appendHistory(accountId, {
            sessionId: room.roomId,
            peerId: accountId === room.initiatorAccountId ? room.peerUserId : db.getProfile(room.initiatorAccountId, initiatorRole)?.userId,
            peerLabel: accountId === room.initiatorAccountId
              ? (peerRow && !peerRow.anonymous ? (peerRow.displayName ?? room.peerUserId) : null)
              : (peerViewOf(db, room.initiatorAccountId, initiatorRole)?.displayName ?? null),
            role,
            startedAt: room.startedAt ?? iso(now()),
            durationSec,
            cardsUsed,
            topics,
          });
          settlements[accountId] = { durationSec, cardsUsed, xpEarned, unlocked, topics };
        }
        const settlement = settlements[session.userId];
        db.updateRoom(room.roomId, { status: 'ended', endedAt: iso(now()), settlement, settlements });
        return { data: settlement };
      });
      // 完整落盘后通知另一端，弱网重试读取保存的 settlement。
      emit('room:ended', { roomId: room.roomId, durationSec });
      return result;
    },

    /**
     * POST /api/rooms/:roomId/feedback —— 结算第二步的评价。
     * 词表按**被评价的人**是哪种身份来选（学习者是给母语者打分的那个词表）。
     */
    async sendFeedback(ctx) {
      const session = requireSession(ctx.req, db);
      const room = requireRoom(ctx, db);
      assertKnownKeys(ctx.body ?? {}, { allowed: ['tags', 'skipped'], ignored: ['requestId'] }, 'rooms/feedback');

      const peerAccountId = room.peerAccountId ?? db.findAccountByPeerId(room.peerUserId);
      if (![room.initiatorAccountId, peerAccountId].includes(session.userId)) throw new ApiError('forbidden', 'not a room participant');
      const targetId = session.userId === room.initiatorAccountId ? peerAccountId : room.initiatorAccountId;
      const targetRole = session.userId === room.initiatorAccountId ? room.peerRole : (room.initiatorRole ?? (room.peerRole === 'buddy' ? 'learner' : 'buddy'));
      const vocabulary = targetRole === 'buddy' ? LEARNER_FEEDBACK_TAGS : BUDDY_FEEDBACK_TAGS;
      const tags = assertEnumArray(ctx.body?.tags ?? [], vocabulary, 'tags', { max: vocabulary.length }) ?? [];
      const skipped = ctx.body?.skipped === undefined ? false : assertBoolean(ctx.body.skipped, 'skipped');
      if (!skipped && tags.length === 0) {
        throw new ApiError('bad_request', 'tags are required unless skipped is true');
      }

      return db.transaction(() => {
        const attached = db.attachFeedback(session.userId, {
          sessionId: room.roomId,
          peerId: session.userId === room.initiatorAccountId ? room.peerUserId : db.getProfile(targetId, targetRole)?.userId,
          tags,
          skipped: Boolean(skipped),
          at: iso(now()),
        });
        if (!attached) throw new ApiError('not_found', 'no session with this peer to attach feedback to');
        if (!skipped && tags.length && room.settlement?.durationSec >= 60 && targetId && targetId !== session.userId) {
          db.creditPoints(targetId, 10, 'feedback:' + room.roomId + ':' + session.userId, 'feedback');
        }
        return { data: { ok: true } };
      });
    },

    /**
     * POST /api/me/saved-phrases —— 句型收藏（结算 / 房间里点星星）。
     * 前端本地已有兜底：接口挂了也不该让星星点了不变色（契约 4.5 节 + 07 Q-G26）。
     */
    async savePhrase(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(
        ctx.body ?? {},
        { allowed: ['cantonese', 'mandarin', 'phrase', 'roomId'], ignored: ['requestId'] },
        'me/saved-phrases',
      );

      const cantonese = assertString(ctx.body?.cantonese, 'cantonese', { maxLength: 200 }) ?? null;
      const phrase = assertString(ctx.body?.phrase, 'phrase', { maxLength: 400 }) ?? null;
      if (!cantonese && !phrase) {
        throw new ApiError('bad_request', 'cantonese or phrase is required');
      }
      const saved = {
        savedPhraseId: 'sp-' + now().toString(36).slice(-6),
        cantonese,
        mandarin: assertString(ctx.body?.mandarin, 'mandarin', { maxLength: 200 }) ?? null,
        phrase,
        roomId: assertString(ctx.body?.roomId, 'roomId', { maxLength: 120 }) ?? null,
        savedAt: iso(now()),
      };
      db.addSavedPhrase(session.userId, saved);
      return { status: 201, data: { savedPhrase: saved } };
    },

    /** GET /api/rooms/:roomId —— Phase 3 才做，这里先把「房间从哪儿取」明确下来。 */
    async getRoom(ctx) {
      const session = requireSession(ctx.req, db);
      void session;
      const room = db.getRoom(ctx.params.roomId);
      if (!room) throw new ApiError('room_gone', 'room not found: ' + ctx.params.roomId);
      const row = db.findQueueRow(room.peerUserId);
      return {
        data: {
          room,
          peer: row ? cropPeer(row) : null,
          status: room.status,
          startedAt: room.createdAt,
        },
      };
    },
  };
}

/** 取房间；不存在一律 404 `room_gone`——前端据此回匹配大厅 + 一次性提示。 */
function requireRoom(ctx, db) {
  const room = db.getRoom(ctx.params.roomId);
  if (!room) throw new ApiError('room_gone', 'room not found: ' + ctx.params.roomId);
  return room;
}

/** 契约 4.5 节：`level` 缺省时用**学习者**的水平。 */
function learnerLevelOf(db, learnerSide) {
  if (!learnerSide) return null;
  return (
    learnerSide.row?.cantoneseLevel ??
    db.getProfile(learnerSide.accountId, 'learner')?.cantoneseLevel ??
    null
  );
}

/**
 * 学习者那一侧是谁：对方是学习者就是队列行上那位，否则就是开房的发起人。
 * **`accountId` 必须是账号 id**（队列行上的 `ownerAccountId`），进度与资料都按账号存。
 */
function learnerSideOf(room, peerRow) {
  return room.peerRole === 'learner'
    ? { accountId: peerRow?.ownerAccountId ?? null, role: 'learner', row: peerRow }
    : { accountId: room.initiatorAccountId, role: 'learner', row: null };
}

/** 某一侧的兴趣：资料里的为准，队列行上的作为兜底（行是入队那一刻的快照）。 */
function interestsOfSide(db, side) {
  return [
    ...(db.getProfile(side.accountId, side.role)?.interests ?? []),
    ...(side.row?.interests ?? []),
  ];
}

/**
 * 双方兴趣**交集** —— 话题卡只聊两个人都感兴趣的主题。
 *
 * **不是并集**（2026-10-11 用户明确否掉并集）：并集会把「只有其中一方感兴趣」的
 * 主题也发出去，现场表现就是「这张卡跟我/跟 TA 不相干」。交集为空时返回空数组，
 * 由选卡器拿**通用主题**兜底（见 `lib/topics.js` 的第 3 级），绝不退回并集。
 *
 * 每一侧取的是**它在房间里扮演的那个身份**的资料：对方是学习者就取他的 learner 资料，
 * 发起人（此时扮演母语者）就取他的 buddy 资料。一个账号两份人格，取错了就是空数组，
 * 卡会变成跟谁都无关的通用题 —— 这正是上一版的 bug（只取了发起人的 learner 资料）。
 */
function bothSidesSharedInterests(db, room, peerRow) {
  const peerSide = { accountId: peerRow?.ownerAccountId ?? null, role: room.peerRole, row: peerRow };
  const initiatorSide = {
    accountId: room.initiatorAccountId,
    role: room.peerRole === 'learner' ? 'buddy' : 'learner',
    row: null,
  };
  // 用 Set 查交集，但**顺序跟发起人那一侧走**（`uniqueList` 保序），
  // 这样同一个房间两侧算出来的数组逐元素相同，日志与测试都好对照。
  const mine = uniqueList(interestsOfSide(db, initiatorSide));
  const theirs = new Set(uniqueList(interestsOfSide(db, peerSide)));
  return mine.filter((tag) => theirs.has(tag));
}

/** `count` 默认 8（`TopicCardStack` 一次预取一叠），夹在 1 ~ 32 之间。 */
function clampCount(raw) {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) return 8;
  return Math.min(Math.max(Math.floor(value), 1), 32);
}

/** 第几叠：缺省 / 非数字 / 负数一律当第 0 叠，上限 64（防手改 URL 刷出无穷无尽的叠）。 */
function clampRound(raw) {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 64);
}

function clampSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_ACCEPT_SECONDS;
  return Math.min(Math.floor(seconds), MAX_ACCEPT_SECONDS);
}

export { DEFAULT_ACCEPT_SECONDS };

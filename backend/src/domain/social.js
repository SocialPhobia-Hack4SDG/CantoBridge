/**
 * 伙伴关系与沉淀（契约 4.6 / 4.7 节）。
 *
 * 四条容易写错的硬要求，都在这里落地：
 *   1. **发出申请 ≠ 成为伙伴**：POST 只写入一条 pending，接受 / 双向申请才成伙伴；
 *   2. **双方都申请过 = 互相确认**：对方也申请过我时，POST 直接让双方成为伙伴（status: accepted）；
 *   3. **处理完的申请直接移除**：v1 的 status 只有 pending，不留「已拒绝」记录（避免尴尬）；
 *   4. **匿名行连 userId 都换掉**：榜单上 anonymous 的行用「匿名伙伴」占位，
 *      避免从 id 反推身份（契约 4.7 节）。
 *
 * 解除伙伴只删伙伴关系：通话记录、积分、成就全部保留。
 */

import { leaderboardStats } from '../lib/leaderboard.js';
import { ApiError } from '../http/envelope.js';
import { achievementStatistics, publicTitle } from '../lib/achievementTitles.js';
import { requireSession } from '../http/auth.js';
import { ROLES } from '../data/vocabularies.js';
import {
  ANONYMOUS_LABEL,
  LEADERBOARD_LIMIT,
  LEADERBOARD_MIN_SECONDS,
  LEADERBOARD_PERIODS,
} from '../data/leaderboard.js';
import { buddyLevel, unlockedAchievements } from '../lib/scoring.js';
import { assertEnum, assertInt, assertKnownKeys, assertString } from './validate.js';

/** 申请方向的取值（契约 3.6 节之外的补充取值，direction 表）。 */
const DIRECTIONS = ['incoming', 'outgoing'];

/** v1 的申请状态只有 pending（契约 4.6 节：处理完直接移除，不留记录）。 */
const REQUEST_STATUSES = ['pending'];

/** 历史条数上限：演示量级很小，防的是客户端传个巨大 limit 拖垮响应。 */
const MAX_HISTORY_LIMIT = 100;

export function createSocialHandlers({ db, now = () => Date.now() }) {
  function iso(at) {
    return new Date(at).toISOString();
  }

  /** 伙伴对外标签：匿名的人用契约的「匿名伙伴」占位（榜单同款，契约 4.7 节）。 */
  function peerLabelOf(peerId) {
    const row = db.findQueueRow(peerId);
    if (!row) return peerId;
    if (row.anonymous) return ANONYMOUS_LABEL;
    return row.displayName ?? peerId;
  }

  /** 已知伙伴 id：演示池里的队列行（发申请只允许发给真实存在的人）。 */
  function requireKnownPeer(peerId) {
    if (!db.findQueueRow(peerId)) throw new ApiError('not_found', 'peer not found: ' + peerId);
  }

  /* ---------------- 一张申请 = 两边各一行 ---------------- */

  /**
   * 一条申请在**双方各自的表**里各留一行：我这边是 `outgoing`，对方那边是 `incoming`。
   *
   * 为什么要镜像，而不是只写自己这一行：契约 4.6 的 `GET /api/me/buddy-requests` 是
   * 「收到的 + 我发出的」。只写自己那行的话，对面那台设备永远看不到有人申请过他，
   * 也就永远点不了「接受」——两台真机之间这个功能是死的（单账号演示时看不出来，
   * 因为两边本来就是同一个人）。
   */
  function mirrorOf(request, { peerId, direction }) {
    return {
      ...request,
      // 镜像行是另一条记录，id 加后缀区分；`requestId` 只用于幂等回放，形状不变
      requestId: `${request.requestId}:in`,
      peerId,
      label: peerLabelOf(peerId),
      direction,
    };
  }

  /** 我这个身份在别人眼里的 peerId（去对面那张表里找镜像时要按它匹配）。 */
  function myPeerId(session) {
    return db.getProfile(session.userId, session.role)?.userId ?? null;
  }

  /** 成为伙伴（已经是就不重复写一行）。 */
  function addBuddyOnce(accountId, peerId) {
    if (db.isBuddy(accountId, peerId)) return null;
    return db.addBuddy(accountId, { peerId, label: peerLabelOf(peerId), since: iso(now()) });
  }

  /**
   * 一条申请处理完了：把对面那张表里的**镜像**也一起收掉。
   *
   * 不收的话，对面会一直看到「我发出的申请」还挂着（契约 4.6：处理完直接移除，
   * 不留「已拒绝」记录）。对方账号查不到就跳过——对面可能已经没了。
   */
  function dropMirror(session, request) {
    const peerAccountId = db.findAccountByPeerId(request?.peerId);
    const mine = myPeerId(session);
    if (!peerAccountId || !mine || peerAccountId === session.userId) return;
    const opposite = request.direction === 'incoming' ? 'outgoing' : 'incoming';
    db.removeBuddyRequest(peerAccountId, { peerId: mine, direction: opposite });
  }

  return {
    /* ---------------- 伙伴关系（契约 4.6 节） ---------------- */

    /** GET /api/me/buddies —— 已经互相接受的伙伴列表。 */
    async listBuddies(ctx) {
      const session = requireSession(ctx.req, db);
      return { data: { buddies: db.listBuddies(session.userId) } };
    },

    /** DELETE /api/me/buddies/:peerId —— 解除伙伴（只删关系，历史与积分保留）。 */
    async removeBuddy(ctx) {
      const session = requireSession(ctx.req, db);
      if (!db.removeBuddy(session.userId, ctx.params.peerId)) {
        throw new ApiError('not_found', 'not a buddy: ' + ctx.params.peerId);
      }
      return { data: { ok: true } };
    },

    /**
     * GET /api/me/buddy-requests —— 收到的 + 我发出的（`direction` 可选过滤）。
     * v1 的 `status` 只有 pending，参数留着是为了形状稳定。
     */
    async listBuddyRequests(ctx) {
      const session = requireSession(ctx.req, db);
      const direction = assertEnum(ctx.query.get('direction') ?? undefined, DIRECTIONS, 'direction') ?? null;
      const status = assertEnum(ctx.query.get('status') ?? undefined, REQUEST_STATUSES, 'status') ?? null;
      return {
        data: { requests: db.listBuddyRequests(session.userId, { direction, status }) },
      };
    },

    /**
     * POST /api/me/buddy-requests —— 发出申请。
     *
     * 三种结局（契约 4.6 节）：
     *   - 已是伙伴 → 幂等返回 `status: buddy`（200，不走异常分支）；
     *   - 对方也申请过我 → 双方自动成为伙伴，`status: accepted`；
     *   - 否则 → 写入一条 pending，`status: pending`；重复发给同一个人幂等返回。
     */
    async sendBuddyRequest(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(ctx.body ?? {}, { allowed: ['peerId', 'roomId'], ignored: ['requestId'] }, 'me/buddy-requests');

      const peerId = assertString(ctx.body?.peerId, 'peerId', { maxLength: 60 });
      if (!peerId) throw new ApiError('bad_request', 'peerId is required');
      requireKnownPeer(peerId);
      const roomId = assertString(ctx.body?.roomId, 'roomId', { maxLength: 120 }) ?? null;

      if (db.isBuddy(session.userId, peerId)) {
        return { data: { request: null, status: 'buddy' } };
      }

      // 对方也申请过我：双方自动成为伙伴，不要再要求任何一方点接受
      const incoming = db.findBuddyRequest(session.userId, { peerId, direction: 'incoming' });
      if (incoming) {
        const mine = myPeerId(session);
        const peerAccountId = db.findAccountByPeerId(peerId);
        db.removeBuddyRequest(session.userId, { peerId, direction: 'incoming' });
        addBuddyOnce(session.userId, peerId);
        // 互相确认是**两边同时成伙伴**：对面那条「我发出的」也一起收掉，
        // 并且他那边也要长出这段伙伴关系——否则他会一直以为申请还悬着
        if (peerAccountId && mine && peerAccountId !== session.userId) {
          db.removeBuddyRequest(peerAccountId, { peerId: mine, direction: 'outgoing' });
          addBuddyOnce(peerAccountId, mine);
        }
        return { data: { request: null, status: 'accepted' } };
      }

      // 已经给同一个人发过：幂等返回那一条，不重复入表
      const outgoing = db.findBuddyRequest(session.userId, { peerId, direction: 'outgoing' });
      if (outgoing) return { data: { request: outgoing, status: 'pending' } };

      const request = {
        requestId: 'req-' + now().toString(36) + '-' + peerId,
        peerId,
        label: peerLabelOf(peerId),
        direction: 'outgoing',
        status: 'pending',
        roomId,
        createdAt: iso(now()),
        respondedAt: null,
      };
      db.addBuddyRequest(session.userId, request);

      // 镜像到对方那张表：他那边显示成「收到的申请」，才点得了接受 / 拒绝
      const mine = myPeerId(session);
      const peerAccountId = db.findAccountByPeerId(peerId);
      if (mine && peerAccountId && peerAccountId !== session.userId) {
        db.addBuddyRequest(peerAccountId, mirrorOf(request, { peerId: mine, direction: 'incoming' }));
      }

      return { status: 201, data: { request, status: 'pending' } };
    },

    /**
     * POST /api/me/buddy-requests/:peerId/accept —— 接受收到的申请。
     * 处理完申请直接移除（v1 不留记录）；没有这条申请 → 404。
     */
    async acceptBuddyRequest(ctx) {
      const session = requireSession(ctx.req, db);
      const request = db.removeBuddyRequest(session.userId, {
        peerId: ctx.params.peerId,
        direction: 'incoming',
      });
      if (!request) throw new ApiError('not_found', 'no incoming request from ' + ctx.params.peerId);

      dropMirror(session, request);
      // 同一个人可能被接受过两次：申请处理完就删，重复申请再接受会走到这里。
      // 用 addBuddyOnce 兜底：已经是伙伴就返回原有那行，不再重复写一行。
      const buddy =
        addBuddyOnce(session.userId, request.peerId) ??
        db.listBuddies(session.userId).find((item) => item.peerId === request.peerId) ??
        null;
      return { data: { buddy, request: null } };
    },

    /** POST /api/me/buddy-requests/:peerId/decline —— 拒绝：移除申请，ok。 */
    async declineBuddyRequest(ctx) {
      const session = requireSession(ctx.req, db);
      const request = db.removeBuddyRequest(session.userId, {
        peerId: ctx.params.peerId,
        direction: 'incoming',
      });
      if (!request) throw new ApiError('not_found', 'no incoming request from ' + ctx.params.peerId);
      dropMirror(session, request);
      return { data: { ok: true } };
    },

    /** DELETE /api/me/buddy-requests/:peerId —— 撤回我发出的申请。 */
    async cancelBuddyRequest(ctx) {
      const session = requireSession(ctx.req, db);
      const request = db.removeBuddyRequest(session.userId, {
        peerId: ctx.params.peerId,
        direction: 'outgoing',
      });
      if (!request) throw new ApiError('not_found', 'no outgoing request to ' + ctx.params.peerId);
      dropMirror(session, request);
      return { data: { ok: true } };
    },

    /* ---------------- 沉淀（契约 4.7 节） ---------------- */

    /**
     * GET /api/me/progress —— 扁平对象（不包一层，契约 2.10 的形状转换表）。
     * `achievements` 是当前身份**已解锁**的全量 id；`buddyLevel` 服务端算，
     * 规则与前端纯函数同源（`lib/scoring.js`，两边算不出两个等级）。
     */
    async getProgress(ctx) {
      const session = requireSession(ctx.req, db);
      const progress = db.getProgress(session.userId) ?? {};
      return {
        data: {
          xp: progress.xp ?? 0,
          streakDays: progress.streakDays ?? 0,
          totalMinutes: progress.totalMinutes ?? 0,
          conversations: progress.conversations ?? 0,
          peopleHelped: progress.peopleHelped ?? 0,
          distinctTopics: progress.distinctTopics ?? 0,
          practiceMinutesThisWeek: progress.practiceMinutesThisWeek ?? 0,
          achievements: unlockedAchievements(session.role, progress),
          achievementStats: achievementStatistics(db),
          equippedTitleId: publicTitle(db, session.userId),
          buddyLevel: buddyLevel(progress),
        },
      };
    },

    /** GET /api/me/history —— 连线记录；`buddyOnly` 只看现在还是伙伴的，`limit` 夹 1~100。 */
    async getHistory(ctx) {
      const session = requireSession(ctx.req, db);
      const buddyOnly = ['true', '1'].includes(String(ctx.query.get('buddyOnly') ?? ''));
      const rawLimit = ctx.query.get('limit');
      const limit = assertInt(
        rawLimit === null || rawLimit === '' ? undefined : Number(rawLimit),
        'limit',
        { min: 1, max: MAX_HISTORY_LIMIT, defaultValue: MAX_HISTORY_LIMIT },
      );
      return {
        data: { entries: db.listHistory(session.userId, { buddyOnly, limit }) },
      };
    },

    /**
     * GET /api/leaderboard —— 周榜 / 月榜 × 学习者 / 母语者。
     *
     * **从真实账号的进度现场算**，没有任何预置行：遍历 `db.listProgress()`，
     * 对应身份在该周期内累计通话满 30 秒才上榜。名次按 xp 降序，取前 `LEADERBOARD_LIMIT` 名。
     *
     * 匿名规则与契约 4.7 一致：`settings.anonymous` 打开、或关掉了 `leaderboardVisible`，
     * 这一行就显示成「匿名伙伴」——连 `userId` 都不下发，避免从 id 反推身份。
     */
    async getLeaderboard(ctx) {
      const session = requireSession(ctx.req, db);
      const period = assertEnum(ctx.query.get('period') ?? 'weekly', LEADERBOARD_PERIODS, 'period');
      const role = assertEnum(ctx.query.get('role') ?? 'learner', ROLES, 'role');

      const rows = [];
      for (const progress of db.listProgress()) {
        const accountId = progress.accountId;
        const stats = leaderboardStats(db.listHistory(accountId), role, period, now());
        if (stats.seconds < LEADERBOARD_MIN_SECONDS) continue;
        // 这个账号在这一张榜上是谁：一个账号两种身份，取它对应的那份资料
        const profile = db.getProfile(accountId, role);
        if (!profile) continue;
        const settings = db.getSettings(accountId) ?? {};
        const anonymous = Boolean(settings.anonymous) || settings.leaderboardVisible === false;
        rows.push({
          accountId,
          name: db.getUser(accountId)?.displayName ?? profile.userId,
          anonymous,
          avatarId: anonymous ? 'neutral' : (db.getUser(accountId)?.avatarId ?? 'neutral'),
          frameId: anonymous ? 'none' : (db.getUser(accountId)?.frameId ?? 'none'),
          minutes: stats.minutes,
          xp: stats.xp,
          seconds: stats.seconds,
        });
      }

      rows.sort((a, b) => b.xp - a.xp || b.seconds - a.seconds || a.accountId.localeCompare(b.accountId));
      const entries = rows.slice(0, LEADERBOARD_LIMIT).map((row, index) => ({
        rank: index + 1,
        userId: row.anonymous ? ANONYMOUS_LABEL : row.name,
        anonymous: row.anonymous,
        avatarId: row.avatarId,
        frameId: row.frameId,
        minutes: row.minutes,
        xp: row.xp,
        isMe: row.accountId === session.userId,
      }));
      return { data: { entries } };
    },

    /* ---------------- 演示口子（契约外，只在本地开） ---------------- */

    /**
     * POST /api/dev/buddy-request —— 模拟「收到一条伙伴申请」。
     *
     * 真实环境里申请由对方账号发起；单账号演示时用它预置/复现「收到的」申请，
     * 前端 mock 层的 `receiveBuddyRequest(peerId, label)` 对应的就是它。
     */
    async createDemoBuddyRequest(ctx) {
      const session = requireSession(ctx.req, db);
      assertKnownKeys(
        ctx.body ?? {},
        { allowed: ['peerId'], ignored: ['requestId', 'label', 'roomId'] },
        'dev/buddy-request',
      );

      let peerId = ctx.body?.peerId ?? null;
      if (!peerId) {
        // 缺省挑一位相反身份、还没被摘走的演示伙伴
        const wantRole = session.role === 'buddy' ? 'learner' : 'buddy';
        peerId = db.listQueue({ role: wantRole, unclaimedOnly: true })[0]?.userId ?? null;
      }
      if (!peerId) throw new ApiError('not_found', 'no available peer');
      requireKnownPeer(peerId);

      // 已经有一条同一个人的「收到」申请就不重复造（幂等友好）
      const existing = db.findBuddyRequest(session.userId, { peerId, direction: 'incoming' });
      if (existing) return { data: { request: existing } };

      const request = {
        requestId: 'req-' + now().toString(36) + '-' + peerId,
        peerId,
        label: peerLabelOf(peerId),
        direction: 'incoming',
        status: 'pending',
        roomId: null,
        createdAt: iso(now()),
        respondedAt: null,
      };
      db.addBuddyRequest(session.userId, request);
      return { status: 201, data: { request } };
    },
  };
}

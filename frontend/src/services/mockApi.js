/**
 * Mock API：与 docs/09 第 4.2 节的 service 函数一一对应。
 * 组件永远看不到它：页面只依赖 services/index.js 暴露的同名函数。
 * 这里把 store 当作「服务端数据库」，因此换真实后端时只需替换本文件。
 *
 * ## 候选池是**注入**的，默认空
 *
 * 这个文件以前自带 4 位假学习者 + 3 位假母语者（`src/data/fixtures.js`）。全删了，
 * 理由和清空后端种子是同一条：**列表里必须只有真实注册的人**。假人没有对应的设备在等，
 * 对面点了「开始」本机照样成房，但另一端永远收不到 `match:matched` —— 现场表现就是
 * 「两台设备连不上」，而且当场看不出来。
 *
 * 所以默认池子 `EMPTY_CANDIDATES` 是空的：纯 mock 档位（`?api=mock`）打开就是一个
 * 没有人的世界，页面走空态。需要「有人的世界」的只有测试，由测试显式注入
 * （见 `tests/helpers/demoPool.mjs`）——**演示数据只活在测试里**。
 */

import {
  LEARNER_WANT_TO_LEARN,
  buddyLevel,
  buddyRelation,
  complementLanguage,
  intentForRole,
  matchRank,
  matchScore,
  peerDisplayName,
  sharedTags,
  uniqueList,
} from '../lib/logic.js';
import { leaderboardStats } from '../lib/leaderboard.js';
import { pickCards, seedFrom } from '../lib/topicPicker.js';
import { FRAMES, LEGACY_FRAME_IDS, ownedFrames } from '../data/frames.js';
import { ownedAvatars, AVATARS } from '../data/avatars.js';
import { SHOP_CATALOG } from '../data/shop.js';
import { ACHIEVEMENT_CATALOG } from '../data/achievements.js';
import { unlockedAchievements } from '../lib/logic.js';
import {
  IDENTITIES,
  INTERESTS,
  LEARNING_GOALS,
  LEVELS,
  NATIVE_LANGUAGES,
  BUDDY_TOPICS,
} from '../data/tags.js';

const ANONYMOUS_LABEL = '匿名用户';

/**
 * 空候选池：没有后端时「谁都还没注册」的真实样子。
 * `learners` = 正在等伙伴的人（母语者视角），`buddies` = 此刻可聊的粤语母语者（学习者视角）。
 */
export const EMPTY_CANDIDATES = { learners: [], buddies: [] };

/** 模拟一个「服务端」错误，前端按 code 走降级。 */
export class ApiError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

export function createMockApi({ store, sleep, candidates = EMPTY_CANDIDATES } = {}) {
  function validateAvatarPatch(patch) {
    if (patch.frameId !== undefined) {
      if (!FRAMES.some(item => item.id === patch.frameId) && !LEGACY_FRAME_IDS.includes(patch.frameId)) throw new ApiError('bad_request', 'unknown frame');
      if (!ownedFrames(store.getState().progress.wallet).includes(patch.frameId)) throw new ApiError('forbidden', 'frame is locked');
    }
    if (patch.avatarId === undefined) return;
    if (!AVATARS.some(item => item.id === patch.avatarId)) throw new ApiError('bad_request', 'unknown avatar');
    if (!ownedAvatars(store.getState().progress.wallet).includes(patch.avatarId)) throw new ApiError('forbidden', 'avatar is locked');
  }
  const claimed = new Set();
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pool = {
    learners: candidates?.learners ?? [],
    buddies: candidates?.buddies ?? [],
  };

  async function respond(value) {
    const delay = store.getState().settings.mockDelayMs ?? 0;
    if (delay > 0) await wait(delay);
    return value;
  }

  function currentProfile() {
    const state = store.getState();
    return state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
  }

  /**
   * 挑一位候选伙伴（优先还没建立任何关系的，方便每场演示都走一遍发出申请）。
   * 池子空的时候**抛错而不是编一个人**：真后端在没有候选时也是 404 / 409，
   * 编一个人出来只会让「两台设备连不上」这个 bug 继续藏下去。
   */
  function pickDemoBuddy() {
    const social = store.getState().social;
    const buddy =
      pool.buddies.find((item) => buddyRelation(item.userId, social).state === 'none') ?? pool.buddies[0];
    if (!buddy) throw new ApiError('no_candidate', 'no waiting buddy');
    return {
      peerId: buddy.userId,
      anonymous: Boolean(buddy.anonymous),
      avatarId: buddy?.anonymous ? 'neutral' : (buddy?.avatarId ?? 'neutral'),
      frameId: buddy?.anonymous ? 'none' : (buddy?.frameId ?? 'none'),
      displayName: peerDisplayName(buddy, ANONYMOUS_LABEL),
      nativeLanguage: buddy.nativeLanguage,
      cantoneseLevel: null,
      identity: buddy.identity,
      interests: uniqueList(buddy.interests),
      intent: intentForRole(buddy.role),
      goal: null,
      native: true,
    };
  }

  /** 匿名 + 公开范围裁剪，前端不信任后端是否已裁剪，因此这里就做一遍。 */
  function publicView(entry) {
    const visibility = store.getState().settings.visibility;
    const anonymous = Boolean(entry.anonymous);
    return {
      peerId: entry.userId,
      equippedTitleId: entry.equippedTitleId ?? null,
      avatarId: entry.anonymous ? 'neutral' : (entry.avatarId ?? 'neutral'),
      frameId: entry.anonymous ? 'none' : (entry.frameId ?? 'none'),
      anonymous,
      displayName: peerDisplayName(entry, ANONYMOUS_LABEL),
      nativeLanguage: entry.nativeLanguage,
      cantoneseLevel: entry.cantoneseLevel,
      identity: visibility.identity === false ? null : entry.identity,
      interests: visibility.interests === false ? [] : uniqueList(entry.interests),
      // 教 / 学 标签按对方身份**派生**（粤语母语者 = 教粤语，学习者 = 学粤语），
      // 不随 visibility.interests 裁剪：藏了它，对面就不知道这位站哪一边。
      intent: intentForRole(entry.role),
      goal: entry.goal ?? null,
    };
  }

  /**
   * 母语者出现在学习者端的公开样子（首页推荐块）。裁剪规则与 publicView 一致：
   * 匿名换名、可见范围关掉就不下发。wantToLearn 一定要给出去——
   * 学习者的「语言互补」徽标全靠它，藏了这块功能就白做了。
   */
  function buddyPublicView(entry) {
    const visibility = store.getState().settings.visibility;
    return {
      peerId: entry.userId,
      equippedTitleId: entry.equippedTitleId ?? null,
      avatarId: entry.anonymous ? 'neutral' : (entry.avatarId ?? 'neutral'),
      frameId: entry.anonymous ? 'none' : (entry.frameId ?? 'none'),
      anonymous: Boolean(entry.anonymous),
      displayName: peerDisplayName(entry, ANONYMOUS_LABEL),
      nativeLanguage: entry.nativeLanguage,
      languagesSpoken: uniqueList(entry.languagesSpoken),
      identity: visibility.identity === false ? null : entry.identity,
      interests: visibility.interests === false ? [] : uniqueList(entry.interests),
      intent: intentForRole(entry.role),
      wantToLearn: uniqueList(entry.wantToLearn),
    };
  }

  /**
   * 给候选人算「互补」这三个字段。两个方向共用一处实现，避免两边各判一套：
   *   - 母语者看学习者：学习者母语 ∈ 我的 wantToLearn（排序真正生效的方向）；
   *   - 学习者看母语者：把参数对调，问「这位母语者想练的是不是我的母语」。
   * 只加权不筛选：没命中的候选人照样返回，只是 complement = false。
   */
  function withComplement(entry, wantToLearn, peerNativeLanguages) {
    const hit = complementLanguage(wantToLearn, peerNativeLanguages);
    return { ...entry, complement: Boolean(hit), complementLanguage: hit };
  }

  return {
    /* ---------- 账号与资料 ---------- */
    async signIn(role) {
      store.setRole(role);
      return respond({ userId: currentProfile().userId, role });
    },

    async signInWithCredentials(role) {
      return this.signIn(role);
    },

    async refreshToken() {
      return respond({ token: 'mock-token', expiresAt: null });
    },

    async signOut() {
      return respond({ ok: true });
    },

    async getMe() {
      const state = store.getState();
      return respond({
        learnerProfile: state.learnerProfile,
        buddyProfile: state.buddyProfile,
        settings: state.settings,
      });
    },

    async saveLearnerProfile(patch) {
      validateAvatarPatch(patch);
      store.saveRoleProfile('learner', patch);
      return respond(store.getState().learnerProfile);
    },

    async saveBuddyProfile(patch) {
      validateAvatarPatch(patch);
      store.saveRoleProfile('buddy', patch);
      return respond(store.getState().buddyProfile);
    },

    async saveSettings(patch) {
      if (patch.equippedTitleId != null && !['learner', 'buddy'].some(role => unlockedAchievements(role, store.stats()).includes(patch.equippedTitleId))) {
        throw new ApiError('bad_request', 'Title must be unlocked before equipping');
      }
      store.saveSettings(patch);
      return respond(store.getState().settings);
    },
    async getShop() {
      const progress = store.getState().progress;
      const wallet = progress.wallet ?? { balance: progress.xp, ownedThemes: ['mint', 'warm'], transactions: [] };
      return respond({ ...wallet, ownedAvatars: ownedAvatars(wallet), ownedFrames: ownedFrames(wallet), catalog: SHOP_CATALOG });
    },
    async redeemShopItem(itemId) {
      const item = SHOP_CATALOG.find((row) => row.id === itemId);
      if (!item) throw new ApiError('bad_request', 'unknown shop item');
      const progress = store.getState().progress;
      const wallet = structuredClone(progress.wallet ?? { balance: progress.xp, ownedThemes: ['mint', 'warm'], transactions: [] });
      wallet.ownedAvatars = ownedAvatars(wallet);
      wallet.ownedFrames = ownedFrames(wallet);
      const owned = item.type === 'frame' ? wallet.ownedFrames : item.type === 'avatar' ? wallet.ownedAvatars : wallet.ownedThemes;
      const value = item.type === 'frame' ? item.frameId : item.type === 'avatar' ? item.avatarId : item.theme;
      if (!owned.includes(value)) {
        if (wallet.balance < item.price) throw new ApiError('bad_request', 'insufficient points');
        wallet.balance -= item.price;
        owned.push(value);
        wallet.transactions.unshift({ id: 'redeem:' + itemId, kind: 'redeem', amount: -item.price, at: new Date().toISOString() });
        store.hydrateWallet(wallet);
      }
      return respond({ ...wallet, catalog: SHOP_CATALOG });
    },

    async getTags() {
      return respond({
        identities: IDENTITIES,
        interests: INTERESTS,
        goals: LEARNING_GOALS,
        buddyTopics: BUDDY_TOPICS,
        levels: LEVELS,
        nativeLanguages: NATIVE_LANGUAGES,
      });
    },

    /* ---------- 手动匹配 ---------- */
    async joinQueue() {
      const state = store.getState();
      store.startQueue({ anonymous: state.settings.anonymous });
      const queue = store.getState().runtime.queue;
      return respond({ queueEntryId: 'q-' + queue.joinedAt, joinedAt: queue.joinedAt });
    },

    async leaveQueue() {
      store.cancelQueue();
      return respond({ ok: true });
    },

    /**
     * 更新自定义匹配条件。传 null = 清掉自定义，回到「按资料里的兴趣找」。
     * 真实实现里这是服务端保存的匹配偏好，前端只负责送上去；mock 写进 settings（会被持久化）。
     */
    async updateMatchCriteria(criteria) {
      const next = criteria === null || criteria === undefined ? null : uniqueList(criteria);
      store.saveSettings({ matchCriteria: next });
      return respond({ ok: true, criteria: next });
    },

    /** 母语者视角：拉取正在等待的学习者，含匹配度。 */
    async listWaitingLearners() {
      const profile = currentProfile();
      const myTags = [...(profile.interests ?? []), ...(profile.preferredTopics ?? [])];
      // 排序加一层「语言互补」（B）：只决定顺序，不决定谁可见
      const viewer = { wantToLearn: profile.wantToLearn ?? [] };
      const entries = pool.learners.filter((entry) => !claimed.has(entry.userId)).map((entry) => {
        const view = publicView(entry);
        const peerTags = [...view.interests, entry.goal].filter(Boolean);
        return withComplement(
          {
            ...view,
            nativeLanguages: uniqueList([view.nativeLanguage]),
            matchScore: matchScore(myTags, peerTags),
            matchedTags: sharedTags(myTags, peerTags),
            topics: view.interests,
          },
          viewer.wantToLearn,
          uniqueList([view.nativeLanguage]),
        );
      });
      entries.sort((a, b) => matchRank(b, viewer) - matchRank(a, viewer));
      return respond(entries);
    },

    /**
     * 学习者视角：此刻可聊的粤语母语者（C 的首页推荐块）。
     * 与 listWaitingLearners 对称，只是把「谁在等」换成「谁有空」；
     * 排序同样走 matchRank——学习者的 wantToLearn 恒为粤语，
     * 于是每位粤语母语者拿到的加成一样，最终顺序仍是 matchScore 降序（排序不变）。
     */
    async listRecommendedBuddies() {
      const profile = currentProfile();
      const myTags = uniqueList(profile.interests);
      const viewer = { wantToLearn: LEARNER_WANT_TO_LEARN };
      const entries = pool.buddies.filter((entry) => !claimed.has(entry.userId)).map((entry) => {
        const view = buddyPublicView(entry);
        // 徽标问的是反方向：「这位母语者想练的，是不是我的母语」
        return withComplement(
          {
            ...view,
            nativeLanguages: uniqueList([view.nativeLanguage]),
            matchScore: matchScore(myTags, view.interests),
            matchedTags: sharedTags(myTags, view.interests),
          },
          view.wantToLearn,
          uniqueList([profile.nativeLanguage]),
        );
      });
      entries.sort((a, b) => matchRank(b, viewer) - matchRank(a, viewer));
      return respond(entries);
    },

    async getCandidate(learnerId) {
      const entry = pool.learners.find((item) => item.userId === learnerId);
      if (!entry) throw new ApiError('not_found', 'candidate not found');
      const view = publicView(entry);
      const profile = currentProfile();
      const myTags = [...(profile.interests ?? []), ...(profile.preferredTopics ?? [])];
      const peerTags = [...view.interests, entry.goal].filter(Boolean);
      const matched = sharedTags(myTags, peerTags);
      const languages = uniqueList([view.nativeLanguage]);
      return respond({
        ...withComplement(
          {
            ...view,
            nativeLanguages: languages,
            matchScore: matchScore(myTags, peerTags),
            matchedTags: matched,
            topics: view.interests,
            reason: matched,
            roomAvailable: !claimed.has(entry.userId),
          },
          profile.wantToLearn ?? [],
          languages,
        ),
      });
    },

    /** 成房：已被别人挑走时抛 409，模拟服务端的原子性保证。 */
    async createRoom(learnerId) {
      if (claimed.has(learnerId)) throw new ApiError('room_taken', 'room already claimed');
      claimed.add(learnerId);
      const entry = pool.learners.find((item) => item.userId === learnerId);
      if (!entry) throw new ApiError('not_found', 'candidate not found');
      const peer = publicView(entry);
      const roomId = 'r-' + learnerId + '-' + store.now().toString().slice(-5);
      store.startRoom({ roomId, peer, role: 'buddy' });
      return respond({ roomId, peer, expiresAt: null });
    },

    /**
     * 学习者主动开聊（C 的「一键配对」）：首页推荐块点「直接聊」＝直接成房，
     * 与母语者那边的 createRoom 是同一件事，只是发起人换成学习者，
     * 因此原子性规则完全一致——同一位伙伴只能被摘走一次，第二次 409。
     */
    async createRoomWithBuddy(buddyId) {
      if (claimed.has(buddyId)) throw new ApiError('room_taken', 'buddy already taken');
      const entry = pool.buddies.find((item) => item.userId === buddyId);
      if (!entry) throw new ApiError('not_found', 'buddy not found');
      claimed.add(buddyId);
      const peer = buddyPublicView(entry);
      const roomId = 'r-' + buddyId + '-' + store.now().toString().slice(-5);
      store.startRoom({ roomId, peer, role: 'learner' });
      return respond({ roomId, peer, expiresAt: null });
    },

    /**
     * 演示辅助（仅 mock 层，不属于 docs/09 的接口契约）：
     * 替服务端造一条 **match:matched** 事件。
     *
     * 学习者侧只产出一条「待接受」的匹配请求（右上角 `MatchAcceptToast` 接管），
     * 接受之后才成房——这样现场能完整演一遍「倒计时内点接受」。
     * 母语者侧仍然等价于挑走第一位等待者（挑人本来就是母语者发起的动作）。
     */
    async requestMatch({ reason = 'demo' } = {}) {
      const state = store.getState();
      if (state.role === 'buddy') {
        const entry = pool.learners.find((item) => !claimed.has(item.userId));
        if (!entry) throw new ApiError('no_candidate', 'no waiting learner');
        return this.createRoom(entry.userId);
      }
      const peer = pickDemoBuddy();
      const roomId = 'r-demo-' + store.now().toString().slice(-5);
      const acceptSeconds = Number(state.settings.matchAcceptSeconds) || 10;
      const expiresAt = store.now() + acceptSeconds * 1000;
      const result = store.receiveMatchRequest({ roomId, peer, expiresAt, reason });
      // 已经有待接受请求时 store 会拒绝覆盖：返回**仍然生效的那一条**，
      // 否则后台定时器每秒钟都会造出一个新房间号，弹窗也会被反复重建。
      const active = store.getState().runtime.matchRequest ?? { roomId, peer, expiresAt };
      return respond({
        status: result.status,
        roomId: active.roomId,
        peer: active.peer,
        expiresAt: active.expiresAt,
        acceptSeconds,
      });
    },

    /** 接受匹配 → 直接成房（真实契约：`/api/match/requests/:requestId/accept`）。 */
    async acceptMatchRequest() {
      return respond(store.acceptMatchRequest());
    },

    /** 不接受（或倒计时到点）→ 回到等待队列（真实契约：`/api/match/requests/:requestId/decline`）。 */
    async declineMatchRequest({ expired = false } = {}) {
      return respond(store.declineMatchRequest({ expired }));
    },

    async getRoom(roomId) {
      const room = store.getState().runtime.room;
      if (!room || room.roomId !== roomId) throw new ApiError('room_gone', 'room not found');
      return respond({ room });
    },

    /**
     * 话题卡：真实接口的等价物，参数来自学习者水平与双方兴趣交集。
     * 洗牌种子与后端同源（`房间号 + 第几叠`），所以 mock 档位下「换一叠」一样换得掉。
     */
    async getCards(roomId, { interests = [], level, round = 0, exclude = [] } = {}) {
      const state = store.getState();
      const effectiveLevel = state.settings.cardLevelOverride ?? level ?? 'beginner';
      const cards = pickCards({
        level: effectiveLevel,
        interests,
        seenCards: exclude,
        count: 8,
        seed: seedFrom(String(roomId ?? 'preview') + ':' + round),
      });
      return respond({ roomId, level: effectiveLevel, round, cards });
    },

    async endRoom(roomId, { durationSec, cardsUsed, topics = [], peerId, peerLabel } = {}) {
      store.endRoom();
      const result = store.recordSession({
        peerId: peerId ?? 'unknown',
        peerLabel: peerLabel ?? ANONYMOUS_LABEL,
        durationSec,
        cardsUsed,
        topics,
        role: store.getState().runtime.room?.role ?? store.getState().role,
      });
      return respond({
        durationSec,
        cardsUsed,
        xpEarned: result.xpEarned,
        unlocked: result.unlocked,
        topics,
      });
    },

    async sendFeedback(roomId, { tags = [], skipped = false } = {}) {
      store.setNotice({ kind: 'feedback', tags, skipped });
      return respond({ ok: true });
    },

    /* ---------- 伙伴关系（双向申请） ---------- */

    async listBuddies() {
      return respond([...(store.getState().social.buddies ?? [])]);
    },

    async listBuddyRequests() {
      return respond([...(store.getState().social.buddyRequests ?? [])]);
    },

    /** 发出伙伴申请：对方接受之后才会出现在「我的伙伴」里。 */
    async sendBuddyRequest(peerId, label, { roomId = null } = {}) {
      const result = store.sendBuddyRequest(peerId, label, { roomId });
      return respond(result);
    },

    async acceptBuddyRequest(peerId) {
      return respond(store.acceptBuddyRequest(peerId));
    },

    async declineBuddyRequest(peerId) {
      return respond(store.declineBuddyRequest(peerId));
    },

    async cancelBuddyRequest(peerId) {
      return respond(store.cancelBuddyRequest(peerId));
    },

    async removeBuddy(peerId) {
      return respond(store.removeBuddy(peerId));
    },

    /**
     * 演示辅助（仅 mock 层，不属于 docs/09 的接口契约）：
     * 现场没有第二个人，用它在 /dev/mock 一键造出一条「收到的申请」。
     */
    async receiveBuddyRequest(peerId, label) {
      return respond(store.receiveBuddyRequest(peerId, label));
    },

    async savePhrase(phrase) {
      store.savePhrase(phrase);
      return respond({ ok: true });
    },

    /* ---------- 沉淀 ---------- */
    async getProgress() {
      const state = store.getState();
      const stats = store.stats();
      return respond({
        ...stats,
        xp: state.progress.xp,
        practiceMinutesThisWeek: state.progress.practiceMinutesThisWeek,
        buddyLevel: buddyLevel(stats),
        achievements: state.progress.achievements ?? [],
        equippedTitleId: state.settings.equippedTitleId ?? null,
        achievementStats: Object.fromEntries(ACHIEVEMENT_CATALOG.map(item => {
          const count = ['learner', 'buddy'].some(role => unlockedAchievements(role, stats).includes(item.id)) ? 1 : 0;
          return [item.id, { count, totalUsers: 1, percentage: count ? 100 : 0.01 }];
        })),
      });
    },

    async getHistory() {
      const state = store.getState();
      return respond([...(state.social.history ?? [])]);
    },

    /**
     * 榜单：**只有本机这一行**。
     *
     * 以前这里读的是写死的四组假榜单，于是新注册的人在榜上排第 5，前面四位都是编的。
     * 现在按「服务端真会返回什么」来算：mock 层只认识本机账号一个账号，
     * 该身份在该周期内累计通话满 30 秒才返回自己；真后端按同一门槛筛选后取 XP 前 30 名。
     *
     * `period` 只影响后端统计窗口，本机这一行在 mock 里没有历史窗口之分，
     * 照样返回——形状对得上，页面不用分支。
     */
    async getLeaderboard(period = 'weekly', role = 'learner') {
      const state = store.getState();
      const profile = role === 'buddy' ? state.buddyProfile : state.learnerProfile;
      const meId = profile.userId;
      const stats = leaderboardStats(state.social.history ?? [], role, period, store.now());
      if (stats.seconds < 30) return respond([]);
      // 匿名是**实时读设置**，不落库：用户在设置里一开，榜单上立刻打码。
      const anonymous = Boolean(state.settings.anonymous) || state.settings.leaderboardVisible === false;
      return respond([
        {
          rank: 1,
          userId: anonymous ? ANONYMOUS_LABEL : meId,
          anonymous,
          avatarId: anonymous ? 'neutral' : profile.avatarId,
          frameId: anonymous ? 'none' : (profile.frameId ?? 'none'),
          minutes: stats.minutes,
          xp: stats.xp,
          isMe: true,
        },
      ]);
    },

    /* ---------- 基础设施 ---------- */
    async getIceServers() {
      return respond({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], expiresAt: null });
    },

    async checkVersionPolicy() {
      return respond({ minVersion: '0.1.0', message: '', forceUpgrade: false });
    },
  };
}

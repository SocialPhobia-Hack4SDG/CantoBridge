/**
 * 真实现：38 个方法与 `mockApi.js` **同名同参**，页面完全不知道自己拿的是谁。
 *
 * 结构：`http.js`（发请求、拆信封、错误码） + `adapters.js`（形状翻译） → 本文件（方法映射）。
 *
 * **混血降级**：后端还没做的接口原样转发给 `fallback`（通常是 mock 实现），这样页面在「半真」
 * 档位下全程可用——`docs/09` 第 4.1 节的三档就是这么落地的：接口做到哪儿，真数据就走到哪儿。
 * 现在只剩 3 个（正式登录 / 刷新 / 版本策略），清单见 `FALLBACK_METHODS`。
 */

import { ApiError, createMockApi } from './mockApi.js';
import { createHttpClient } from './http.js';
import {
  isoToMs,
  toBuddies,
  toBuddyRequests,
  toCandidate,
  toEntries,
  toMatchRequest,
  toProfile,
  toProgress,
  toQueueEntry,
  toRoom,
  toRoomRecord,
  toSettings,
  toSettingsPatch,
  toSettlement,
} from './adapters.js';

/** 走真后端的 35 个方法（后端已实现 32 个契约端点 + 3 个契约外的演示口子）。 */
export const HTTP_METHODS = [
  'generateTopicCards',
  'replyToTutor',
  'signIn',
  'signOut',
  'getMe',
  'saveLearnerProfile',
  'saveBuddyProfile',
  'saveSettings',
  'getTags',
  'joinQueue',
  'leaveQueue',
  'listWaitingLearners',
  'listRecommendedBuddies',
  'getCandidate',
  'updateMatchCriteria',
  'createRoom',
  'createRoomWithBuddy',
  'requestMatch',
  'acceptMatchRequest',
  'declineMatchRequest',
  'getRoom',
  'getCards',
  'endRoom',
  'sendFeedback',
  'savePhrase',
  'listBuddies',
  'listBuddyRequests',
  'sendBuddyRequest',
  'acceptBuddyRequest',
  'declineBuddyRequest',
  'cancelBuddyRequest',
  'removeBuddy',
  'receiveBuddyRequest',
  'getProgress',
  'getHistory',
  'getLeaderboard',
  'getIceServers',
  'getShop',
  'redeemShopItem',
];

/** 降级到 fallback 的 3 个方法（后端本轮明确不做，注释里标了原因）。 */
export const FALLBACK_METHODS = [
  'signInWithCredentials', // 正式登录（APK 路线）才需要
  'refreshToken', // 同上
  'checkVersionPolicy', // 只有 APK 启动时要
];

/** 预览页会传一个**假房间号**（`preview-<peerId>`）：后端不认识它，直接走演示卡池。 */
function isPreviewRoom(roomId) {
  return !roomId || String(roomId).startsWith('preview-');
}

function encodeId(value) {
  return encodeURIComponent(String(value ?? ''));
}

export function createHttpApi({
  baseUrl = '',
  store = null,
  fallback = null,
  fetchImpl = null,
  now = () => Date.now(),
} = {}) {
  const http = createHttpClient({ baseUrl, store, fetchImpl, now });
  const mock = fallback ?? null;
  /** 当前待接受请求的**服务端** requestId（本地 runtime 里没这个字段，所以放在闭包里）。 */
  /** 把「仍然生效的那条待接受请求」描述成与 mock 同形状的返回值。 */
  function describePending(request, acceptSeconds = null) {
    return {
      status: 'pending',
      requestId: request.requestId ?? null,
      roomId: request.roomId,
      peer: request.peer,
      expiresAt: request.expiresAt ?? null,
      acceptSeconds,
    };
  }

  let pendingRequestId = null;
  /**
   * 正在飞的「造匹配请求」。**同一个 tick 里的并发调用必须共享同一次请求**：
   * 页面的「使用演示伙伴」与外壳的后台匹配引擎会同时调进来，各自都看到
   * "store 里还没有请求"，于是各造一条 —— 服务端留下两条，本地只认一条，
   * 最后「接受的是第二条、进的是第一条的房间」→ 房间 404（真联调踩到过）。
   */
  let requestInFlight = null;
  /**
   * 已经在本页会话里结算过的房间。**服务端结算是幂等的，本地记一笔也必须幂等**：
   * 弱网重试 / 用户重复点「结束通话」时，服务端会返回同一份 settlement（不会再加 XP），
   * 但本地如果又跑一次 recordSession，进度就会比服务端多出一场——真联调时抓到过。
   */
  const settledRooms = new Set();

  function state() {
    return store?.getState?.() ?? {};
  }

  function degrade(name) {
    if (!mock || typeof mock[name] !== 'function') {
      throw new ApiError('internal', `HTTP 档位下 ${name} 尚未接线，且没有 fallback`);
    }
    return mock[name].bind(mock);
  }

  /* ---------------- 伙伴关系的本地镜像 ----------------
   * 镜像一律以**服务端返回为准**，不调用 store 的粒度动作（`sendBuddyRequest` /
   * `acceptBuddyRequest` 按**本地**关系决定走向，会和本地那份状态打架：
   * 真联调时抓到过——本地认为对面那条是「收到的申请」，服务端其实是「我发出的待处理」，
   * 粒度动作会把它错误地变成伙伴，界面于是出现服务端并没有的伙伴）。
   */

  function mirrorSocial({ buddies, requests } = {}) {
    const patch = {};
    if (Array.isArray(buddies)) patch.buddies = buddies;
    if (Array.isArray(requests)) patch.buddyRequests = requests;
    if (Object.keys(patch).length > 0) store?.hydrateSocial?.(patch);
  }

  const currentBuddies = () => state().social?.buddies ?? [];
  const currentRequests = () => state().social?.buddyRequests ?? [];
  const withoutPeer = (rows, peerId) => (rows ?? []).filter((row) => row.peerId !== peerId);

  function withBuddy(rows, peerId, label) {
    if ((rows ?? []).some((row) => row.peerId === peerId)) return rows;
    return [...(rows ?? []), { peerId, label: label ?? peerId, since: new Date(now()).toISOString() }];
  }

  /**
   * 伙伴申请的**本地行**：形状与 mock 的 `buddyRequests` 完全一致
   * （`/dev/mock` 与历史页读的就是这些键）；服务端给了的就用它的值，缺的按语义补齐。
   */
  function requestRow(serverRow, { peerId, label, direction, roomId, now: clock }) {
    const source = serverRow ?? {};
    return {
      requestId: source.requestId ?? null,
      peerId: source.peerId ?? peerId,
      label: source.label ?? label ?? peerId,
      direction,
      status: 'pending',
      roomId: source.roomId ?? roomId ?? null,
      createdAt: source.createdAt ?? new Date(clock()).toISOString(),
      respondedAt: null,
    };
  }

  return {
    /* ---------------- 账号 / 资料 / 设置 ---------------- */
    async generateTopicCards(input) {
      return http.request('POST', '/api/genai/topic-cards', { body: input });
    },
    async replyToTutor(input) {
      return http.request('POST', '/api/genai/tutor/reply', { body: input });
    },

    /**
     * 一键进入：拿令牌 → 存起来 → 切身份。返回与 mock 同形状的 `{userId, role}`。
     *
     * **必须带上 `deviceId`**（契约 4.1）：它是账号的钥匙。服务端按它查账号——
     * 见过就复用、没见过就建一个。不传的话后端没法把「这台设备」认成一个人，
     * 两台设备会被当成同一个（这正是「两台设备连不上」的老毛病）。
     */
    async signIn(role) {
      const deviceId = store?.deviceId?.() ?? null;
      const data = await http.request('POST', '/api/auth/session', { body: { role, deviceId }, auth: false });
      http.setToken(data?.token ?? null);
      const nextRole = data?.role ?? role;
      store?.setRole?.(nextRole);
      return { userId: data?.userId ?? null, role: nextRole };
    },

    /**
     * 退出登录：让服务端把这条会话作废，再清掉本地令牌（契约 4.1 的 `/api/auth/logout`）。
     *
     * **顺序不能反**：`http.clearToken()` 之后请求头里就没有 Bearer 了，服务端只会回
     * 401，那条会话就永远留在服务端。所以先请求、后清本地。
     *
     * 用 `finally` 保证**无论成败都清本地令牌**：令牌本来就失效（401）时前端更要把它丢掉，
     * 否则会一直攥着一个死令牌，后面每个请求都白跑一趟。请求本身的异常照常往上抛，
     * 由调用方决定要不要吞（`app/session.js` 的 `signOut` 会吞掉——退出不该把人锁在里面）。
     */
    async signOut() {
      try {
        await http.request('POST', '/api/auth/logout', { body: {} });
      } finally {
        http.clearToken();
      }
    },

    /**
     * 首屏一次拿齐。**除了返回，还要把资料灌回本地 store**：
     * 「我的」页读的是 `store.learnerProfile`，不灌的话接上真后端反而显示空资料。
     * 走 `store.hydrate()`（不动 `onboarded`）而不是 `saveRoleProfile()`（那个会强制 onboarded=true）。
     */
    async getMe() {
      const data = await http.request('GET', '/api/me');
      const me = {
        learnerProfile: data?.learnerProfile ?? null,
        buddyProfile: data?.buddyProfile ?? null,
        settings: data?.settings ?? null,
      };
      store?.hydrate?.(me);
      if (data?.progress?.wallet) store?.hydrateWallet?.(data.progress.wallet);
      return me;
    },

    async saveLearnerProfile(patch) {
      const body = toProfileFields('learner', patch);
      const data = await http.request('PUT', '/api/me/profile/learner', { body });
      const profile = toProfile(data, 'learnerProfile');
      if (profile) {
        if (Object.keys(body).every(key => ['avatarId', 'frameId'].includes(key))) store?.hydrate?.({ learnerProfile: profile, buddyProfile: { avatarId: profile.avatarId, frameId: profile.frameId } });
        else store?.saveRoleProfile?.('learner', profile);
      }
      return profile;
    },

    async saveBuddyProfile(patch) {
      const body = toProfileFields('buddy', patch);
      const data = await http.request('PUT', '/api/me/profile/buddy', { body });
      const profile = toProfile(data, 'buddyProfile');
      if (profile) {
        if (Object.keys(body).every(key => ['avatarId', 'frameId'].includes(key))) store?.hydrate?.({ buddyProfile: profile, learnerProfile: { avatarId: profile.avatarId, frameId: profile.frameId } });
        else store?.saveRoleProfile?.('buddy', profile);
      }
      return profile;
    },

    /**
     * 设置：**只把服务端认识的字段送上去**（`theme` / `signalMode` / `mockDelayMs` 这些前端本地偏好
     * 会让后端判成未知字段 400），`locale` 映射成契约里的 `interfaceLanguage`。
     */
    async saveSettings(patch) {
      const data = await http.request('PUT', '/api/me/settings', { body: toSettingsPatch(patch) });
      const settings = toSettings(data);
      if (settings) store?.saveSettings?.(settings);
      return state().settings ?? settings;
    },
    async getShop() {
      const wallet = await http.request('GET', '/api/me/shop');
      store?.hydrateWallet?.(wallet);
      return wallet;
    },
    async redeemShopItem(itemId) {
      const wallet = await http.request('POST', '/api/me/shop/redeem', { body: { itemId } });
      store?.hydrateWallet?.(wallet);
      return wallet;
    },

    async getTags() {
      return http.request('GET', '/api/tags');
    },

    /* ---------------- 匹配 ---------------- */

    /**
     * 入队。**409 `already_queued` 当成功**：契约第 4.4 节写明前端拿到它就直接进等待面板，
     * 不弹错误——这样双击 / 刷新后再点都不会给用户一条红页。
     */
    async joinQueue() {
      const anonymous = state().settings?.anonymous;
      let data = null;
      try {
        data = await http.request('POST', '/api/match/queue', { body: { anonymous } });
      } catch (error) {
        if (error.code !== 'already_queued') throw error;
      }
      store?.startQueue?.({ anonymous });
      return toQueueEntry(data);
    },

    /** 取消等待。410 `queue_expired` 同样当成功（本地清掉队列即可，用户的目的已经达到）。 */
    async leaveQueue() {
      let invalidated = 0;
      try {
        const data = await http.request('DELETE', '/api/match/queue');
        invalidated = data?.invalidatedRequests ?? 0;
      } catch (error) {
        if (error.code !== 'queue_expired') throw error;
      }
      store?.cancelQueue?.();
      return { ok: true, invalidatedRequests: invalidated };
    },

    /** 母语者视角：后端给 `{entries}`，页面要裸数组。 */
    async listWaitingLearners() {
      return toEntries(await http.request('GET', '/api/match/queue'));
    },

    /** 学习者视角（首页推荐块）。同样摊平成裸数组。 */
    async listRecommendedBuddies() {
      return toEntries(await http.request('GET', '/api/match/recommendations'));
    },

    /** 候选人预览：摊平 + `reasons → reason` + 把 `roomAvailable` 搬进人对象。 */
    async getCandidate(learnerId) {
      const data = await http.request('GET', `/api/match/candidates/${encodeId(learnerId)}`);
      return toCandidate(data);
    },

    /** 自定义匹配条件：`null` / `[]` 都是「清掉自定义」。 */
    async updateMatchCriteria(criteria) {
      const topics = criteria === null || criteria === undefined ? null : criteria;
      const data = await http.request('PUT', '/api/match/criteria', { body: { topics } });
      const next = data?.criteria ?? null;
      store?.saveSettings?.({ matchCriteria: next });
      return { ok: true, criteria: next };
    },

    /** 母语者挑人：真后端传 `learnerId`。`role` 与 mock 保持一致（发起人是母语者）。 */
    async createRoom(learnerId) {
      const data = await http.request('POST', '/api/rooms', { body: { learnerId } });
      const room = toRoom(data);
      store?.startRoom?.({ roomId: room.roomId, peer: room.peer, role: 'buddy' });
      return room;
    },

    /** 学习者在首页「直接聊」：同一个端点，传 `buddyId`。 */
    async createRoomWithBuddy(buddyId) {
      const data = await http.request('POST', '/api/rooms', { body: { buddyId } });
      const room = toRoom(data);
      store?.startRoom?.({ roomId: room.roomId, peer: room.peer, role: 'learner' });
      return room;
    },

    /**
     * 造一条「待接受」的匹配请求。
     * 真实环境里这件事是匹配引擎经 `/ws/match` 推给前端的；这一阶段走**契约外的演示口子**
     * `POST /api/dev/match-request`（与 mock 的 `requestMatch({reason:'demo'})` 等价）。
     */
    async requestMatch({ reason = 'demo' } = {}) {
      // 已经有一条待接受请求：不再造新的（mock 的 receiveMatchRequest 也是这个语义，
      // 否则后台引擎每轮都会产出一个新房间号，弹窗被反复重建）
      const existing = state().runtime?.matchRequest;
      if (existing) return describePending(existing);
      // 并发去重：同一个 tick 里第二次进来直接复用第一次的在飞请求
      if (requestInFlight) return requestInFlight;

      requestInFlight = (async () => {
        let data = null;
        try {
          data = await http.request('POST', '/api/dev/match-request', { body: {} });
        } catch (error) {
          // 没有可配的人：沿用 mock 的错误码，app 层的后台引擎会静默重试
          if (error.code === 'not_found') throw new ApiError('no_candidate', 'no available peer');
          throw error;
        }

        const request = toMatchRequest(data);
        const result = store?.receiveMatchRequest?.({
          requestId: request.requestId,
          roomId: request.roomId,
          peer: request.peer,
          expiresAt: request.expiresAt,
          reason,
        }) ?? { status: 'invalid' };

        // **以 store 里实际生效的那一条为准**：并发或已有请求时，store 会保留先到的那条，
        // 此时 pendingRequestId 必须跟着它走，否则「接受」用的是另一条请求的 id。
        const settled = state().runtime?.matchRequest ?? null;
        pendingRequestId = settled?.requestId ?? (result.status === 'pending' ? request.requestId : null);
        if (result.status !== 'pending' || !settled) {
          return { status: result.status, ...request };
        }
        return { ...describePending(settled, request.acceptSeconds), status: result.status };
      })();

      try {
        return await requestInFlight;
      } finally {
        requestInFlight = null;
      }
    },

    /**
     * 接受 → 原子成房。服务端说「房间被抢走了 / 请求过期了」时**不抛错**，
     * 而是按本地语义走「不接受」：收起弹窗、人留在队列（契约第 4.4 节：这是演示路径上的正常分支）。
     */
    async acceptMatchRequest() {
      // 以 store 里那条待接受请求为准（它才是弹窗/房间号的真源），闭包变量只是兜底
      const requestId = state().runtime?.matchRequest?.requestId ?? pendingRequestId;
      if (!requestId) return degrade('acceptMatchRequest')();
      try {
        await http.request('POST', `/api/match/requests/${encodeId(requestId)}/accept`, { body: {} });
      } catch (error) {
        if (error.code === 'room_taken' || error.code === 'match_request_expired') {
          pendingRequestId = null;
          return (
            store?.declineMatchRequest?.({ expired: error.code === 'match_request_expired' }) ?? {
              status: 'expired',
            }
          );
        }
        throw error;
      }
      pendingRequestId = null;
      return store?.acceptMatchRequest?.() ?? { status: 'accepted' };
    },

    /** 不接受（或倒计时到点）：人留在队列、计时不清零。 */
    async declineMatchRequest({ expired = false } = {}) {
      const requestId = pendingRequestId;
      if (requestId) {
        try {
          await http.request('POST', `/api/match/requests/${encodeId(requestId)}/decline`, {
            body: { reason: expired ? 'expired' : 'declined' },
          });
        } catch (error) {
          if (error.code !== 'match_request_expired') throw error;
        }
        pendingRequestId = null;
      }
      return store?.declineMatchRequest?.({ expired }) ?? { status: expired ? 'expired' : 'declined' };
    },

    /* ---------------- 房间 ---------------- */

    /** 房间元信息。当前没有页面调它（页面用 `runtime.room`），保留给 Phase 3 的刷新恢复。 */
    async getRoom(roomId) {
      const data = await http.request('GET', `/api/rooms/${encodeId(roomId)}`);
      return {
        room: toRoomRecord(data),
        peer: data?.peer ?? null,
        status: data?.status ?? null,
        startedAt: isoToMs(data?.startedAt),
      };
    },

    /**
     * 话题卡。**假房间号（`preview-<peerId>`）降级到演示卡池**：
     * 预览页拿不到真房间（那时还没成房），这是演示路径上的刻意设计。
     *
     * `round` 是「第几叠」（「再来八张」加一），`exclude` 是本次会话已经看过的卡 id：
     * 两者都要传给服务端，服务端才能把新一叠洗成不一样的（种子 = 房间号 + round）。
     */
    async getCards(roomId, { interests = [], level, round = 0, exclude = [] } = {}) {
      if (isPreviewRoom(roomId)) return degrade('getCards')(roomId, { interests, level, round, exclude });
      const data = await http.request('GET', `/api/rooms/${encodeId(roomId)}/cards`, {
        query: {
          level: level ?? undefined,
          interests: interests && interests.length > 0 ? interests.join(',') : undefined,
          round: round > 0 ? String(round) : undefined,
          exclude: exclude && exclude.length > 0 ? exclude.join(',') : undefined,
        },
      });
      return {
        roomId: data?.roomId ?? roomId,
        level: data?.level ?? level ?? null,
        round: data?.round ?? round ?? 0,
        cards: data?.cards ?? [],
      };
    },

    /**
     * 结算。服务端算权威的 XP / 成就，本地照样记一笔（`getProgress` 接上真后端之后，
     * 统计以服务端为准；本地这一笔是为了「结算完立刻回房间/我的页」时不闪空数据）。
     */
    async endRoom(roomId, { durationSec, cardsUsed, topics = [], peerId, peerLabel } = {}) {
      const data = await http.request('POST', `/api/rooms/${encodeId(roomId)}/end`, {
        body: { durationSec, cardsUsed, topics },
      });
      const settlement = toSettlement(data, { durationSec, cardsUsed, topics });
      store?.endRoom?.();
      if (!settledRooms.has(roomId)) {
        settledRooms.add(roomId);
        store?.recordSession?.({
          peerId: peerId ?? null,
          peerLabel: peerLabel ?? null,
          durationSec: settlement.durationSec,
          cardsUsed: settlement.cardsUsed,
          topics: settlement.topics,
          role: state().role,
        });
      }
      return settlement;
    },

    /**
     * 结算第二步的评价。后端对「一个标签都没选、也没标 skipped」会 400；
     * 这里降级成本地记一笔（演示路径上不该因为一个评价字段把流程卡住）。
     */
    async sendFeedback(roomId, { tags = [], skipped = false } = {}) {
      try {
        await http.request('POST', `/api/rooms/${encodeId(roomId)}/feedback`, { body: { tags, skipped } });
      } catch (error) {
        if (error.code !== 'bad_request') throw error;
      }
      store?.setNotice?.({ kind: 'feedback', tags, skipped });
      return { ok: true };
    },

    /**
     * 句型收藏。卡片里的短语是 `{cantonese, mandarin, english}`，
     * 契约只认 `cantonese` / `mandarin` / `phrase` / `roomId`——这里把 `english` 折成 `phrase`。
     */
    async savePhrase(phrase) {
      // 只把**有值**的字段发上去：契约里 `roomId` 要么不出现、要么是非空字符串，
      // 显式发 null 会被后端判成 400（真联调时抓到过）。
      const body = {};
      if (phrase?.cantonese) body.cantonese = phrase.cantonese;
      if (phrase?.mandarin) body.mandarin = phrase.mandarin;
      const text = phrase?.phrase ?? phrase?.english;
      if (text) body.phrase = text;
      if (phrase?.roomId) body.roomId = phrase.roomId;
      const data = await http.request('POST', '/api/me/saved-phrases', { body });
      store?.savePhrase?.(phrase);
      return { ok: true, savedPhrase: data?.savedPhrase ?? null };
    },

    /* ---------------- 伙伴关系 / 沉淀（契约 4.6 / 4.7 节） ----------------
     *
     * 写成功之后**照旧调 store 的同一个方法**更新本地镜像：契约 4.6 的伙伴关系是双向的，
     * `/dev/mock` 的演示按钮与历史页的按钮文案都读本地 `social`，镜像不跟上的话，
     * 服务端明明成功了、界面还是旧的。**返回值以服务端为准**（本地只做镜像）。
     */

    /** `{ buddies }` → 裸数组；顺手把本地镜像换成服务端这一份。 */
    async listBuddies() {
      const buddies = toBuddies(await http.request('GET', '/api/me/buddies'));
      mirrorSocial({ buddies });
      return buddies;
    },

    /** `{ requests }` → 裸数组；`direction` / `status` 可选过滤（契约 4.6）。 */
    async listBuddyRequests({ direction, status } = {}) {
      const requests = toBuddyRequests(
        await http.request('GET', '/api/me/buddy-requests', {
          query: { direction: direction ?? undefined, status: status ?? undefined },
        }),
      );
      mirrorSocial({ requests });
      return requests;
    },

    /**
     * 发出伙伴申请。**请求体只有 `peerId`（有房间才带 `roomId`）**：契约的请求字段里没有
     * `label`，多送一个会被后端判 400（真联调时抓到过）；`label` 只用于本地镜像的显示。
     * `status` 可能是 `pending` / `buddy`（已经是伙伴，200 不算错）/ `accepted`（对方也申请过我）。
     */
    async sendBuddyRequest(peerId, label, { roomId = null } = {}) {
      const body = { peerId };
      if (roomId) body.roomId = roomId;
      let data = null;
      try {
        data = await http.request('POST', '/api/me/buddy-requests', { body });
      } catch (error) {
        // 契约给这条留了 409 `already_buddy`；按 mock 语义当成功（界面显示「已是伙伴」）
        if (error.code !== 'already_buddy') throw error;
        data = { status: 'buddy', request: null };
      }

      const status = data?.status ?? 'pending';
      const requests = withoutPeer(currentRequests(), peerId);
      if (status === 'pending') {
        // 显式构造本地行（形状与 mock 的 buddyRequests 一致：页面与 /dev/mock 读的就是这些键）
        const row = requestRow(data?.request, {
          peerId,
          label,
          direction: 'outgoing',
          roomId: roomId ?? null,
          now,
        });
        mirrorSocial({ requests: [...requests, row] });
      } else {
        // accepted（对方也申请过我 ⇒ 直接成为伙伴）/ buddy（本来就是伙伴）
        mirrorSocial({ buddies: withBuddy(currentBuddies(), peerId, label), requests });
      }
      return { status, request: data?.request ?? null };
    },

    /** 接受申请：这一步之后对方才出现在「我的伙伴」里。响应 `{buddy, request}`。 */
    async acceptBuddyRequest(peerId) {
      let data = null;
      try {
        data = await http.request('POST', `/api/me/buddy-requests/${encodeId(peerId)}/accept`, { body: {} });
      } catch (error) {
        if (error.code !== 'not_found') throw error;
        return { status: 'none', buddy: null, request: null };
      }
      const buddy = data?.buddy ?? null;
      mirrorSocial({
        buddies: withBuddy(currentBuddies(), buddy?.peerId ?? peerId, buddy?.label ?? peerId),
        requests: withoutPeer(currentRequests(), peerId),
      });
      return { status: 'accepted', buddy, request: data?.request ?? null };
    },

    /** 拒绝申请：直接移除那条记录（v1 不留「已拒绝」）。 */
    async declineBuddyRequest(peerId) {
      try {
        await http.request('POST', `/api/me/buddy-requests/${encodeId(peerId)}/decline`, { body: {} });
      } catch (error) {
        if (error.code !== 'not_found') throw error;
      }
      mirrorSocial({ requests: withoutPeer(currentRequests(), peerId) });
      return { status: 'declined' };
    },

    /** 撤回我发出的申请。 */
    async cancelBuddyRequest(peerId) {
      try {
        await http.request('DELETE', `/api/me/buddy-requests/${encodeId(peerId)}`);
      } catch (error) {
        if (error.code !== 'not_found') throw error;
      }
      mirrorSocial({ requests: withoutPeer(currentRequests(), peerId) });
      return { status: 'cancelled' };
    },

    /** 解除伙伴关系。 */
    async removeBuddy(peerId) {
      try {
        await http.request('DELETE', `/api/me/buddies/${encodeId(peerId)}`);
      } catch (error) {
        if (error.code !== 'not_found') throw error;
      }
      mirrorSocial({ buddies: withoutPeer(currentBuddies(), peerId) });
      return { status: 'removed' };
    },

    /**
     * 现场只有一个人：用它替代「对方点了一次申请」。走的是**契约外的演示口子**
     * `POST /api/dev/buddy-request`（等价于 mock 的 `receiveBuddyRequest`）。
     */
    async receiveBuddyRequest(peerId, label) {
      const data = await http.request('POST', '/api/dev/buddy-request', {
        body: { peerId, label: label ?? peerId },
      });
      const row = requestRow(data?.request, {
        peerId,
        label,
        direction: 'incoming',
        roomId: null,
        now,
      });
      mirrorSocial({ requests: [...withoutPeer(currentRequests(), peerId), row] });
      return { status: 'pending-in', request: data?.request ?? null };
    },

    /** 进度：键集合与 mock 一致，直接透传（成就数组兜底成 `[]`）。 */
    async getProgress() {
      return toProgress(await http.request('GET', '/api/me/progress'));
    },

    /** 通话记录：`{entries}` → 裸数组（新的在最前，由服务端排序）。 */
    async getHistory() {
      return toEntries(await http.request('GET', '/api/me/history'));
    },

    /** 榜单：`period`（weekly / monthly）× `role`（learner / buddy），四张榜同一套字段。 */
    async getLeaderboard(period = 'weekly', role = 'learner') {
      const data = await http.request('GET', '/api/leaderboard', { query: { period, role } });
      return toEntries(data);
    },

    /* ---------------- 基础设施 ---------------- */

    /**
     * 实时信令的 STUN / TURN 配置（`docs/10` 4.8）。远端档位建 `RTCPeerConnection` 前拉一次。
     *
     * 形状归一化成与 mock **完全一致**（`{ iceServers, expiresAt }`），这样「半真」档位下
     * 页面拿到的永远是同一种东西。503 `turn_unavailable` 原样抛 `ApiError`，
     * 由 `rtc.js` 的写死 STUN 接住——信令配置拿不到不该让通话起不来。
     */
    async getIceServers() {
      const data = await http.request('GET', '/api/rtc/ice-servers');
      return {
        iceServers: Array.isArray(data?.iceServers) ? data.iceServers : [],
        expiresAt: data?.expiresAt ?? null,
      };
    },

    /* ---------------- 以下 3 个仍走 mock（后端本轮明确不做） ---------------- */

    signInWithCredentials: (...args) => degrade('signInWithCredentials')(...args),
    refreshToken: (...args) => degrade('refreshToken')(...args),
    checkVersionPolicy: (...args) => degrade('checkVersionPolicy')(...args),
  };
}

/**
 * 资料写入的**请求侧过滤**：只送服务端认识的字段。
 * 页面会把整份草稿 PUT 上来（含 `userId` / `onboarded` 这些服务端自有字段），
 * 后端能忽略它们，但前端本地的偏好字段（比如从另一份资料复制过来的键）会被判成未知字段 400。
 */
export function toProfileFields(role, patch = {}) {
  const allowed =
    role === 'buddy'
      ? ['languagesSpoken', 'identity', 'interests', 'preferredTopics', 'wantToLearn', 'displayName', 'avatarId', 'frameId']
      : ['nativeLanguage', 'cantoneseLevel', 'learningGoal', 'identity', 'interests', 'displayName', 'avatarId', 'frameId'];
  const out = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

export { createMockApi };

/**
 * 数据层：单进程内存表 + 一个 JSON 快照文件（契约与 TODO.md Phase 0）。
 *
 * 五张表（下一阶段会用的也在，先建好骨架）：
 *   users / profiles / queue / rooms / relations
 * 另外为了跑通注册流程，附带 settings、progress、sessions（令牌）三张表。
 *
 * **出厂全空**：没有任何预置账号或候选人。账号由 `POST /api/auth/session` 按 `deviceId`
 * 现场创建（`createAccount()`），所以列表里的人一定是真实注册过的设备。
 *
 * 为什么不用数据库：现场演示只需要「一键重置 + 重启不丢」，JSON 快照够用，
 * 而且零依赖、能用眼睛读、能进 git diff。
 *
 * 落盘策略：每次写操作后 `persist()` 全量写（demo 数据量极小），先写临时文件再 rename，
 * 避免进程被 kill 时留下半个 JSON。
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { createAccountRows, createSeed, newAccountId } from './seed.js';
import { MAX_INTERESTS, ROLES } from '../data/vocabularies.js';
import { FREE_AVATARS } from '../data/avatars.js';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export function createDb({ filePath = null, now = () => Date.now() } = {}) {
  /** @type {ReturnType<typeof createSeed>} */
  let tables = createSeed();

  function load() {
    if (!filePath || !existsSync(filePath)) return false;
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      tables = { ...createSeed(), ...parsed };
      return true;
    } catch {
      // 快照坏了就当没有，回到出厂状态——演示不能因为一个坏文件起不来
      tables = createSeed();
      return false;
    }
  }

  function persist() {
    if (transactionDepth) return;
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(tables, null, 2), 'utf8');
    renameSync(tmp, filePath);
  }

  let transactionDepth = 0;
  load();

  /** 资料是**一行一个人格**：`accountId + role` 定位，两份资料互不覆盖。 */
  function findProfile(userId, role) {
    return tables.profiles.find((item) => item.accountId === userId && item.role === role) ?? null;
  }

  function findSettings(userId) {
    return tables.settings.find((item) => item.accountId === userId) ?? null;
  }

  function findProgress(userId) {
    return tables.progress.find((item) => item.accountId === userId) ?? null;
  }

  function findRelations(userId) {
    return tables.relations.find((item) => item.accountId === userId) ?? null;
  }

  const db = {
    transaction(action) {
      const before = structuredClone(tables);
      const previousDepth = transactionDepth;
      transactionDepth++;
      try {
        const result = action();
        transactionDepth = previousDepth;
        persist();
        return result;
      } catch (error) {
        transactionDepth = previousDepth;
        tables = before;
        throw error;
      }
    },
    getWallet(accountId) {
      const progress = findProgress(accountId) ?? {};
      const wallet = structuredClone(progress.wallet ?? { balance: progress.xp ?? 0, ownedThemes: ['mint', 'warm'], transactions: [] });
      wallet.ownedAvatars = [...new Set([...FREE_AVATARS, ...(wallet.ownedAvatars ?? [])])];
      wallet.ownedFrames = [...new Set(['none', ...(wallet.ownedFrames ?? [])])];
      return wallet;
    },
    creditPoints(accountId, amount, eventId, kind) {
      const wallet = db.getWallet(accountId);
      if (wallet.transactions.some((row) => row.id === eventId)) return false;
      wallet.balance += amount;
      wallet.transactions.unshift({ id: eventId, kind, amount, at: new Date(now()).toISOString() });
      db.updateProgress(accountId, { xp: (findProgress(accountId)?.xp ?? 0) + amount, wallet });
      return true;
    },
    /* ---------- 账号与令牌 ---------- */
    createSession({ userId, role, ttlMs = TOKEN_TTL_MS }) {
      const token = 'demo-' + Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-4);
      const session = {
        token,
        userId,
        // 身份进令牌：切身份＝换一个令牌，服务端据此裁剪下发内容（契约 3.2 节）
        role: ROLES.includes(role) ? role : null,
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + ttlMs).toISOString(),
      };
      tables.sessions = [...tables.sessions.filter((item) => item.token !== token), session];
      persist();
      return session;
    },

    getSession(token) {
      const session = tables.sessions.find((item) => item.token === token) ?? null;
      if (!session) return null;
      if (session.expiresAt && Date.parse(session.expiresAt) <= now()) {
        tables.sessions = tables.sessions.filter((item) => item.token !== token);
        persist();
        return null;
      }
      return session;
    },

    /**
     * 作废一条会话（退出登录）。返回是否真的删掉了一行——
     * 令牌本来就不在表里时返回 false，调用方不必当成错误。
     *
     * 只删**这一条令牌**：会话表是按令牌一行一行存的，同一账号在另一台设备 /
     * 另一个标签页上的会话不受影响（退出不该把人在别处踢下线）。
     */
    deleteSession(token) {
      if (!token) return false;
      const before = tables.sessions.length;
      tables.sessions = tables.sessions.filter((item) => item.token !== token);
      const removed = tables.sessions.length !== before;
      if (removed) persist();
      return removed;
    },

    /* ---------- 账号（真实注册：一台设备一个账号） ---------- */

    /** 按 `deviceId` 找账号。同一台设备刷新 / 换身份都要落回同一个人。 */
    findUserByDeviceId(deviceId) {
      if (!deviceId) return null;
      return tables.users.find((item) => item.deviceId === deviceId) ?? null;
    },

    getUser(userId) {
      return tables.users.find((item) => item.userId === userId) ?? null;
    },

    updateDisplayName(accountId, displayName) {
      tables.users = tables.users.map((row) => row.userId === accountId ? { ...row, displayName } : row);
      tables.profiles = tables.profiles.map((row) => row.accountId === accountId ? { ...row, displayName } : row);
      tables.queue = tables.queue.map((row) => row.ownerAccountId === accountId ? { ...row, displayName } : row);
      persist();
    },

    updateFrame(accountId, frameId) {
      tables.users = tables.users.map(row => row.userId === accountId ? { ...row, frameId } : row);
      tables.profiles = tables.profiles.map(row => row.accountId === accountId ? { ...row, frameId } : row);
      tables.queue = tables.queue.map(row => row.ownerAccountId === accountId ? { ...row, frameId } : row);
      persist();
    },
    updateAvatar(accountId, avatarId) {
      tables.users = tables.users.map(row => row.userId === accountId ? { ...row, avatarId } : row);
      tables.profiles = tables.profiles.map(row => row.accountId === accountId ? { ...row, avatarId } : row);
      tables.queue = tables.queue.map(row => row.ownerAccountId === accountId ? { ...row, avatarId } : row);
      persist();
    },

    /** 全部账号（榜单要遍历所有人的进度）。 */
    listUsers() {
      return [...tables.users];
    },

    /**
     * 从**资料 id** 反查账号：`learner-u-ab12cd34` → `u-ab12cd34`。
     *
     * 社交那一层要按 peerId 写「对面那张表」（收到申请 / 撤回镜像），而那张表是按账号
     * 组织的；查不到就返回 null（对面可能早就没这个资料了）。
     * 走 `profiles` 而不是队列：人退了队列照样要能收掉自己发出去的申请。
     */
    findAccountByPeerId(peerId) {
      if (!peerId) return null;
      return tables.profiles.find((item) => item.userId === peerId)?.accountId ?? null;
    },

    /**
     * 建一个新账号：**五张表一起写**，不会出现「有账号没资料」的半截状态。
     * `accountId` 不给就随机生成，撞车了重试——快照文件被换过也不怕。
     */
    createAccount({ accountId = null, displayName = null, deviceId = null, createdAt = null } = {}) {
      let id = accountId;
      if (!id) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const candidate = newAccountId();
          if (!db.getUser(candidate)) {
            id = candidate;
            break;
          }
        }
        if (!id) throw new Error('createAccount: 连随机 id 都撞车了，检查 users 表');
      }
      if (db.getUser(id)) throw new Error('createAccount: 账号已存在 ' + id);

      const rows = createAccountRows({
        accountId: id,
        displayName,
        deviceId,
        createdAt: createdAt ?? new Date(now()).toISOString(),
      });
      tables.users = [...tables.users, rows.user];
      tables.profiles = [...tables.profiles, rows.learnerProfile, rows.buddyProfile];
      tables.settings = [...tables.settings, rows.settings];
      tables.progress = [...tables.progress, rows.progress];
      tables.relations = [...tables.relations, rows.relations];
      persist();
      return rows.user;
    },

    /* ---------- 资料 / 设置 / 进度 ---------- */
    getProfile: findProfile,
    getSettings: findSettings,
    getProgress: findProgress,
    getRelations: findRelations,

    /** 全部进度行（榜单按账号遍历）。 */
    listProgress() {
      return [...tables.progress];
    },

    /**
     * 部分更新**某一份**资料（`role` 决定改哪一份，两份互不覆盖）。
     * 校验规则与契约一致：
     *   - 取值必须是已知词表子集、数组内去重（由 domain 层拦成 400，这里只做数据写入）
     *   - `interests` 超过 5 个 → 400
     * 写入成功即视为这份资料填完了（`onboarded: true`）。
     */
    updateProfile(userId, role, patch, { markOnboarded = true } = {}) {
      const profile = findProfile(userId, role);
      if (!profile) return null;
      const next = { ...profile };

      for (const [key, value] of Object.entries(patch)) {
        if (key === 'accountId' || key === 'role' || key === 'userId') continue;
        next[key] = value;
      }
      if (Object.keys(patch).length > 0 && markOnboarded) next.onboarded = true;

      tables.profiles = tables.profiles.map((item) =>
        item.accountId === userId && item.role === role ? next : item,
      );
      persist();
      return next;
    },

    updateSettings(userId, patch) {
      const settings = findSettings(userId);
      if (!settings) return null;
      const next = {
        ...settings,
        ...patch,
        visibility: { ...settings.visibility, ...(patch.visibility ?? {}) },
      };
      tables.settings = tables.settings.map((item) => (item.accountId === userId ? next : item));
      tables.queue = tables.queue.map(row => row.ownerAccountId === userId ? { ...row, anonymous: next.anonymous, equippedTitleId: next.equippedTitleId ?? null, visibility: { ...next.visibility } } : row);
      persist();
      return next;
    },

    /* ---------- 匹配队列（契约 4.4 节） ---------- */

    /** 队列行；`unclaimedOnly` = 还没被摘走的人，用于列表与推荐。 */
    listQueue({ role = null, unclaimedOnly = false } = {}) {
      return tables.queue.filter(
        (row) => (role === null || row.role === role) && (!unclaimedOnly || row.claimedRoomId === null),
      );
    },

    findQueueRow(userId) {
      return tables.queue.find((row) => row.userId === userId) ?? null;
    },

    /** 入队：同一个人只保留一行（重复入队由 domain 层判成 409）。 */
    upsertQueueRow(row) {
      const exists = db.findQueueRow(row.userId);
      if (exists) {
        tables.queue = tables.queue.map((item) => (item.userId === row.userId ? { ...item, ...row } : item));
      } else {
        tables.queue = [...tables.queue, row];
      }
      persist();
      return db.findQueueRow(row.userId);
    },

    /** 取消等待：整行移除（这就是「彻底退出」的唯一动作）。 */
    removeQueueRow(userId) {
      const before = tables.queue.length;
      tables.queue = tables.queue.filter((row) => row.userId !== userId);
      if (tables.queue.length !== before) persist();
      return before !== tables.queue.length;
    },

    /** 只删「这个账号自己排的队」，不碰别人排的。 */
    removeOwnedQueueRows(accountId) {
      const before = tables.queue.length;
      tables.queue = tables.queue.filter((row) => row.ownerAccountId !== accountId);
      if (tables.queue.length !== before) persist();
      return before - tables.queue.length;
    },

    /**
     * **原子摘人**：检查有没有被摘走 + 置位，在同一个同步调用里完成。
     * 返回 `{ ok: true, row }` / `{ ok: false, reason: 'not_found' | 'taken' }`——
     * 成房必须原子，这是「匹配成功后房间从公共页摘掉」的唯一实现方式。
     */
    claimQueueRow(userId, roomId) {
      const row = db.findQueueRow(userId);
      if (!row) return { ok: false, reason: 'not_found' };
      if (row.claimedRoomId !== null) return { ok: false, reason: 'taken' };
      tables.queue = tables.queue.map((item) =>
        item.userId === userId ? { ...item, claimedRoomId: roomId } : item,
      );
      persist();
      return { ok: true, row: { ...row, claimedRoomId: roomId } };
    },

    /* ---------- 房间（契约 4.5 节） ---------- */

    createRoom(room) {
      tables.rooms = [...tables.rooms, room];
      persist();
      return room;
    },

    getRoom(roomId) {
      return tables.rooms.find((room) => room.roomId === roomId) ?? null;
    },

    /* ---------- 进度 / 历史 / 收藏（契约 4.5 / 4.7 节） ---------- */

    updateProgress(userId, patch) {
      const row = findProgress(userId);
      if (!row) return null;
      const next = { ...row, ...patch };
      tables.progress = tables.progress.map((item) => (item.accountId === userId ? next : item));
      persist();
      return next;
    },

    /** 通话记录：新的排在前面（与前端 `recordSession` 的 `[entry, ...history]` 一致）。 */
    appendHistory(userId, entry) {
      const row = findRelations(userId);
      if (!row) return null;
      const next = { ...row, history: [entry, ...(row.history ?? [])] };
      tables.relations = tables.relations.map((item) => (item.accountId === userId ? next : item));
      persist();
      return entry;
    },

    /** 反馈按 sessionId 挂到对应会话；兼容未传 sessionId 的旧调用（结算页的第二步）。 */
    attachFeedback(userId, feedback) {
      const row = findRelations(userId);
      if (!row) return null;
      let attached = null;
      const history = (row.history ?? []).map((entry) => {
        if (attached || entry.peerId !== feedback.peerId || (feedback.sessionId && entry.sessionId !== feedback.sessionId)) return entry;
        attached = { ...entry, feedback };
        return attached;
      });
      if (!attached) return null;
      tables.relations = tables.relations.map((item) =>
        item.accountId === userId ? { ...item, history } : item,
      );
      persist();
      return attached;
    },

    addSavedPhrase(userId, phrase) {
      const row = findRelations(userId);
      if (!row) return null;
      const next = { ...row, savedPhrases: [phrase, ...(row.savedPhrases ?? [])] };
      tables.relations = tables.relations.map((item) => (item.accountId === userId ? next : item));
      persist();
      return phrase;
    },

    /* ---------- 伙伴关系（契约 4.6 节） ---------- */

    listBuddies(accountId) {
      return [...(findRelations(accountId)?.buddies ?? [])];
    },

    isBuddy(accountId, peerId) {
      return (findRelations(accountId)?.buddies ?? []).some((item) => item.peerId === peerId);
    },

    addBuddy(accountId, buddy) {
      const row = findRelations(accountId);
      if (!row) return null;
      const next = { ...row, buddies: [...(row.buddies ?? []), buddy] };
      tables.relations = tables.relations.map((item) => (item.accountId === accountId ? next : item));
      persist();
      return buddy;
    },

    /** 解除伙伴只删伙伴关系：通话记录、积分、成就全部保留（契约 4.6 节）。 */
    removeBuddy(accountId, peerId) {
      const row = findRelations(accountId);
      const before = row?.buddies?.length ?? 0;
      if (!row || before === 0) return false;
      const next = { ...row, buddies: row.buddies.filter((item) => item.peerId !== peerId) };
      if (next.buddies.length === before) return false;
      tables.relations = tables.relations.map((item) => (item.accountId === accountId ? next : item));
      persist();
      return true;
    },

    /** 申请列表；`direction` / `status` 不给就全量（v1 的 status 只有 pending）。 */
    listBuddyRequests(accountId, { direction = null, status = null } = {}) {
      const requests = findRelations(accountId)?.buddyRequests ?? [];
      return requests.filter(
        (item) =>
          (direction === null || item.direction === direction) && (status === null || item.status === status),
      );
    },

    findBuddyRequest(accountId, { peerId, direction = null } = {}) {
      return (
        (findRelations(accountId)?.buddyRequests ?? []).find(
          (item) => item.peerId === peerId && (direction === null || item.direction === direction),
        ) ?? null
      );
    },

    addBuddyRequest(accountId, request) {
      const row = findRelations(accountId);
      if (!row) return null;
      const next = { ...row, buddyRequests: [...(row.buddyRequests ?? []), request] };
      tables.relations = tables.relations.map((item) => (item.accountId === accountId ? next : item));
      persist();
      return request;
    },

    /**
     * 处理完的申请**直接从表里移除**（v1 不留「已拒绝」记录，契约 4.6 节）。
     * 返回被移除的那条；没有匹配的就返回 null（domain 层据此报 404）。
     */
    removeBuddyRequest(accountId, { peerId, direction = null } = {}) {
      const row = findRelations(accountId);
      const requests = row?.buddyRequests ?? [];
      const target = requests.find(
        (item) => item.peerId === peerId && (direction === null || item.direction === direction),
      );
      if (!target) return null;
      const next = {
        ...row,
        buddyRequests: requests.filter((item) => item !== target),
      };
      tables.relations = tables.relations.map((item) => (item.accountId === accountId ? next : item));
      persist();
      return target;
    },

    /* ---------- 历史（契约 4.7 节） ---------- */

    /** `buddyOnly`：只看**现在还是伙伴**的记录（`/history` 的筛选开关）。 */
    listHistory(accountId, { buddyOnly = false, limit = null } = {}) {
      const row = findRelations(accountId);
      let entries = [...(row?.history ?? [])];
      if (buddyOnly) {
        const peers = new Set((row?.buddies ?? []).map((item) => item.peerId));
        entries = entries.filter((entry) => peers.has(entry.peerId));
      }
      if (limit !== null && Number.isFinite(limit) && limit > 0) entries = entries.slice(0, Math.floor(limit));
      return entries;
    },

    updateRoom(roomId, patch) {
      let next = null;
      tables.rooms = tables.rooms.map((room) => {
        if (room.roomId !== roomId) return room;
        next = { ...room, ...patch };
        return next;
      });
      if (next) persist();
      return next;
    },

    /* ---------- 待接受的匹配请求（真实环境由匹配引擎 + WebSocket 产生） ---------- */

    createMatchRequest(request) {
      tables.matchRequests = [...tables.matchRequests, request];
      persist();
      return request;
    },

    getMatchRequest(requestId) {
      return tables.matchRequests.find((item) => item.requestId === requestId) ?? null;
    },

    updateMatchRequest(requestId, patch) {
      let next = null;
      tables.matchRequests = tables.matchRequests.map((item) => {
        if (item.requestId !== requestId) return item;
        next = { ...item, ...patch };
        return next;
      });
      if (next) persist();
      return next;
    },

    /**
     * **取消等待要连坐**：作废这个账号身上还没接受的匹配请求，
     * 否则对面会一直干等到倒计时结束（契约 4.4 节 + 07 的 Q-G15）。
     */
    invalidateMatchRequests(accountId) {
      let count = 0;
      tables.matchRequests = tables.matchRequests.map((item) => {
        if (item.accountId !== accountId || item.status !== 'pending') return item;
        count += 1;
        return { ...item, status: 'invalidated', invalidatedAt: new Date(now()).toISOString() };
      });
      if (count > 0) persist();
      return count;
    },

    /* ---------- 演示辅助 ---------- */

    /**
     * 一键回到出厂：**连账号一起清掉**（出厂就是空的）。
     * 演示前想重新走一遍「两台设备注册」，这是最快的路子。
     */
    reset() {
      tables = createSeed();
      persist();
      return db.snapshot();
    },

    snapshot() {
      return JSON.parse(JSON.stringify(tables));
    },

    /** 供测试注入：直接替换整份数据（也可以用来预置场景）。 */
    replace(nextTables) {
      tables = { ...createSeed(), ...nextTables };
      persist();
      return db.snapshot();
    },

    count(table) {
      return (tables[table] ?? []).length;
    },

    now,
  };

  return db;
}

export { MAX_INTERESTS, ROLES };

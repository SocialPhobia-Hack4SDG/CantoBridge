/**
 * 账号 / 资料 / 设置（Phase 1）。
 *
 *   1. POST /api/auth/session          注册 / 登录：按 deviceId 建或复用真实账号
 *   2. GET  /api/me                    一次拿齐两份资料 + 设置 + 进度摘要
 *   3. PUT  /api/me/profile/learner    部分更新学习者资料（interests 上限 5）
 *   4. PUT  /api/me/profile/buddy      部分更新母语者资料（另一套字段）
 *   5. PUT  /api/me/settings           界面语言 / 匿名 / 可见范围 / 榜单可见性
 *
 * 字段级契约见 frontend/docs/10-api-v1.md 第 4.1 / 4.2 节；
 * `requestId` 幂等由 server.js 统一处理，这里只管业务。
 *
 * ## 为什么是 deviceId 而不是「演示账号」
 *
 * 以前所有请求都落回同一个 `DEMO_USER_ID`，两台设备其实是同一个人。现在
 * `deviceId` 是账号的钥匙：没见过的 `deviceId` → 建一个新账号（含两份空资料），
 * 见过的 → 复用。这样「有谁注册了就看见谁」才成立：列表里的每个人背后都有一台真设备。
 *
 * `role` 只进令牌，不进账号——一个账号两份资料（契约 2.3 / 2.4），切身份不会丢另一边。
 */

import { ApiError } from '../http/envelope.js';
import { earnedTitles } from '../lib/achievementTitles.js';
import { requireSession, issueToken } from '../http/auth.js';
import {
  BUDDY_TOPICS,
  IDENTITIES,
  INTERESTS,
  INTERFACE_LANGUAGES,
  LEARNING_GOALS,
  LEVELS,
  LANGUAGES_SPOKEN,
  MAX_BUDDY_TOPICS,
  MAX_INTERESTS,
  NATIVE_LANGUAGES,
  ROLES,
  VISIBILITY_KEYS,
} from '../data/vocabularies.js';
import { FRAME_IDS } from '../data/frames.js';
import { AVATAR_IDS, DEFAULT_AVATAR } from '../data/avatars.js';
import { DEVICE_ID_MAX } from '../store/seed.js';
import {
  assertBoolean,
  assertBooleanMap,
  assertEnum,
  assertEnumArray,
  assertKnownKeys,
  assertString,
} from './validate.js';

/** 服务端自有的字段：前端会把整份资料 PUT 上来，这里静默忽略而不是报 400。 */
const PROFILE_IGNORED = ['userId', 'accountId', 'role', 'onboarded', 'requestId'];

const LEARNER_FIELDS = ['nativeLanguage', 'cantoneseLevel', 'learningGoal', 'identity', 'interests', 'displayName', 'avatarId', 'frameId'];
const BUDDY_FIELDS = ['languagesSpoken', 'identity', 'interests', 'preferredTopics', 'wantToLearn', 'displayName', 'avatarId', 'frameId'];

function validateDisplayName(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new ApiError('bad_request', 'displayName must contain 2–16 characters');
  const name = value.trim();
  if ([...name].length < 2 || [...name].length > 16) throw new ApiError('bad_request', 'displayName must contain 2–16 characters');
  return name;
}

const SETTINGS_FIELDS = ['interfaceLanguage', 'anonymous', 'visibility', 'leaderboardVisible', 'equippedTitleId'];

function validateInterests(value) {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new ApiError('bad_request', 'interests must be an array');
  const normalized = value.map((item) => {
    if (typeof item !== 'string') throw new ApiError('bad_request', 'interests must contain strings');
    const tag = item.trim();
    if (!tag || /[\u0000-\u001f\u007f]/u.test(tag) || (!INTERESTS.includes(tag) && [...tag].length > 10)) {
      throw new ApiError('bad_request', 'custom interests must contain 1–10 characters');
    }
    return tag;
  });
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_INTERESTS) throw new ApiError('bad_request', 'interests allows at most 5 values');
  return unique;
}

/** 资料行里的内部字段（`accountId` / `role`）不下发：契约 2.3 / 2.4 的字段表里没有它们。 */
function publicProfile(row) {
  if (!row) return null;
  const { accountId, role, ...rest } = row;
  return rest;
}

/**
 * 设置 / 进度行里只有 `accountId` 是内部字段（用来定位账号），同样不下发：
 * 契约 2.5 / 2.7 的字段表里没有它，前端也不知道这个 id。
 */
function publicRow(row) {
  if (!row) return null;
  const { accountId, ...rest } = row;
  return rest;
}

export function createAccountHandlers({ db, events = null }) {
  function validateAvatar(value, accountId) {
    if (value === undefined) return;
    if (!AVATAR_IDS.includes(value)) throw new ApiError('bad_request', 'unknown avatar');
    if (!db.getWallet(accountId).ownedAvatars.includes(value)) throw new ApiError('forbidden', 'avatar is locked');
  }
  function validateFrame(value, accountId) {
    if (value === undefined) return;
    if (!FRAME_IDS.includes(value)) throw new ApiError('bad_request', 'unknown frame');
    if (!db.getWallet(accountId).ownedFrames.includes(value)) throw new ApiError('forbidden', 'frame is locked');
  }
  return {
    /**
     * POST /api/auth/session —— 注册 / 登录。
     *
     * `deviceId` 是账号的钥匙（前端生成一次、存 localStorage，之后每次都带）：
     *   - 没见过的 deviceId → 建一个新账号（两份资料都是出厂全空）
     *   - 见过的 deviceId   → 复用，刷新页面 / 换身份还是同一个人
     *
     * 所以两台设备天然是两个账号，互相能在列表里看见、也能互相选中——
     * 「有谁注册了就看见谁」这条要求就落在这里。
     */
    async session(ctx) {
      const body = ctx.body;
      assertKnownKeys(body, { allowed: ['role', 'deviceId'], ignored: ['requestId'] }, 'auth/session');
      const role = assertEnum(body.role, ROLES, 'role');
      if (role === undefined || role === null) throw new ApiError('bad_request', 'role is required');
      const deviceId = assertString(body.deviceId, 'deviceId', { maxLength: DEVICE_ID_MAX });
      if (deviceId === undefined) throw new ApiError('bad_request', 'deviceId is required');

      const known = db.findUserByDeviceId(deviceId);
      const userId = known ? known.userId : db.createAccount({ deviceId }).userId;
      // 选了身份 ≠ 填完资料：注册流程还没走完，所以不能顺手把 onboarded 打开。
      const session = issueToken(db, { userId, role });

      return {
        status: 201,
        data: {
          token: session.token,
          expiresAt: session.expiresAt,
          userId,
          role: session.role,
        },
      };
    },

    /**
     * POST /api/auth/logout —— 退出登录（契约 4.1）。
     *
     * 只作废**当前这一条**令牌：同一账号在另一台设备 / 另一个标签页上的会话照旧
     * （`sessions` 是按令牌存的，不是按账号）。前端那边「退出并换人」还会顺手把本机
     * 存档与设备 id 一起换掉——那是前端的事，这里只管服务端这条会话。
     *
     * 令牌本来就失效时回 401 `not_authorized`：前端拿到 401 也会把本地令牌清干净
     * （见 `services/httpApi.js` 的 `signOut`），所以「重复退出」不会留下任何东西。
     */
    async logout(ctx) {
      assertKnownKeys(ctx.body, { allowed: [], ignored: ['requestId'] }, 'auth/logout');
      const session = requireSession(ctx.req, db);
      db.deleteSession(session.token);
      return { data: { ok: true } };
    },

    /** GET /api/me —— 首屏一次拿齐，别让前端打三次 */
    async me(ctx) {
      const session = requireSession(ctx.req, db);
      return {
        data: {
          userId: session.userId,
          learnerProfile: publicProfile(db.getProfile(session.userId, 'learner')),
          buddyProfile: publicProfile(db.getProfile(session.userId, 'buddy')),
          settings: publicRow(db.getSettings(session.userId)),
          progress: { ...publicRow(db.getProgress(session.userId)), wallet: db.getWallet(session.userId) },
        },
      };
    },

    /** PUT /api/me/profile/learner —— 部分更新，响应回整份资料 */
    async updateLearnerProfile(ctx) {
      const session = requireSession(ctx.req, db);
      const body = ctx.body;
      assertKnownKeys(body, { allowed: LEARNER_FIELDS, ignored: PROFILE_IGNORED }, 'me/profile/learner');

      const patch = {};
      if (body.nativeLanguage !== undefined) {
        if (body.nativeLanguage === null) patch.nativeLanguage = null;
        else {
          const language = body.nativeLanguage;
          if (typeof language !== 'string' || !language.trim() || [...language.trim()].length > 10 || /[\u0000-\u001f\u007f]/u.test(language)) {
            throw new ApiError('bad_request', 'nativeLanguage must contain 1–10 characters');
          }
          patch.nativeLanguage = language.trim();
        }
      }
      if (body.cantoneseLevel !== undefined) {
        patch.cantoneseLevel = assertEnum(body.cantoneseLevel, LEVELS, 'cantoneseLevel');
      }
      if (body.learningGoal !== undefined) {
        patch.learningGoal = assertEnum(body.learningGoal, LEARNING_GOALS, 'learningGoal');
      }
      if (body.identity !== undefined) {
        patch.identity = assertEnum(body.identity, IDENTITIES, 'identity');
      }
      if (body.interests !== undefined) {
        patch.interests = validateInterests(body.interests);
      }

      const displayName = validateDisplayName(body.displayName);
      validateAvatar(body.avatarId, session.userId);
      validateFrame(body.frameId, session.userId);
      if (body.frameId !== undefined) db.updateFrame(session.userId, body.frameId);
      if (body.avatarId !== undefined) db.updateAvatar(session.userId, body.avatarId);
      if (displayName !== undefined) db.updateDisplayName(session.userId, displayName);
      const profile = db.updateProfile(session.userId, 'learner', patch);
      return { data: { learnerProfile: publicProfile(profile) } };
    },

    /** PUT /api/me/profile/buddy —— 另一套字段（会说语言 / 想聊话题 / 回礼） */
    async updateBuddyProfile(ctx) {
      const session = requireSession(ctx.req, db);
      const body = ctx.body;
      assertKnownKeys(body, { allowed: BUDDY_FIELDS, ignored: PROFILE_IGNORED }, 'me/profile/buddy');

      const patch = {};
      if (body.languagesSpoken !== undefined) {
        patch.languagesSpoken = assertEnumArray(body.languagesSpoken, LANGUAGES_SPOKEN, 'languagesSpoken', { max: 3 });
      }
      if (body.identity !== undefined) {
        patch.identity = assertEnum(body.identity, IDENTITIES, 'identity');
      }
      if (body.interests !== undefined) {
        patch.interests = validateInterests(body.interests);
      }
      if (body.preferredTopics !== undefined) {
        patch.preferredTopics = assertEnumArray(body.preferredTopics, BUDDY_TOPICS, 'preferredTopics', {
          max: MAX_BUDDY_TOPICS,
        });
      }
      // 回礼「我也想练 X」：取值是**母语词表去掉粤语**（契约 2.4 / 3.6）——
      // mandarin / english / other 三个都收，别拿 languagesSpoken 来筛（它没有 other）。
      if (body.wantToLearn !== undefined) {
        patch.wantToLearn = assertEnumArray(
          body.wantToLearn,
          NATIVE_LANGUAGES.filter((value) => value !== 'yue'),
          'wantToLearn',
          { max: NATIVE_LANGUAGES.length },
        );
      }

      const displayName = validateDisplayName(body.displayName);
      validateAvatar(body.avatarId, session.userId);
      validateFrame(body.frameId, session.userId);
      if (body.frameId !== undefined) db.updateFrame(session.userId, body.frameId);
      if (body.avatarId !== undefined) db.updateAvatar(session.userId, body.avatarId);
      if (displayName !== undefined) db.updateDisplayName(session.userId, displayName);
      const profile = db.updateProfile(session.userId, 'buddy', patch);
      return { data: { buddyProfile: publicProfile(profile) } };
    },

    /** PUT /api/me/settings */
    async updateSettings(ctx) {
      const session = requireSession(ctx.req, db);
      const body = ctx.body;
      assertKnownKeys(body, { allowed: SETTINGS_FIELDS, ignored: ['requestId'] }, 'me/settings');

      const patch = {};
      if (body.equippedTitleId !== undefined) {
        if (body.equippedTitleId !== null && !earnedTitles(db.getProgress(session.userId) ?? {}).includes(body.equippedTitleId)) {
          throw new ApiError('bad_request', 'Title must be unlocked before equipping', 400);
        }
        patch.equippedTitleId = body.equippedTitleId;
      }
      if (body.interfaceLanguage !== undefined) {
        patch.interfaceLanguage = assertEnum(body.interfaceLanguage, INTERFACE_LANGUAGES, 'interfaceLanguage');
      }
      if (body.anonymous !== undefined) patch.anonymous = assertBoolean(body.anonymous, 'anonymous');
      if (body.leaderboardVisible !== undefined) {
        patch.leaderboardVisible = assertBoolean(body.leaderboardVisible, 'leaderboardVisible');
      }
      if (body.visibility !== undefined) {
        patch.visibility = assertBooleanMap(body.visibility, VISIBILITY_KEYS, 'visibility');
      }

      const settings = db.updateSettings(session.userId, patch);
      if (body.equippedTitleId !== undefined) {
        try { events?.('queue:updated'); } catch { /* 信令失败不影响设置保存 */ }
      }
      return { data: { settings: publicRow(settings) } };
    },

    /**
     * POST /api/dev/reset —— 演示辅助（契约外，见 README）。
     * 连账号一起清掉：出厂就是空的，想重演「两台设备注册」用这个最快。
     */
    async reset(ctx) {
      assertKnownKeys(ctx.body, { allowed: [], ignored: ['requestId'] }, 'dev/reset');
      db.reset();
      return { data: { reset: true, users: 0 } };
    },
  };
}

export { LEARNER_FIELDS, BUDDY_FIELDS, SETTINGS_FIELDS, publicProfile };

/**
 * 全局状态（零依赖，可在 Node 里单测）。
 *
 * 分层与 docs/09 第 2.7 节一致：
 *   - 持久化：当前身份、界面语言、两份身份资料、设置、社交记录、进度
 *   - 内存：排队状态、当前房间、本次结算
 * 关键约定：learnerProfile 与 buddyProfile **分开保存**，切换身份不丢数据。
 */

import { DEFAULT_THEME, normalizeTheme } from '../data/themes.js';
import { buddyRelation, newlyUnlocked, unlockedAchievements, uniqueList, xpFor } from '../lib/logic.js';

/**
 * 存档格式版本。**改了资料模型或出厂默认值就必须 +1**：旧存档里存着上一版的
 * 出厂值，直接合并会把「已经清空的默认选项」又塞回来（本轮出厂的兴趣/身份
 * 都改成空，用户浏览器里却还能看到「电影 / 游戏 / 美食」被预选，就是这个原因）。
 * 版本对不上时整份存档作废，回到出厂状态。
 *
 * v1 → v2：两份资料的出厂值全部清空（母语 / 水平 / 学习目标 / 身份 / 兴趣 /
 * 想聊话题 / 回礼都不预选）。
 * v3 → v4：出厂数据里**再没有任何假人**——伙伴 / 申请 / 收藏 / 进度一律空，
 * 资料 id 也从「写死的演示账号」改成「按本机设备 id 派生」（见 ensureDeviceId）。
 * 不 +1 的话，浏览器里那份 v3 存档会把 ka-ho、wai-ling 这些假人原样带进新版本，
 * 于是「列表里只有真实注册的人」当场失效。
 */
export const STORAGE_VERSION = 4;
export const STORAGE_KEY = 'cantobridge:v4';

/**
 * 设备 id 的存储键。**故意不放进上面那份带版本闸门的存档里**：
 * 存档升级时会整份作废重来，而设备 id 是「这台机器就是这个账号」的钥匙，
 * 一旦跟着作废换一个新的，同一台手机刷新一次就变成另一个账号，
 * 两台设备的演示会莫名其妙地互相看不见。
 */
export const DEVICE_KEY = 'cantobridge:device';

/** 设备 id 是账号钥匙：新账号使用浏览器密码学随机值，旧账号继续复用。 */
export function newDeviceId() {
  if (globalThis.crypto?.randomUUID) return 'd-' + globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(24);
  if (!globalThis.crypto?.getRandomValues) throw new Error('注册需要安全浏览器环境，请通过 HTTPS 打开');
  globalThis.crypto.getRandomValues(bytes);
  return 'd-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * 资料 id 的派生规则，与后端 `backend/src/store/seed.js` 的 `profileIdFor` **同一套**：
 * 一个账号两份资料，各自一个 id。两边规则不一致的话，`/me` 回来之后
 * 「我的」页显示的资料 id 会和本机算出来的对不上（本地镜像关系表时按 id 比对）。
 */
export function profileIdFor(deviceId, role) {
  return `${role}-${deviceId}`;
}

/** 读设备 id，没有就现生成一个并落盘（**只生成一次**，之后所有会话共用）。 */
function ensureDeviceId(adapter) {
  const existing = adapter.getItem(DEVICE_KEY);
  if (existing) return String(existing);
  return rotateDeviceId(adapter);
}

/**
 * 换一把新钥匙并落盘。**只有「退出并换人」会调它**（见 `resetAccount`）——
 * 设备 id 就是账号本身，换掉它等于把这台机器变成一台没注册过的新机器。
 */
function rotateDeviceId(adapter) {
  const created = newDeviceId();
  adapter.setItem(DEVICE_KEY, created);
  return created;
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * 设备级偏好：**跟着这台手机走，不跟着账号走**。
 *
 * 「退出并换人」只换账号，所以这些要留下。其中 `signalMode` 是必须留的：真后端档位下
 * 它在启动时被升到 `remote`（见 `services/index.js` 的 `resolveSignalMode`），
 * 跟着账号退回 `sim` 的话，两台设备都只会看到假波形、听不到声音，而且**当场看不出来**
 * ——正是那个「最难查」的失败模式。
 *
 * 其余设置（`anonymous` / `visibility` / `leaderboardVisible`）是服务端的账号数据
 * （契约 2.5 节），随账号一起回到出厂。
 */
const DEVICE_SETTINGS = [
  'theme',
  'signalMode',
  'mockDelayMs',
  'cardLevelOverride',
  'autoMatch',
  'backgroundMatch',
  'matchAcceptSeconds',
  'matchCriteria',
];

function deviceSettingsOf(settings) {
  const out = {};
  for (const key of DEVICE_SETTINGS) {
    if (settings?.[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

function resolveStorage(candidate) {
  if (candidate) return candidate;
  const globalStorage = globalThis.localStorage;
  if (globalStorage && typeof globalStorage.getItem === 'function') return globalStorage;
  return createMemoryStorage();
}

/**
 * 出厂状态。**一个假人都没有**：伙伴 / 申请 / 收藏 / 通话记录 / 进度全部为空，
 * 资料 id 由本机设备 id 派生。
 *
 * 为什么连出厂进度也要清空：以前的 `INITIAL_PROGRESS` 带着 360 XP、46 分钟、
 * 6 个话题。那些数字会让「谁都没练过」的新设备一进去就排在榜首，
 * 而榜单上其它行又是编出来的人——现场根本分不清哪个是真账号。
 *
 * @param {object} [options]
 * @param {string} [options.deviceId] 本机设备 id；不给就现生成一个（单测直接用）。
 */
export function createDefaultState({ deviceId = newDeviceId() } = {}) {
  return {
    role: 'learner',
    locale: 'zh-Hans',
    /**
     * 出厂资料**不预选任何一项**：注册问卷一进来每道题都是空的，用户自己选。
     * `onboarded` 两份都是 false：一台没注册过的设备要先走完 onboarding，
     * 对面才看得到一个有母语、有兴趣的人——「谁注册了就看见谁」的前提就是真注册过。
     */
    learnerProfile: {
      userId: profileIdFor(deviceId, 'learner'),
      avatarId: 'neutral',
      frameId: 'none',
      nativeLanguage: null,
      cantoneseLevel: null,
      learningGoal: null,
      identity: null,
      interests: [],
      onboarded: false,
    },
    buddyProfile: {
      userId: profileIdFor(deviceId, 'buddy'),
      avatarId: 'neutral',
      frameId: 'none',
      languagesSpoken: [],
      identity: null,
      interests: [],
      preferredTopics: [],
      /**
       * 可选的回礼「我也想练 X」（取值同 NATIVE_LANGUAGES，不含粤语）。
       * 空数组 = 没填：照样能匹配，只是没有互补加成（只影响排序，不筛选）。
       */
      wantToLearn: [],
      onboarded: false,
    },
    settings: {
      // 默认实名；用户需要时可在「我的 → 设置」主动开启匿名模式。
      anonymous: false,
      leaderboardVisible: true,
      equippedTitleId: null,
      visibility: { interests: true, level: true, identity: true },
      signalMode: 'sim',
      mockDelayMs: 400,
      cardLevelOverride: null,
      autoMatch: false,
      /** 后台匹配：离开匹配页后排队继续（可在 /dev/mock 关掉，对照旧手感）。 */
      backgroundMatch: true,
      /** 匹配成功后「接受 / 不接受」弹窗的倒计时上限（秒），现场可调。 */
      matchAcceptSeconds: 10,
      /**
       * 自定义匹配条件（兴趣主题 id 数组）：null = 还没自定义过，按资料里的兴趣找；
       * 数组 = 就按这一套找。全部主题都被勾上（`coversAllOptions`）等于「随便聊」，界面上不罗列。
       * 放在 settings 里是为了刷新之后还留着——这是用户的偏好，不是一次排队的临时状态。
       */
      matchCriteria: null,

      /**
       * 配色主题 id（见 src/data/themes.js）。放在 settings 里是为了刷新之后还留着——
       * 主题是用户的偏好，不是一次性的界面状态。界面只认 <html data-theme>，
       * 改这个值由 app.js 的 applyTheme 落到 DOM 上。
       */
      theme: DEFAULT_THEME,
    },
    /**
     * 社交关系分三张表，伙伴关系是**双向**的：
     *   - buddies：已经互相接受的伙伴
     *   - buddyRequests：待确认的申请（direction 区分收到 / 发出）
     *   - history：通话记录（不再自己存「是否已标记」的布尔值，一律由上面两张表推导）
     *
     * 出厂全空：以前预置的 ka-ho / wai-ling 是编出来的人，没有对应的设备在等，
     * 于是「点接受」永远只改本机状态，对面什么也不会发生。
     */
    social: {
      buddies: [],
      buddyRequests: [],
      savedPhrases: [],
      history: [],
    },
    /** 新设备的进度：全部归零。有谁真的聊过，数字自己会长出来。 */
    progress: {
      xp: 0,
      streakDays: 0,
      totalMinutes: 0,
      conversations: 0,
      peopleHelped: 0,
      distinctTopics: 0,
      practiceMinutesThisWeek: 0,
      topicsSeen: [],
      achievements: [],
    },
  };
}

/**
 * 内存态：刷新即丢。
 *   - queue        排队状态（挂在 store 上，因此进出 /match 不会重置等待）
 *   - matchRequest  匹配成功后待「接受 / 不接受」的请求（弹窗读它）
 *   - room / reward / notice
 *   - onboarding   进入 onboarding 时的还原点（角色 + 两份资料）：退出即还原，走完即作废
 *   - matchPeers   匹配频道推来的「对面此刻有空的人」。**null = 还没收到过推送**，
 *                  页面据此回落到自己从 REST 拉的那份（见 app/matchSync.js）
 */
function createRuntime() {
  return {
    queue: null,
    room: null,
    reward: null,
    notice: null,
    matchRequest: null,
    onboarding: null,
    matchPeers: null,
  };
}

export function createStore({ storage, now = () => Date.now() } = {}) {
  const adapter = resolveStorage(storage);
  const listeners = new Set();
  /**
   * 本机设备 id：在**建 store 的时候定一次**，之后整条生命周期都用它。
   * 每次读都重新解析是不行的——`resetDemoData()` 之后必须还是同一个账号，
   * 否则「清空本机数据」会顺手把用户换成一个新账号。
   *
   * 它是 `let` 而不是 `const`，因为 `resetAccount()` 要**故意**换掉它：那才是
   * 「退出并换人」与「清空演示数据」的区别（一个换账号、一个不换）。
   */
  let deviceId = ensureDeviceId(adapter);

  function load() {
    const defaults = createDefaultState({ deviceId });
    const raw = adapter.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      // 版本闸门：只认同版本存档，旧的一律丢弃（否则旧出厂值会盖住新的空默认）
      if (parsed.version !== STORAGE_VERSION) return defaults;
      return {
        ...defaults,
        ...parsed,
        settings: {
          ...defaults.settings,
          ...(parsed.settings ?? {}),
          visibility: { ...defaults.settings.visibility, ...(parsed.settings?.visibility ?? {}) },
        },
        social: { ...defaults.social, ...(parsed.social ?? {}) },
        progress: { ...defaults.progress, ...(parsed.progress ?? {}) },
        learnerProfile: { ...defaults.learnerProfile, ...(parsed.learnerProfile ?? {}) },
        buddyProfile: { ...defaults.buddyProfile, ...(parsed.buddyProfile ?? {}) },
      };
    } catch {
      return defaults;
    }
  }

  let state = { ...load(), runtime: createRuntime() };

  function persistedSlice() {
    const { role, locale, learnerProfile, buddyProfile, settings, social, progress } = state;
    return { version: STORAGE_VERSION, role, locale, learnerProfile, buddyProfile, settings, social, progress };
  }

  function persist() {
    adapter.setItem(STORAGE_KEY, JSON.stringify(persistedSlice()));
  }

  function notify() {
    for (const listener of listeners) listener(state);
  }

  function set(mutator) {
    mutator(state);
    persist();
    notify();
    return state;
  }

  function profileKeyFor(role) {
    return role === 'buddy' ? 'buddyProfile' : 'learnerProfile';
  }

  function stats() {
    const { progress } = state;
    return {
      conversations: progress.conversations,
      totalMinutes: progress.totalMinutes,
      streakDays: progress.streakDays,
      distinctTopics: Math.max(progress.distinctTopics ?? 0, (progress.topicsSeen ?? []).length),
      peopleHelped: progress.peopleHelped,
    };
  }

  const actions = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setLocale(locale) {
      return set((draft) => {
        draft.locale = locale;
      });
    },

    /** 切换身份：只改 role，两份资料都原样保留。 */
    setRole(role) {
      if (role !== 'learner' && role !== 'buddy') return state;
      return set((draft) => {
        draft.role = role;
      });
    },

    saveRoleProfile(role, patch) {
      return set((draft) => {
        const key = profileKeyFor(role);
        draft[key] = { ...draft[key], ...patch, onboarded: Object.keys(patch).every(key => ['avatarId', 'frameId'].includes(key)) ? draft[key].onboarded : true };
        if (patch.frameId !== undefined) {
          draft.learnerProfile.frameId = patch.frameId;
          draft.buddyProfile.frameId = patch.frameId;
        }
        if (patch.avatarId !== undefined) {
          draft.learnerProfile.avatarId = patch.avatarId;
          draft.buddyProfile.avatarId = patch.avatarId;
        }
        if (patch.displayName !== undefined) {
          draft.learnerProfile.displayName = patch.displayName;
          draft.buddyProfile.displayName = patch.displayName;
        }
      });
    },
    hydrateWallet(wallet) {
      return set((draft) => { draft.progress.wallet = wallet; });
    },

    /**
     * 进入 onboarding（身份选择 / 资料与标签 / 隐私）时立一个还原点：切换前的角色 + 两份资料。
     * 只在没有还原点时快照——三页之间来回走、每次重渲染都会调它，不能把「改了一半的状态」盖成还原点。
     */
    beginOnboarding() {
      if (state.runtime.onboarding) return state;
      const snapshot = JSON.parse(
        JSON.stringify({
          role: state.role,
          learnerProfile: state.learnerProfile,
          buddyProfile: state.buddyProfile,
        }),
      );
      return set((draft) => {
        draft.runtime.onboarding = snapshot;
      });
    },

    /**
     * 退出 onboarding：整段填写作废，角色与两份资料一起还原到进入之前。
     * 只还原 role 是不够的：用户可能在资料页点过「暂时跳过」再退到隐私页，那一笔也要一起退回。
     */
    cancelOnboarding() {
      const snapshot = state.runtime.onboarding;
      if (!snapshot) return state;
      return set((draft) => {
        draft.role = snapshot.role;
        draft.learnerProfile = { ...snapshot.learnerProfile };
        draft.buddyProfile = { ...snapshot.buddyProfile };
        draft.runtime.onboarding = null;
      });
    },

    /** 走完 onboarding（隐私页的「完成设置」）：还原点作废，这一轮的改动正式生效。 */
    commitOnboarding() {
      if (!state.runtime.onboarding) return state;
      return set((draft) => {
        draft.runtime.onboarding = null;
      });
    },

    saveSettings(patch) {
      return set((draft) => {
        draft.settings = {
          ...draft.settings,
          ...patch,
          visibility: { ...draft.settings.visibility, ...(patch.visibility ?? {}) },
        };
      });
    },

    /**
     * 用**服务端返回的资料**灌本地（HTTP 档位专用：`GET /api/me` 之后调用）。
     *
     * 与 `saveRoleProfile()` 的区别只有一个，但很关键：**不动 `onboarded`**。
     * `saveRoleProfile` 是「用户刚填完一页」的语义，会把 `onboarded` 置 true；
     * 而同步一份服务端资料不代表注册走完了——否则路由守卫会把还没填资料的人放进主链路。
     */
    hydrate({ learnerProfile, buddyProfile, settings } = {}) {
      return set((draft) => {
        if (learnerProfile) draft.learnerProfile = { ...draft.learnerProfile, ...learnerProfile };
        if (buddyProfile) draft.buddyProfile = { ...draft.buddyProfile, ...buddyProfile };
        if (settings) {
          draft.settings = {
            ...draft.settings,
            ...settings,
            visibility: { ...draft.settings.visibility, ...(settings.visibility ?? {}) },
          };
        }
      });
    },

    /**
     * 伙伴关系的**精确镜像**：把服务端的 `buddies` / `buddyRequests` 覆盖到本地。
     *
     * 为什么不用粒度的 `sendBuddyRequest` / `acceptBuddyRequest` 来镜像：
     * 那些动作按**本地**关系决定走向，而本地那份可能和服务端不一致（真联调时抓到过：
     * 本地认为对面那条是「收到的申请」，服务端其实是我发出的待处理，粒度动作会把它
     * 错误地变成伙伴）。所以镜像一律以**服务端返回为准**，只替换传入的那张表。
     */
    hydrateSocial({ buddies, buddyRequests } = {}) {
      return set((draft) => {
        draft.social = {
          ...draft.social,
          ...(Array.isArray(buddies) ? { buddies } : {}),
          ...(Array.isArray(buddyRequests) ? { buddyRequests } : {}),
        };
      });
    },

    /** 切换配色主题：任何越界值都收敛回默认主题，界面不会落到「没有变量」的状态。 */
    setTheme(theme) {
      if (!['mint', 'warm', ...(state.progress.wallet?.ownedThemes ?? [])].includes(theme) && normalizeTheme(theme) !== 'mint') return state;
      return set((draft) => {
        draft.settings = { ...draft.settings, theme: normalizeTheme(theme) };
      });
    },

    setVisibility(key, value) {
      return set((draft) => {
        draft.settings.visibility = { ...draft.settings.visibility, [key]: Boolean(value) };
      });
    },

    startQueue({ anonymous } = {}) {
      return set((draft) => {
        draft.runtime.queue = { joinedAt: now(), anonymous: anonymous ?? draft.settings.anonymous };
      });
    },

    cancelQueue() {
      return set((draft) => {
        draft.runtime.queue = null;
        draft.runtime.matchRequest = null;
      });
    },

    /**
     * 收到一条匹配请求（服务端口径：`match:matched` 事件；mock 口径：演示辅助）。
     * 幂等：已有待处理请求或已在房间里时不会覆盖，避免后台定时器重复弹窗。
     */
    receiveMatchRequest({ requestId = null, roomId, peer, expiresAt = null, reason = 'background' } = {}) {
      if (!roomId || !peer) return { status: 'invalid' };
      if (state.runtime.room) return { status: 'busy' };
      // 已经有一条待接受请求：**把仍然生效的那一条原样报回去**（连 requestId 一起），
      // 不能只回 status —— 调用方要据此知道自己手里那条到底算不算数。
      if (state.runtime.matchRequest) {
        return { status: 'pending', ...state.runtime.matchRequest };
      }
      set((draft) => {
        draft.runtime.matchRequest = {
          requestId,
          roomId,
          peer,
          reason,
          expiresAt,
          createdAt: new Date(now()).toISOString(),
        };
      });
      return { status: 'pending', requestId, roomId };
    },

    /**
     * 匹配频道推来的候选人列表（`queue:updated`，见 `app/matchSync.js`）。
     *
     * 只覆盖**列表本身**，不动页面自己拉的那份：`matchPeers` 为 `null` 表示
     * 「还没收到过推送」，页面据此回落到 REST 结果。这样断线时列表不会突然变空。
     */
    hydrateMatchPeers(entries) {
      return set((draft) => {
        draft.runtime.matchPeers = Array.isArray(entries) ? entries : [];
      });
    },

    /**
     * 某位候选人被摘走（`match:taken`）：从推送列表里淡出。
     * 没收到过推送（`matchPeers` 为 null）时什么都不做——那份列表归页面自己管。
     */
    dropMatchPeer(peerId) {
      const list = state.runtime.matchPeers;
      if (!Array.isArray(list)) return { status: 'none' };
      const next = list.filter((row) => row?.peerId !== peerId);
      if (next.length === list.length) return { status: 'none' };
      set((draft) => {
        draft.runtime.matchPeers = next;
      });
      return { status: 'dropped' };
    },

    /** 接受匹配请求 → 直接成房（房间号来自请求本身）。 */
    acceptMatchRequest() {
      const request = state.runtime.matchRequest;
      if (!request) return { status: 'none' };
      set((draft) => {
        draft.runtime.matchRequest = null;
        draft.runtime.room = {
          roomId: request.roomId,
          peer: request.peer,
          role: draft.role,
          startedAt: now(),
          status: 'connecting',
        };
        draft.runtime.queue = null;
        draft.runtime.reward = null;
      });
      return { status: 'accepted', roomId: request.roomId, peer: request.peer };
    },

    /**
     * 不接受（或倒计时到点）。人留在等待队列里，等待计时**不清零**——
     * 「已等待」记录的是这个人等了多久，不该因为拒绝了一位伙伴就假装回到起点。
     * 下一次什么时候再匹配，交给 app 层引擎的冷却时间（见 app.js 的 matchRunner），
     * 这样也不会出现「刚拒绝完马上又弹一个」的骚扰循环。
     * 注意与「取消等待」（cancelQueue）区分：那个才是真的退出匹配。
     */
    declineMatchRequest({ expired = false } = {}) {
      if (!state.runtime.matchRequest) return { status: 'none' };
      set((draft) => {
        draft.runtime.matchRequest = null;
      });
      return { status: expired ? 'expired' : 'declined' };
    },

    startRoom({ roomId, peer, role }) {
      return set((draft) => {
        draft.runtime.room = {
          roomId,
          peer,
          role: role ?? draft.role,
          startedAt: now(),
          status: 'connecting',
        };
        draft.runtime.queue = null;
        draft.runtime.matchRequest = null;
        draft.runtime.reward = null;
      });
    },

    setRoomStatus(status) {
      return set((draft) => {
        if (draft.runtime.room) draft.runtime.room.status = status;
      });
    },

    endRoom() {
      return set((draft) => {
        if (draft.runtime.room) draft.runtime.room.status = 'ended';
      });
    },

    /** 结算：写入进度、历史与积分，并返回本次新解锁的成就。 */
    recordSession({ peerId, peerLabel, durationSec, cardsUsed, topics = [], role } = {}) {
      const activeRole = role ?? state.role;
      const before = unlockedAchievements(activeRole, stats());
      const xpEarned = xpFor(durationSec, cardsUsed);
      const minutes = Math.round((durationSec ?? 0) / 60);

      set((draft) => {
        const progress = draft.progress;
        progress.xp += xpEarned;
        if (progress.wallet) progress.wallet.balance += xpEarned;
        progress.conversations += 1;
        progress.totalMinutes += minutes;
        progress.practiceMinutesThisWeek = (progress.practiceMinutesThisWeek ?? 0) + minutes;
        if (activeRole === 'buddy') progress.peopleHelped += 1;
        progress.topicsSeen = uniqueList([...(progress.topicsSeen ?? []), ...topics]);
        progress.distinctTopics = Math.max(progress.distinctTopics ?? 0, progress.topicsSeen.length);

        draft.social.history = [
          {
            sessionId: 's-' + now(),
            peerId,
            peerLabel,
            role: activeRole,
            startedAt: new Date(now()).toISOString(),
            durationSec,
            cardsUsed,
            topics,
          },
          ...(draft.social.history ?? []),
        ];
      });

      const after = unlockedAchievements(activeRole, stats());
      return { xpEarned, unlocked: newlyUnlocked(before, after) };
    },

    /**
     * 发出伙伴申请——双向关系的第一步，**不是**单方面把人存成伙伴。
     *
     * 规则（与 docs/03 第 5.7 / 5.8 节一致）：
     *   - 已经是伙伴 → 什么都不做，返回 `{ status: 'buddy' }`
     *   - 我已经发过申请 → 不重复发，返回 `{ status: 'pending' }`
     *   - 对方也申请过我 → 双方都同意了，直接成为伙伴，返回 `{ status: 'accepted' }`
     *   - 其他 → 新增一条 outgoing pending，返回 `{ status: 'pending' }`
     */
    sendBuddyRequest(peerId, label, { roomId = null } = {}) {
      const relation = buddyRelation(peerId, state.social);
      if (relation.state === 'buddy') return { status: 'buddy' };
      if (relation.state === 'pending-out') return { status: 'pending' };
      if (relation.state === 'pending-in') {
        actions.acceptBuddyRequest(peerId);
        return { status: 'accepted' };
      }
      set((draft) => {
        draft.social.buddyRequests = [
          ...(draft.social.buddyRequests ?? []),
          {
            requestId: 'req-' + now() + '-' + peerId,
            peerId,
            label: label ?? peerId,
            direction: 'outgoing',
            status: 'pending',
            roomId,
            createdAt: new Date(now()).toISOString(),
            respondedAt: null,
          },
        ];
      });
      return { status: 'pending' };
    },

    /** 接受申请（收到的，或演示时替对方接受我发出的）→ 写入伙伴表并从申请表移除。 */
    acceptBuddyRequest(peerId) {
      const relation = buddyRelation(peerId, state.social);
      if (relation.state === 'buddy') return { status: 'buddy' };
      if (relation.state === 'none') return { status: 'none' };
      const label = relation.request?.label ?? peerId;
      set((draft) => {
        draft.social.buddyRequests = (draft.social.buddyRequests ?? []).filter(
          (item) => item.peerId !== peerId,
        );
        if (!(draft.social.buddies ?? []).some((item) => item.peerId === peerId)) {
          draft.social.buddies = [
            ...(draft.social.buddies ?? []),
            { peerId, label, since: new Date(now()).toISOString() },
          ];
        }
      });
      return { status: 'accepted' };
    },

    /** 拒绝对方发来的申请：申请直接移除，不留下尴尬记录。 */
    declineBuddyRequest(peerId) {
      const relation = buddyRelation(peerId, state.social);
      if (relation.state !== 'pending-in') return { status: relation.state };
      set((draft) => {
        draft.social.buddyRequests = (draft.social.buddyRequests ?? []).filter(
          (item) => item.peerId !== peerId,
        );
      });
      return { status: 'declined' };
    },

    /** 撤回我自己发出的申请，回到「没关系」状态。 */
    cancelBuddyRequest(peerId) {
      const relation = buddyRelation(peerId, state.social);
      if (relation.state !== 'pending-out') return { status: relation.state };
      set((draft) => {
        draft.social.buddyRequests = (draft.social.buddyRequests ?? []).filter(
          (item) => item.peerId !== peerId,
        );
      });
      return { status: 'cancelled' };
    },

    /** 解除伙伴关系（只删 buddies，不影响通话记录）。 */
    removeBuddy(peerId) {
      set((draft) => {
        draft.social.buddies = (draft.social.buddies ?? []).filter((item) => item.peerId !== peerId);
      });
      return { status: 'removed' };
    },

    /** 演示辅助：模拟「对方给我发来一条申请」，供 /dev/mock 一键触发。 */
    receiveBuddyRequest(peerId, label) {
      const relation = buddyRelation(peerId, state.social);
      if (relation.state !== 'none') return { status: relation.state };
      set((draft) => {
        draft.social.buddyRequests = [
          ...(draft.social.buddyRequests ?? []),
          {
            requestId: 'req-' + now() + '-' + peerId,
            peerId,
            label: label ?? peerId,
            direction: 'incoming',
            status: 'pending',
            roomId: null,
            createdAt: new Date(now()).toISOString(),
            respondedAt: null,
          },
        ];
      });
      return { status: 'pending-in' };
    },

    savePhrase(phrase) {
      return set((draft) => {
        const exists = (draft.social.savedPhrases ?? []).some(
          (item) => item.cantonese === phrase.cantonese,
        );
        if (exists) return;
        draft.social.savedPhrases = [
          { ...phrase, savedAt: new Date(now()).toISOString() },
          ...(draft.social.savedPhrases ?? []),
        ];
      });
    },

    /** 结算结果只放在内存里，刷新即丢（此时走 02 兜底矩阵第 9 条）。 */
    setReward(reward) {
      return set((draft) => {
        draft.runtime.reward = reward;
      });
    },

    setNotice(notice) {
      return set((draft) => {
        draft.runtime.notice = notice;
      });
    },

    /**
     * 清空本机数据、**账号不变**：存档作废重来，设备 id 原样保留。
     * 演示控制台的「重置演示数据」走它——同一台手机还是同一个人。
     */
    resetDemoData() {
      adapter.removeItem(STORAGE_KEY);
      state = { ...createDefaultState({ deviceId }), runtime: createRuntime() };
      persist();
      notify();
      return state;
    },

    /**
     * 退出并换人：清掉存档**并换一把新钥匙**，这台机器从此是一台没注册过的机器。
     *
     * 与 `resetDemoData()` 的差别只有一条，但很关键：设备 id 是账号本身
     * （契约 4.1.1），不换它的话「退出」之后下一个人点注册，服务端会按同一个
     * `deviceId` 认出上一个账号——退了个寂寞，还是同一个人。
     *
     * **不碰服务端**：旧账号仍留在后端（可在演示控制台重置）。清服务端那条会话
     * 是 `api.signOut()` 的事，由 app 层把两件事串起来（见 `app.js` 的 `auth.signOut`）。
     */
    resetAccount() {
      // 先留一份「这台手机的偏好」，换完钥匙再盖回去（见 DEVICE_SETTINGS 的说明）。
      // 界面语言与配色是设备的，不是账号的——下一任用户接着用这台手机，不该被换掉。
      const keepLocale = state.locale;
      const keepSettings = deviceSettingsOf(state.settings);
      // 付费配色属于原账号；换人时只能保留免费配色。
      if (!['mint', 'warm'].includes(keepSettings.theme)) keepSettings.theme = DEFAULT_THEME;
      adapter.removeItem(STORAGE_KEY);
      deviceId = rotateDeviceId(adapter);
      state = { ...createDefaultState({ deviceId }), locale: keepLocale, runtime: createRuntime() };
      state.settings = { ...state.settings, ...keepSettings };
      persist();
      notify();
      return state;
    },

    getState() {
      return state;
    },

    /**
     * 本机设备 id：账号的钥匙（契约 4.1 的 `POST /api/auth/session` 要它）。
     * 落盘在独立键里，不进带版本闸门的存档——见 `DEVICE_KEY` 的说明。
     */
    deviceId() {
      return deviceId;
    },

    /**
     * 暴露注入的时钟：app 层的后台匹配与 mock 层造时间戳都必须用同一个时钟，
     * 否则测试里把时钟拨快之后，倒计时会算出一个荒谬的秒数。
     */
    now,

    stats,
  };

  return actions;
}

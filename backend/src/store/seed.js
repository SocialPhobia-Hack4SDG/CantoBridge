/**
 * 出厂种子：**空**。
 *
 * 这里以前预置过一个演示账号 + 4 位假学习者 + 3 位假母语者 + 一份假进度。全部删掉了，
 * 理由只有一条：**列表里必须只有真实注册的人**。种子池里的假人没有对应的设备在等，
 * 对面点了「开始」服务端照样成房 201，但另一端永远收不到 `match:matched`——
 * 表现就是「两台设备连不上」，而且当场看不出来。
 *
 * 所以现在：队列空、账号空、进度空，一切由 `POST /api/auth/session` 现场长出来。
 *
 * ## 账号模型
 *
 * `deviceId` 是账号的钥匙：一台设备第一次注册时建账号，之后同一台设备（含刷新、
 * 换身份）都复用同一个账号。两台设备 → 两个账号 → 互相能看见、也能互相选中。
 *
 * 资料仍然是**一行一个人格**：用 `accountId + role` 定位，`userId` 是下发给前端的
 * 资料 id，从账号派生（`learner-<accountId>` / `buddy-<accountId>`）。两份资料互不覆盖。
 */

/** `deviceId` 的长度上限：契约 4.1 节写明 1~64 字符。 */
export const DEVICE_ID_MAX = 64;

/**
 * 账号 id：`u-` + 8 位 base36。
 *
 * 用随机而不是自增：快照文件可能被删、被换、被手工改（演示现场常干的事），
 * 自增计数器一旦丢了下一次就会撞上已有账号，而随机 id 撞车概率可以忽略，
 * 且 `db.createAccount()` 里还有一道查重。
 */
export function newAccountId() {
  return 'u-' + Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/** 下发给前端的资料 id：一个账号两份资料，各自一个 id（契约 2.3 / 2.4）。 */
export function profileIdFor(accountId, role) {
  return `${role}-${accountId}`;
}

/**
 * 账号的显示名。
 *
 * 注册流程里没有「填昵称」这一步，所以服务端给一个能区分彼此的默认名。
 * 正式版应该让用户自己填；在那之前，用账号短码比所有人统一叫「匿名伙伴」好——
 * 至少现场两台设备能一眼看出谁是谁。用户把「设置 → 匿名」打开后这个名字不会下发。
 */
export function defaultDisplayName(accountId) {
  return '用户 ' + String(accountId).slice(-4);
}

/** 学习者资料：出厂全空，等注册第二步来填。 */
export function createLearnerProfile(accountId) {
  return {
    accountId,
    role: 'learner',
    userId: profileIdFor(accountId, 'learner'),
    nativeLanguage: null,
    cantoneseLevel: null,
    learningGoal: null,
    identity: null,
    interests: [],
    onboarded: false,
  };
}

/** 母语者资料：出厂全空（同样不预选兴趣与身份）。 */
export function createBuddyProfile(accountId) {
  return {
    accountId,
    role: 'buddy',
    userId: profileIdFor(accountId, 'buddy'),
    languagesSpoken: [],
    identity: null,
    interests: [],
    preferredTopics: [],
    wantToLearn: [],
    onboarded: false,
  };
}

export function createSettings() {
  return {
    interfaceLanguage: 'zh-Hans',
    /**
     * 默认**实名**：契约 10 第 96 行写明「新账号默认关闭（匿名），只在设置里主动切换」。
     * 以前这里写的是 `true`，和契约、和前端 store 的出厂值都不一致——结果是刚注册的人
     * 在榜单上直接显示成「匿名伙伴」，两台设备谁也认不出谁。要匿名得自己开。
     */
    anonymous: false,
    visibility: { interests: true, level: true, identity: true },
    leaderboardVisible: true,
    equippedTitleId: null,
  };
}

/** 新账号的进度：全部归零——「有谁注册了就看见谁」，谁都没练过就是 0。 */
export function createProgress() {
  return {
    xp: 0,
    streakDays: 0,
    totalMinutes: 0,
    conversations: 0,
    peopleHelped: 0,
    distinctTopics: 0,
    practiceMinutesThisWeek: 0,
    // 结算时按卡片话题累积；前端 recordSession 也是动态加这个字段
    topicsSeen: [],
    achievements: [],
  };
}

/** 新账号的社交表：没有任何预置的伙伴 / 申请 / 收藏 / 记录。 */
export function createRelations() {
  return { buddies: [], buddyRequests: [], savedPhrases: [], history: [] };
}

/**
 * 一个新账号的**全套行**（五张表各一份）。注册时由 `db.createAccount()` 一次性落库，
 * 保证不会出现「有账号没资料」这种半截状态。
 */
export function createAccountRows({ accountId, displayName = null, deviceId = null, createdAt = null }) {
  return {
    user: {
      userId: accountId,
      displayName: displayName ?? defaultDisplayName(accountId),
      deviceId,
      avatarId: 'neutral', frameId: 'none',
      createdAt,
    },
    learnerProfile: { ...createLearnerProfile(accountId), avatarId: 'neutral', frameId: 'none' },
    buddyProfile: { ...createBuddyProfile(accountId), avatarId: 'neutral', frameId: 'none' },
    settings: { accountId, ...createSettings() },
    progress: { accountId, ...createProgress() },
    relations: { accountId, ...createRelations() },
  };
}

/**
 * 一份完整的出厂快照（内存表 + 落盘都用它）。
 *
 * 九张表全是空数组：**没有任何演示数据**。演示时先开两台设备注册，人自己会长出来。
 */
export function createSeed() {
  return {
    users: [],
    profiles: [],
    settings: [],
    progress: [],
    relations: [],
    sessions: [],
    // 匹配队列：学习者是「在等的人」，母语者是「有空的人」，同一张表、同一个排序键
    queue: [],
    rooms: [],
    // 待接受的匹配请求（真实环境由匹配引擎 + WebSocket 推送产生）
    matchRequests: [],
  };
}

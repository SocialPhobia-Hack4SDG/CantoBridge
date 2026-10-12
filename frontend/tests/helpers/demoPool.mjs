/**
 * 演示候选池——**只活在测试里**。
 *
 * 这些东西原先在 `src/data/fixtures.js`，产品代码直接 import。删掉的理由只有一个：
 * 那些假人没有对应的设备在对面等着，另一台设备永远收不到 `match:matched`，
 * 现场表现就是「两台设备连不上」，而且当场看不出来。
 *
 * 现在 mock 层的候选池是**注入**的（`createMockApi({ candidates })`，默认空），
 * 于是：
 *   - 产品默认档位 = 真后端 = 列表里只有真实注册的人；
 *   - 测试需要「有人的世界」时，从这里拿一份池子塞进去，页面的排序 / 徽标 /
 *     空态之外的每条分支才测得到。
 *
 * 池子里的字段口径必须与后端 `GET /api/match/queue` / `recommendations` 的
 * 候选形状一致（见 docs/10 第 2.8 节的候选 DTO）：`role` 决定教 / 学标签的派生，
 * `nativeLanguage` 单数（等待列表口径），`languagesSpoken` 复数（推荐块口径）。
 */

/** 正在等伙伴的人，全部是**学习者**（这一列是给母语者挑的候选人）。 */
export const WAITING_LEARNERS = [
  {
    userId: 'learner-demo-01',
    role: 'learner',
    anonymous: true,
    nativeLanguage: 'english',
    cantoneseLevel: 'beginner',
    identity: 'exchange_student',
    interests: ['anime', 'food'],
    goal: 'daily_conversation',
    joinedAt: '2026-09-23T20:55:00+08:00',
  },
  {
    userId: 'mingzhu',
    role: 'learner',
    anonymous: false,
    nativeLanguage: 'mandarin',
    cantoneseLevel: 'elementary',
    identity: 'university_student',
    interests: ['food', 'travel', 'hong_kong_culture'],
    goal: 'make_local_friends',
    joinedAt: '2026-09-23T20:57:00+08:00',
  },
  {
    userId: 'lucas',
    role: 'learner',
    anonymous: false,
    nativeLanguage: 'english',
    cantoneseLevel: 'intermediate',
    identity: 'working_professional',
    interests: ['movies', 'technology', 'gaming'],
    goal: 'workplace_cantonese',
    joinedAt: '2026-09-23T20:59:00+08:00',
  },
  {
    userId: 'aiko',
    role: 'learner',
    anonymous: true,
    nativeLanguage: 'other',
    cantoneseLevel: 'beginner',
    identity: 'new_to_hong_kong',
    interests: ['travel', 'photography'],
    goal: 'university_life',
    joinedAt: '2026-09-23T21:01:00+08:00',
  },
];

/** 演示用的粤语母语者伙伴（学习者侧匹配到的就是他们）：`role` 让教 / 学标签自动派生。 */
export const DEMO_BUDDIES = [
  {
    userId: 'ka-ho',
    role: 'buddy',
    anonymous: false,
    nativeLanguage: 'yue',
    identity: 'university_student',
    interests: ['movies', 'hong_kong_food', 'sports', 'music'],
    languagesSpoken: ['yue', 'english'],
    wantToLearn: ['english'],
  },
  {
    userId: 'wai-ling',
    role: 'buddy',
    anonymous: false,
    nativeLanguage: 'yue',
    identity: 'working_professional',
    interests: ['food', 'travel', 'local_culture'],
    languagesSpoken: ['yue', 'mandarin', 'english'],
    wantToLearn: ['mandarin'],
  },
  {
    userId: 'siu-fung',
    role: 'buddy',
    anonymous: false,
    nativeLanguage: 'yue',
    identity: 'university_student',
    interests: ['music', 'sports', 'gaming'],
    languagesSpoken: ['yue', 'english'],
    // 这一位没填回礼：演示时用来对照「互补徽标不是人人都有」
    wantToLearn: [],
  },
];

/** 注入给 `createMockApi()` 的那一份池子。 */
export const DEMO_POOL = { learners: WAITING_LEARNERS, buddies: DEMO_BUDDIES };

/**
 * 演示用的**本地社交状态**：一位已连接的伙伴 + 一条收到的申请。
 *
 * 只在需要「我的伙伴」插槽三组都非空时才用（`boot({ storagePreset: { social: DEMO_SOCIAL } })`）。
 * 出厂值是三张空表——一份真实的新设备谁都不认识。
 */
export const DEMO_SOCIAL = {
  buddies: [{ peerId: 'ka-ho', label: 'ka-ho', since: '2026-09-21T21:30:00+08:00' }],
  buddyRequests: [
    {
      requestId: 'req-20260923-01',
      peerId: 'wai-ling',
      label: '匿名伙伴',
      direction: 'incoming',
      status: 'pending',
      roomId: null,
      createdAt: '2026-09-23T19:40:00+08:00',
      respondedAt: null,
    },
  ],
  savedPhrases: [],
  history: [],
};

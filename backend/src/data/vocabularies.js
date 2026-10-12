/**
 * 词表（唯一真源是 frontend/src/data/tags.js，见 frontend/docs/10-api-v1.md 第 3.6 节）。
 *
 * 为什么要在这里再写一份：后端要能独立部署，不依赖前端的源码目录。
 * **一致性由测试保证**：tools/check-contract.mjs 会 import 前端的 tags.js 逐值比对，
 * 少一个取值、多一个取值都会让 `npm test` 红。
 */

export const ROLES = ['learner', 'buddy'];
export const LEVELS = ['beginner', 'elementary', 'intermediate', 'advanced'];
export const NATIVE_LANGUAGES = ['mandarin', 'english', 'other'];
export const IDENTITIES = [
  'university_student',
  'exchange_student',
  'working_professional',
  'new_to_hong_kong',
];
export const INTERESTS = [
  'movies',
  'anime',
  'gaming',
  'music',
  'food',
  'travel',
  'hiking',
  'basketball',
  'football',
  'badminton',
  'photography',
  'technology',
  'hong_kong_culture',
];
export const LEARNING_GOALS = [
  'daily_conversation',
  'make_local_friends',
  'university_life',
  'workplace_cantonese',
  'hong_kong_culture',
];
export const BUDDY_TOPICS = [
  'hong_kong_food',
  'movies',
  'gaming',
  'university_life',
  'travel',
  'local_culture',
  'sports',
];
/**
 * 教 / 学 两枚**身份标签**：由身份派生（前端的 `intentForRole`），不可自选、不进设置。
 * 后端只拿它做文案与顺序，不下发给字典接口。
 */
export const MATCH_INTENTS = ['teach', 'learn'];
export const LEARNER_FEEDBACK_TAGS = ['friendly', 'patient', 'easy_to_understand', 'helpful'];
export const BUDDY_FEEDBACK_TAGS = [
  'active_learner',
  'friendly',
  'willing_to_speak_cantonese',
  'great_conversation',
];

export const MAX_INTERESTS = 5;
/** 母语者「想聊的话题」上限，契约 2.4 节。 */
export const MAX_BUDDY_TOPICS = 3;

/**
 * 不在 §3.6 那十张表里、但契约末尾点名要一致的三组取值
 * （`languagesSpoken` 的元素、`direction`、v1 的 `status`）。
 */
export const LANGUAGES_SPOKEN = ['yue', 'mandarin', 'english'];
export const REQUEST_DIRECTIONS = ['incoming', 'outgoing'];
export const REQUEST_STATUSES = ['pending'];

/** 设置里的口径：界面语言与可见范围键（契约 2.5 节的 `visibility.*`）。 */
export const INTERFACE_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en'];
export const VISIBILITY_KEYS = ['interests', 'level', 'identity', 'nativeLanguage'];

/** `/api/tags` 下发的字典：键名与契约 4.3 节的响应字段一一对应（只有这六个）。 */
export function publicTags() {
  return {
    identities: IDENTITIES,
    interests: INTERESTS,
    goals: LEARNING_GOALS,
    buddyTopics: BUDDY_TOPICS,
    levels: LEVELS,
    nativeLanguages: NATIVE_LANGUAGES,
  };
}

/** 十张可比对的词表（`tools/check-contract.mjs` 按名字逐个比对用）。 */
export const ALL_VOCABULARIES = {
  ROLES,
  LEVELS,
  NATIVE_LANGUAGES,
  IDENTITIES,
  INTERESTS,
  LEARNING_GOALS,
  BUDDY_TOPICS,
  MATCH_INTENTS,
  LEARNER_FEEDBACK_TAGS,
  BUDDY_FEEDBACK_TAGS,
};

/** 契约末尾补充的三组取值（前端 tags.js 不导出，另外列出来给校验脚本比对文档）。 */
export const EXTRA_VALUE_SETS = {
  LANGUAGES_SPOKEN,
  REQUEST_DIRECTIONS,
  REQUEST_STATUSES,
};

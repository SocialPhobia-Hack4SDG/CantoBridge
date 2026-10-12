/**
 * 标签与词表（唯一真源见 docs/05-design-system.md 第 9 节）。
 * 只放数据，不含任何逻辑。
 */

export const ROLES = ['learner', 'buddy'];

export const LEVELS = ['beginner', 'elementary', 'intermediate', 'advanced'];

/**
 * 母语取值。母语者资料里的「我也想练 X」（buddyProfile.wantToLearn）复用同一套取值——
 * **粤语（yue）刻意不在其中**：回礼不能是粤语，否则「语言交换」就退化成单向教学，
 * B 方案也就退化成了被否掉的 A 方案（见 docs/07-open-questions.md 第 9.2 / 9.4 节）。
 * 学习者一侧的「想练」恒为粤语，那是身份自带的，不是这里的一项可选值。
 */
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

export const MAX_INTERESTS = 5;

/**
 * 教 / 学：两枚**互斥**的身份标签（一个人只会拿其中一枚，也可能一枚都没有）。
 * 取值只用于文案与顺序；标签本身是**派生**的，唯一真源是「我的」页里的身份
 * （见 `intentForRole`）：粤语母语者 = 教粤语，粤语学习者 = 学粤语。
 * 不是自选项，所以它不进 settings、也没有勾选界面。
 */
export const MATCH_INTENTS = ['teach', 'learn'];

export const LEARNER_FEEDBACK_TAGS = ['friendly', 'patient', 'easy_to_understand', 'helpful'];

export const BUDDY_FEEDBACK_TAGS = [
  'active_learner',
  'friendly',
  'willing_to_speak_cantonese',
  'great_conversation',
];
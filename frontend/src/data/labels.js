/**
 * 枚举值的三语文案（唯一真源见 docs/05 第 9 节）。
 * 结构：ENUM_LABELS[枚举名][取值][locale] = 文案
 */

import { TOPIC_LABELS } from './topicDatabase.js';

export const LOCALES = ['zh-Hans', 'zh-Hant', 'en'];

const L = (zhHans, zhHant, en) => ({ 'zh-Hans': zhHans, 'zh-Hant': zhHant, en });

export const ENUM_LABELS = {
  levels: {
    beginner: L('初学者', '初學者', 'Beginner'),
    elementary: L('初级', '初級', 'Elementary'),
    intermediate: L('中级', '中級', 'Intermediate'),
    advanced: L('高级', '高級', 'Advanced'),
  },
  nativeLanguages: {
    mandarin: L('普通话', '普通話', 'Mandarin'),
    english: L('英语', '英語', 'English'),
    other: L('其他', '其他', 'Other'),
  },
  identities: {
    university_student: L('大学生', '大學生', 'University Student'),
    exchange_student: L('交换生', '交換生', 'Exchange Student'),
    working_professional: L('上班族', '上班族', 'Working Professional'),
    new_to_hong_kong: L('新来港', '新來港', 'New to Hong Kong'),
  },
  interests: {
    movies: L('电影', '電影', 'Movies'),
    anime: L('动漫', '動漫', 'Anime'),
    gaming: L('游戏', '遊戲', 'Gaming'),
    music: L('音乐', '音樂', 'Music'),
    food: L('美食', '美食', 'Food'),
    travel: L('旅行', '旅行', 'Travel'),
    hiking: L('行山', '行山', 'Hiking'),
    basketball: L('篮球', '籃球', 'Basketball'),
    football: L('足球', '足球', 'Football'),
    badminton: L('羽毛球', '羽毛球', 'Badminton'),
    photography: L('摄影', '攝影', 'Photography'),
    technology: L('科技', '科技', 'Technology'),
    hong_kong_culture: L('香港文化', '香港文化', 'Hong Kong Culture'),
  },
  goals: {
    daily_conversation: L('能进行日常交流', '能夠日常交流', 'Daily Conversation'),
    make_local_friends: L('认识本地朋友', '認識本地朋友', 'Make Local Friends'),
    university_life: L('适应大学生活', '適應大學生活', 'University Life'),
    workplace_cantonese: L('职场粤语', '職場粵語', 'Workplace Cantonese'),
    hong_kong_culture: L('了解香港文化', '了解香港文化', 'Hong Kong Culture'),
  },
  buddyTopics: {
    hong_kong_food: L('香港美食', '香港美食', 'Hong Kong Food'),
    movies: L('电影', '電影', 'Movies'),
    gaming: L('游戏', '遊戲', 'Gaming'),
    university_life: L('大学生活', '大學生活', 'University Life'),
    travel: L('旅行', '旅行', 'Travel'),
    local_culture: L('本地文化', '本地文化', 'Local Culture'),
    sports: L('运动', '運動', 'Sports'),
  },
  matchIntents: {
    teach: L('教粤语', '教粵語', 'Teach Cantonese'),
    learn: L('学粤语', '學粵語', 'Learn Cantonese'),
  },
  topicCards: TOPIC_LABELS,
  achievements: {
    conversation_starter: L('开口新星', '開口新星', 'Conversation Starter'),
    conversation_regular: L('交流达人', '交流達人', 'Conversation Regular'),
    conversation_veteran: L('对话之星', '對話之星', 'Conversation Star'),
    three_day_streak: L('三日同行', '三日同行', 'Three Days Together'),
    bridge_builder: L('语言桥梁', '語言橋樑', 'Bridge Builder'),
    topic_adventurer: L('话题冒险家', '話題冒險家', 'Topic Adventurer'),
    first_conversation: L('第一次对话', '第一次對話', 'First Conversation'),
    cantonese_explorer: L('粤语探索者', '粵語探索者', 'Cantonese Explorer'),
    seven_day_streak: L('连续七天', '連續七天', '7-Day Streak'),
    culture_explorer: L('文化探索者', '文化探索者', 'Culture Explorer'),
    first_buddy_session: L('第一次搭档', '第一次搭檔', 'First Buddy Session'),
    helpful_local: L('热心本地人', '熱心本地人', 'Helpful Local'),
    culture_ambassador: L('文化交流者', '文化交流者', 'Culture Ambassador'),
    conversation_hero: L('对话英雄', '對話英雄', 'Conversation Hero'),
  },
  feedback: {
    friendly: L('友善', '友善', 'Friendly'),
    patient: L('有耐性', '有耐性', 'Patient'),
    easy_to_understand: L('容易听懂', '容易聽懂', 'Easy to Understand'),
    helpful: L('帮到我', '幫到我', 'Helpful'),
    active_learner: L('积极开口', '積極開口', 'Active Learner'),
    willing_to_speak_cantonese: L('愿意讲粤语', '願意講粵語', 'Willing to Speak Cantonese'),
    great_conversation: L('聊得开心', '聊得開心', 'Great Conversation'),
  },
  buddyLevels: {
    newcomer: L('新伙伴', '新夥伴', 'Newcomer'),
    helper: L('好帮手', '好幫手', 'Helper'),
    guide: L('带路人', '帶路人', 'Guide'),
    ambassador: L('文化大使', '文化大使', 'Ambassador'),
  },
};

export function labelOf(group, value, locale = 'zh-Hans') {
  const entries = ENUM_LABELS[group];
  const entry = entries && Object.hasOwn(entries, value) ? entries[value] : null;
  if (!entry) return String(value ?? '');
  return entry[locale] ?? entry.en;
}

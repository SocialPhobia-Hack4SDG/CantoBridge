/**
 * 排行榜的**常量**（榜单内容本身不在这里）。
 *
 * 这里以前放了一份假榜单（mingzhu / ka-ho / wai-ling…），和前端 fixtures 的
 * `LEADERBOARD` 逐字段对齐。整份删掉了：榜单上出现不存在的账号，和列表里出现
 * 假候选人是同一类问题——用户看到的「别人」其实是编的。
 *
 * 现在 `GET /api/leaderboard` 遍历**真实账号**的进度现场算（见 `domain/social.js`），
 * 累计对话时长超过 5 分钟才具备上榜资格。
 */

/** 榜单的合法取值（契约 4.7 节：`period` weekly / monthly，`role` 走 ROLES 词表）。 */
export const LEADERBOARD_PERIODS = ['weekly', 'monthly'];

/** 匿名行的占位（契约 4.7 节：连 `userId` 都换掉，避免从 id 反推身份）。 */
export const ANONYMOUS_LABEL = '匿名用户';

/**
 * 榜单行上限。真实账号可能很多，一次全下没有意义也拖慢响应；
 * 每张榜最多展示 30 人。
 */
export const LEADERBOARD_LIMIT = 30;
export const LEADERBOARD_MIN_MINUTES = 5;

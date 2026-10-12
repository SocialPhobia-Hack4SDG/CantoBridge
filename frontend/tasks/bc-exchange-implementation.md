# CantoBridge 前端 · 「语言交换 + 供给优先」实现提示词（2026-09-29）

> **用法：** 把本文件从标题到末尾整段复制给负责实现的 agent。
> 本文件是**提示词**，不是规格书——权威规格在 `frontend/docs/`，决策依据在 `frontend/docs/07-open-questions.md` 第 9 节，接口字段以 `frontend/docs/10-api-v1.md` 为唯一真源。

## 0. 一句话任务

在不改变「粤语学习者 / 粤语母语者」这套**双身份模型**的前提下：给母语者补一个**可选的回礼**（我也想练 X）并让母语者挑人时**按语言互补优先排序**（B）；把「等别人来挑我」改成**首页直接推候选人 + 一键配对**（C）；把招募叙事里的**义工味**去掉。

## 1. 你在哪个仓库、有什么硬约束

- 本仓库根目录（Windows / PowerShell）。只改 `frontend/`。
- `frontend/` 是**零依赖 ES Module、无构建步骤**：不要 `npm install`、不要引入任何依赖、不要新增打包步骤。
- 根目录 `AGENTS.md`：**自己写测试，必须全绿**；每轮结束后 `git add` + `git commit`，commit message 用中文。
- 三个校验脚本是硬门槛，改完必须全绿：
  `node tools/check-docs.mjs` / `node tools/check-ui.mjs` / `node tools/check-api.mjs`（或 `npm run check`）。它们把文档里的路由、组件、接口路径、文案 key、属性字段、词表、mock 方法、测试数量全部钉在代码上。
- 时间线：功能冻结 **2026-10-06**，交付 **2026-10-09 23:59**，pitch **2026-10-18**。这个改动必须赶在冻结前完成。

## 2. 明确不要做的事

- **不要**把两张身份卡合并成「我能教的语言 + 我想学的语言」的二合一卡。那是被否掉的 A 方案（理由见 `docs/07` 第 9.3 节）：`role` 继续是账号级的二选一，`learnerProfile` 与 `buddyProfile` 继续分开存、互不覆盖。
- **不要**新增路由、**不要**新增组件——除非你同步改 `docs/03` 的路由表 / `docs/05` 的组件清单，因为 `check-docs` 与 `check-ui` 是双向闭合校验。
- **不要**把语言互补做成**筛选**。它只能是排序权重：不互补的人必须仍然出现在列表里，否则小规模冷启动会「匹配不到人」。
- **不要**让母语者把「想练的语言」填成粤语（那样 B 就退化成了 A）。

## 3. 任务 1 · B：母语者可选「我也想练 X」

依次改这些文件：

| # | 文件 | 改什么 |
| --- | --- | --- |
| 1 | `src/data/tags.js` | 不新增词表：`wantToLearn` 复用 `NATIVE_LANGUAGES`（`mandarin` / `english` / `other`），加注释说明**粤语不在取值里** |
| 2 | `src/app/store.js` | `buddyProfile` 默认值加 `wantToLearn: []`（第 54 行附近） |
| 3 | `src/lib/logic.js` | 新增两个**纯函数**并导出：`complementBoost(wantToLearn, peerNativeLanguages)`（命中返回 `COMPLEMENT_BOOST = 8`，否则 0）与 `matchRank(entry, viewer)`（= `matchScore` + boost）。放在 `matchScore` 旁边 |
| 4 | `src/services/mockApi.js` | `listWaitingLearners()` 与 `getCandidate()` 的排序改用 `matchRank`（现在第 172 行是 `entries.sort((a, b) => b.matchScore - a.matchScore)`），返回对象里加 `complement: true / false` |
| 5 | `src/pages/onboarding.js` | 母语者分支新增**第 4 题（可选）**「我也想练…」，复用 `TagPicker`；不选也能点「暂时跳过」 |
| 6 | `src/pages/me.js` | 母语者资料区显示这一项并允许修改 |
| 7 | `src/pages/match.js` | 等待列表行与 `/match/:learnerId` 预览卡显示「语言互补」徽标 + 一行「TA 也想练普通话」 |
| 8 | `src/i18n/i18n.js` | 新增文案 key，**简 / 繁 / EN 三语都要有值**（缺一个 `check-ui` 就红） |
| 9 | `docs/10-api-v1.md` | 属性字典（第 2.10 节）加 `buddyProfile.wantToLearn`；第 2.4 节补一行；`PUT /api/me/profile/buddy` 的请求字段加 `wantToLearn`；第 3.8 节的排序说明从 `matchScore` 降序改成 `matchRank` |
| 10 | `docs/09-frontend-logic-and-api.md` | 第 2.6 节说明新字段，相关「主要字段」列同步 |

三条**不能退让**的细节：

1. **只加权不筛选**：`matchRank` 只决定顺序，不决定谁可见。
2. **权重取 8**：`matchScore` 里每多一个共同标签约值 13.75 分。8 分意味着「最多顶掉半个共同兴趣」——能破平局、能翻转接近的两个人，但压不过少两个共同话题的人。这才叫软条件。
3. **只在母语者视角生效**：学习者的 `wantToLearn` 恒为粤语，所以学习者侧排序**不应发生变化**。若学习者的 `nativeLanguage` 是 `other`（与母语者的 `wantToLearn` 完全不相交），boost = 0：**不要报错、不要过滤、不要降级**。

## 4. 任务 2 · B：把义工味去掉

现在 `src/i18n/i18n.js` 第 41~43 行是：

- `role.buddySubtitle` = 「粤语伙伴 Cantonese Buddy」
- `role.note` = 「粤语伙伴不是老师，只要愿意用粤语聊天就好。」

`role.note` 是**防守式**写法（开口先否认「不是老师」），恰恰暗示了这是一份义务。替换方向：正面说出「我为什么来、我拿到什么、对方要做什么」，例如「我讲粤语，也想练普通话 / English —— 交换。」措辞你定，但必须满足：

- 不出现「老师 / 教师 / 教授者」（`docs/05` 第 9 节已约定）；
- 不出现「义工 / 志愿 / 公益 / 奉献 / 陪伴 / 帮扶」；
- 不暗示对方是「来帮忙」的。

同步改这些叙述：`docs/01` 第 3.2 节与第 5 节、`docs/03` 第 5.2 节、`docs/05` 第 7.1 节与第 9 节。

## 5. 任务 3 · C：首页直接推候选人 + 一键配对

问题：母语者注册完还得自己去匹配页翻列表挑人——**这一步才是真正挡住招人的地方**，不是身份卡长什么样。

1. `docs/03` 第 5.13 节（`/home`）新增「推荐伙伴」块：学习者视角在 `HomeActionCard` 下面直接列 top 3 候选，复用 `BuddyCard` / `BuddyBrowseList`，每张卡一个入口按钮。母语者视角**保持现状**（只显示等待人数）。
2. 「直接聊」= 直接成房并进入 `/room/:roomId`，该房间立刻从推荐块与匹配页摘除，**不新增路由**。**不经过 `/match/:learnerId`**：那个路由的守卫是「只允许粤语母语者进入」，而学习者需要的信息（匹配度、共同兴趣、互补徽标）已经全在卡片上。机器只负责排序，**人点按钮就是最终确认**——不违反素材 4 的「手动匹配」。
3. 需要后端新增一个「给学习者推荐候选」的读取口子。**实现时**把它并入 `docs/09` 第 3.2 节与 `docs/10` 第 4.4 节的接口清单，并在 `docs/10` 第 4.10 节的 mock 对照表补一行（`check-api` 会校验 mock 方法与接口双向闭合）。在这之前先走 mock 层，不要写死接口地址。

## 6. 任务 4 · 文档与自检

- [x] `docs/07-open-questions.md` 第 9 节是本次决策记录（Q-G28 ~ Q-G32）。实现完把 Q-G29 / Q-G30 标成「已并入 09 / 10」——**已标**（Q-G30 的端点定为 `GET /api/match/recommendations`）。
- [x] 测试数量变了必须**四处一起改**：`README.md`（3 处）、根目录 `TODO.md`、`docs/06` 第 2 节、`tools/check-docs.test.mjs` 里的锚点字符串。漏一处 `check-docs` 就会报「测试数量声明不一致」。（266 → 270 → **287**）
- [x] `docs/06` 第 4.2 / 4.3 节里有本次任务的勾选项，做完逐条勾掉。

## 7. 验收（逐条勾）

- [x] `npm run check` 三条校验全绿
- [x] `npm test` 全绿（287 个），且新增了针对 `complementBoost` / `matchRank` / 排序结果 / 徽标文案的测试
- [x] `/onboarding/profile` 母语者能看到第 4 题，**不填也能完成**（`tests/pages.test.mjs`）
- [x] 母语者填了「想练普通话」后，等待列表里「母语是普通话」的学习者排在前面并带「语言互补」徽标（`tests/mockApi.test.mjs`）
- [x] **学习者视角的排序没有变化**（回归测试证明：`matchRank` 对每位粤语母语者加成相同，排序与纯 `matchScore` 一致）
- [x] 界面上搜不到「义工 / 志愿 / 公益 / 奉献」与「老师 / 教师」（三语语言包逐条扫描，见 `tests/i18n.test.mjs`）
- [x] `/home` 学习者视角有 top 3 推荐，加载中 / 空 / 失败三态都能看到
- [x] 5 分钟 happy path 仍然完整：落地 → 注册 → 匹配 → 房间 → 结算 → 我的（`tests/app.test.mjs` 端到端仍然全绿）

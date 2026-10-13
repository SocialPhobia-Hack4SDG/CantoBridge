# CantoBridge · 后端任务台账（Hack4SDG 2026）

> **2026-10-13 公网部署进度**：免费云端启动、Supabase 持久化、静态 TURN 凭证下发（Metered 免绑卡档位，Cloudflare 临时签发保留为可选适配）、邀请访问与权限保护代码已准备。真实云账户配置、上线及跨网络通话验收尚未完成。下一次从 [部署交接清单](deploy/NEXT_SESSION.md) 继续，浏览器登录和平台连接由用户自行操作。

> **最新语音调试**：用户已部署公网服务并通过邀请入口，实际使用 Metered 免绑卡档位。真实通话已禁用模拟兜底，并修复 SDP / ICE 启动时序与移动端音频解锁。需要在 Render 部署最新改动后重新验收两台设备通话，检查信息见房间内「通话检查」。全部 824 项回归通过；真机媒体联通尚待确认。

> **后端主线已经做完，这份文件现在是台账与历史记录，不是待办清单。**
> `frontend/docs/10-api-v1.md` 里的 **35 个契约端点已实现 32 个（91%）**，剩的 3 个（正式登录 / 刷新令牌 / 版本策略）
> 是 APK 路线才需要的，Web demo 用不到、前端会自动降级到 mock。实时信令（`/ws/match`、`/ws/rooms/:roomId`）也已落地，
> **两台真机已经能互相看见并接通语音**（见 Phase 5 的步骤 5）。
>
> 本文件由前端维护，每轮对话后更新；**任务勾选状态以本文件为准**。字段有疑问先改契约文档，不要自己猜。

## 0. 30 秒了解现状

| 项 | 现状 |
| --- | --- |
| 仓库 | Hack4SDG_2026，本地 git 已接 GitHub。注册相关改动先落在迭代验证分支 `frontend-real`，四个分支（`main` / `frontend-real` / `frontend` / `backend`）**都已同步到远端、且全部合流**；各分支的定位见根 README 的「分支一览」 |
| 前端 | `frontend/`：零依赖 ES Module、**无构建步骤**，16 个路由 / 38 个组件 / 585 个测试全绿 |
| 数据 | **默认档位就是真后端**（直接开 `http://localhost:4173/`）：35 个方法打到 `8787`，只剩 3 个后置方法降级到 mock。要纯模拟数据加 `?api=mock`（`?api=http` 与默认档位等价，保留给旧脚本与书签） |
| 后端 | `backend/` 已落地。Phase 0 ~ Phase 4 的 REST 主线完成，**37 个契约端点里 34 个已实现（92%），194 条用例全绿**；实时信令 `/ws/match` 与 `/ws/rooms/:roomId` 已接上（引入 `ws` 依赖） |
| 账号 | **账号按设备现场长出来**（`deviceId` 是钥匙）：没见过的 `deviceId` 就建账号，见过的就复用。所以「谁注册了，另一台设备就看得见谁」，不再有固定演示账号 |
| 你的目标 | 打开 `http://localhost:4173/`（后端在 `8787`），整条 5 分钟 happy path 走真数据。`frontend/tools/e2e-real.mjs` 已用真后端跑通 17/17（2026-10-04 复测） |
| 硬节点 | 2026-10-06 功能冻结 · **2026-10-09 23:59 产品完成** · 2026-10-18 交 pitch deck |

**产品一句话**：粤语学习者 ↔ 粤语母语者（Cantonese Buddy）一对一**语音**聊天，AI 生成三语（粤语 / 普通话 / 英文）话题卡，聊完给积分、成就与排行榜。

> **已无待定接口**：首页「推荐伙伴」的候选读取口子（见 `frontend/docs/07-open-questions.md` 的 Q-G30）已定名为 `GET /api/match/recommendations`，并已并入 `frontend/docs/09-frontend-logic-and-api.md` 第 3.2 节与 `frontend/docs/10-api-v1.md` 第 4.4 节；后端也已实现。

## 1. 开工前必读（按顺序，约 25 分钟）

| 顺序 | 文件 | 读了它你就知道 |
| --- | --- | --- |
| 1 | `frontend/docs/10-api-v1.md` | **字段级唯一真源**：35 个端点的请求 / 响应字段、枚举、错误码映射、DTO 示例、mock 对照 |
| 2 | `frontend/docs/09-frontend-logic-and-api.md` 第 3、4 节 | 路径级真源 + 对接方式 + WebSocket 事件 + 三级降级 |
| 3 | `frontend/src/services/mockApi.js` | **可执行规格书**：每个接口的返回结构，就是这里的返回值 |
| 4 | `frontend/src/app/store.js` | 属性汇总的源头（49 条字段的默认值与持久化边界） |
| 5 | `frontend/docs/07-open-questions.md` 的 Q-G19 ~ Q-G23 | 已经替你列好的待拍板项 |
| 6 | `AGENTS.md` | 仓库铁律：自己写测试、全绿、每轮提交 |

## 2. 铁律（和前端同一套）

- [ ] 每写一段代码就**自己写测试**，`node --test` 必须全绿才提交，不要提交红的测试
- [ ] 每轮对话结束 `git add` + `git commit`，message 用**中文**描述
- [x] 动 `frontend/` 或 `backend/` 都要跑通那一侧自己的 `npm test` 与 `npm run check`
- [ ] 契约优先：先改 `frontend/docs/10-api-v1.md` → 再改实现，顺序不能反（09 第 4.8 节）
- [ ] 演示路径上任何一个失败都要有出路：宁可降级返回数据，也不要把前端逼到死胡同（10 第 3.5 节）
- [ ] 演示数据要能一键重置（`POST /api/dev/reset` 这类只在本地开的口子也行，别写进契约）

## 3. 目录与端口约定（默认值，见第 8 节）

| 项 | 默认约定 | 说明 |
| --- | --- | --- |
| 目录 | 新建 `backend/`，与 `frontend/` 平级 | 自带 `package.json`（ES Module），自己跑自己的 `node --test` |
| 端口 | 后端 `8787`，前端 `4173` | 前端静态服务器是 `node frontend/tools/serve.mjs` |
| 存储 | 单进程内存 + 一个 JSON 快照文件（`backend/.data/`，加进 `.gitignore`） | demo 不需要数据库；要 SQLite 也行，别花超过半天 |
| 形状 | REST + `/api/` 前缀 + 统一信封 `{ ok, data }` | 生产版再加 `/v1` 版本段，前端把前缀收在环境变量里 |
| 时间 | ISO 8601 带时区（`+08:00`），时长用**整数秒** | 10 第 3.4 节 |
| 信令 | 独立 WebSocket（`/ws/match`、`/ws/rooms/:roomId`） | 别用 SSE；握手带同一个令牌并校验 Origin |

**前端接线现状（2026-09-29 记，2026-10-04 更新方法数与降级清单；这些是前端已经做完的事，你不用动，但要知道）**：

- `frontend/src/app/main.js`：档位用 URL 参数，不改代码。默认走同源 `/api`（由 `tools/serve.mjs` 反代到 `8787`），未接线的方法自动降级到 mock；`?api=mock` 是纯 mock 档位（不需要后端）
- `frontend/src/services/httpApi.js`：35 个方法已接真后端（32 个契约端点 + 3 个本地演示口子）。形状转换在 `adapters.js`（裸数组 → `entries` / `buddies` / `requests`、`{ room }` 摊平、`/api/me` 带 `userId` 与 `progress`），清单见 10 第 3.4 节
- 仍降级到 mock 的 3 个：`signInWithCredentials` / `refreshToken` / `checkVersionPolicy`（对应第 6 节可后置的登录与版本策略）。`signOut` 已于 2026-10-04 接上真后端 `POST /api/auth/logout`，不再降级
- `frontend/src/services/rtc.js`：三档（`sim` / `local` / `remote`）已全部打通。信令收发抽成 transport（`createLocalTransport` / `createRemoteTransport`），`/api/rtc/ice-servers` 已接（拿不到就退到写死的 STUN）。远端档位的地址由 `frontend/src/lib/signal.js` 解析，与 REST 同一套口径（同源 / `&direct` / `&backend=`，另有 `&signal=` 单独指定）
- 双设备联调的两个自检脚本（2026-09-29 新增，都在 `backend/`）：
  - `npm run preflight:lan` —— 出发前问一句「现在能拿两台设备实测吗」（10 项）。唯一一个**走局域网地址而不是 localhost** 的检查。它复核「换了 Wi-Fi 之后证书 SAN 有没有跟着变」这个最隐蔽的坑 —— 这条现在由 `serve.mjs` **启动时自愈重签**兜住，脚本退居复核位
  - `npm run rehearse:rtc` —— 两条真 `rtc.js` 会话走真 WebSocket、经前端反代、连真后端，只有 `RTCPeerConnection` 是替身（Node 没有 WebRTC）。跑完 offer / answer / ICE / `rtc:level` / live，外加五条兜底（对方退出 / 拔网线 / 拒麦克风 / 刷新丢房 / 令牌失效）

## 4. 任务清单（按依赖顺序，可勾选）

### Phase 0 · 骨架（9/25 ~ 9/26）

- [x] 建 `backend/`、`package.json`、`backend/src/server.js`，`npm start` 能起来，`GET /api/health` 返回 `{ ok: true }`
- [x] 路由表：一个 `routes` 注册表 + 路径参数解析（`/api/rooms/:roomId` 这种），不要每个接口各写一套 if
- [x] 统一信封与错误码中间件：`ok` / `error.code` / `error.message`，HTTP 状态码照 10 第 3.1 与 3.5 节
- [x] `requestId` 幂等去重（内存 Map 就够）：同一个键再打一次，返回第一次的结果，而不是报错
- [x] CORS 放行 `http://localhost:4173` 与局域网地址；解析 `Authorization: Bearer`，401 统一走 `not_authorized`
- [x] 数据层五张表：`users` / `profiles`（两种身份分开存）/ `queue` / `rooms` / `relations` + JSON 快照落盘
- [x] 验收：`node --test` 全绿；`curl http://localhost:8787/api/tags` 能拿到 10 第 3.6 节的九个词表（取值一个都不能少）

### Phase 1 · 账号 / 资料 / 字典（9/26 ~ 9/27）

- [x] `POST /api/auth/session`：按 `deviceId` 现场建号或复用，返回 `token` / `expiresAt` / `userId` / `role`（**2026-10-01 起不再是固定演示账号**，见下）
- [x] `GET /api/me`：一次返回两份资料 + `settings` + `progress` 摘要（别让首屏打三次）
- [x] `PUT /api/me/profile/learner` 与 `PUT /api/me/profile/buddy`：**部分更新**，响应回整份资料；`interests` 超过 5 个报 400
- [x] `PUT /api/me/settings`：`interfaceLanguage` / `anonymous` / `visibility` / `leaderboardVisible`
- [x] `GET /api/tags`：词表字典，`kind` 可选
- [x] 验收：注册三页（`/onboarding/role` `profile` `privacy`）的每一步都能把数据写进后端，刷新后 `GET /api/me` 拿回来的两份资料都在

### Phase 2 · 匹配与成房（9/27 ~ 9/29）★ demo 的命门

- [x] `POST /api/match/queue`：学习者入队，返回 `queueEntryId` 与 `joinedAt`；重复入队返回 409 `already_queued`（幂等，前端直接进等待面板）
- [x] `DELETE /api/match/queue`：取消等待，**同一个动作里级联作废还没接受的匹配请求**——否则对面会一直干等到倒计时结束（07 Q-G15）
- [x] `GET /api/match/queue`：母语者视角的等待者列表，按 `matchScore` 降序，匿名与可见范围由**服务端裁剪**
- [x] `PUT /api/match/criteria`：自定义匹配条件，`topics` 为 `null` 或空数组 = 清掉自定义
- [x] `GET /api/match/candidates/:learnerId`：候选人预览，返回 `candidate` / `matchedTags` / `matchScore` / `reasons` / `roomAvailable`
- [x] **成房必须原子**：`POST /api/match/requests/:requestId/accept` 与 `POST /api/rooms` 都可能成房，同一间房只能成功一次，第二次必须 409 `room_taken`——这是「匹配成功后房间从公共页关闭」的唯一实现方式，**不能靠前端把列表项删掉来假装**
- [x] `POST /api/match/requests/:requestId/decline`：人**留在队列**，等待计时不清零；彻底退出只有 `DELETE /api/match/queue` 一条路
- [x] 验收：两台设备（或两个浏览器）分别扮演学习者与母语者，能走通「入队 → 被挑中 → 倒计时内接受 → 双方进同一间房」；第三方再点同一位候选人拿到 409

> **实现备注（2026-09-29）**：Phase 2 的 9 个契约端点已全部落地（`backend/`，覆盖率 46%），
> 另有 1 个**契约外的演示口子**（`/api/dev/*`，只在本地开）：真实环境里「待接受的匹配请求」
> 由匹配引擎 + `/ws/match` 推送产生（Phase 4），这一阶段先用它把 `accept` / `decline` 端到端跑通，
> 前端 mock 的 `requestMatch({ reason: 'demo' })` 对应的就是它。

### Phase 3 · 房间 / 话题卡 / 结算（9/30 ~ 10/02）

- [x] `GET /api/rooms/:roomId`：房间元信息；房间不存在报 404 `room_gone`（前端据此回匹配大厅 + 一次性提示）
- [x] `GET /api/rooms/:roomId/cards`：按**双方兴趣交集**与 `level` 选卡，支持 `round`（第几叠）与 `exclude`（上一叠看过的卡）。**先照接口形状返回本地卡池**（`frontend/src/data/topicDatabase.js` 有 472 张现成的卡：13 个兴趣主题 × 4 档 × 8 张 + 7 个通用主题 × 4 档 × 2 张），真 AI 生成后置
- [x] `POST /api/rooms/:roomId/end`：结算，返回 `durationSec` / `cardsUsed` / `xpEarned` / `unlocked` / `topics`。**必须幂等**（同一个 `requestId` 重复提交返回同一份，弱网重试不能把 XP 加两次）
- [x] 积分规则与前端纯函数保持一致：每分钟 6 点 + 每张卡 5 点（`xpFor`）；成就解锁规则见 10 第 4.9 节的成就表
- [x] 验收：房间从创建到结算全链路打通；断开重连后 `GET /api/rooms/:roomId` 能给出明确状态而不是 500

> **实现备注（2026-09-29）**：Phase 3 的 4 个契约端点已落地（后端覆盖率 57%）。
> 话题卡先返回本地卡池（现为 472 张：13 个兴趣主题 × 4 档 × 8 张 + 7 个通用主题 × 4 档 × 2 张），真 LLM 后置；结算的幂等有两道保险
> （`requestId` 回放 + 房间上的 `settlement`），弱网重试不会把 XP 加两次。

### Phase 4 · 伙伴关系 / 沉淀 / 信令（10/03 ~ 10/06）

- [x] `GET /api/me/buddies` + `GET /api/me/buddy-requests`（`direction` 区分收到 / 发出）
- [x] `POST /api/me/buddy-requests`：**发出申请不等于成为伙伴**；响应 `status` 可能是 `pending` / `buddy`（幂等）/ `accepted`（**对方也申请过我 = 双方自动成为伙伴**）
- [x] `POST /api/me/buddy-requests/:peerId/accept` 与 `.../decline`：处理完申请**直接从表里移除**（v1 的 `status` 只有 `pending`，不留「已拒绝」记录）
- [x] `GET /api/me/progress`（`xp` / `streakDays` / `achievements` 全量 / `buddyLevel`）、`GET /api/me/history`、`GET /api/leaderboard`（weekly 与 monthly × learner 与 buddy）
- [x] 排行榜里 `anonymous` 为 true 的行，连 `userId` 都换成「匿名伙伴」占位，避免从 id 反推身份
- [x] 信令 WebSocket：`/ws/match` 的 `match:matched` 推送（前端据此弹右上角接受弹窗）、`/ws/rooms/:roomId` 的 SDP / ICE 转发
- [x] `GET /api/rtc/ice-servers`：先只下发 STUN（同 Wi-Fi 够用），TURN 走 `CANTOBRIDGE_TURN_*` 环境变量，配了就一起下发
- [x] 验收：结算页发出申请 → `/me` 的「我的伙伴」插槽里能看到「我发出的」；预置一条「收到的」申请，点接受后立刻出现在已连接伙伴里

> **实现备注（2026-09-29）**：Phase 4 的伙伴关系 7 个端点 + 沉淀 3 个端点全部落地，
> 另有 1 个本地演示口子（`/api/dev/*`，只在本地开、不进契约——写进本文件时**别写具体路径**，
> 否则 `frontend/tools/check-api.mjs` 会因为「TODO.md 引用了 09 未声明的接口」而红）；
> 契约覆盖率从 57% 提升到 86%（30 / 35）。
> 已按确认口径处理「已经是伙伴后再次申请」：返回 `200` + `status: "buddy"`，不走异常分支。
>
> **实现备注（实时信令，2026-09-29）**：`/ws/match` 与 `/ws/rooms/:roomId` 已落地，
> 契约覆盖率 86% → **89%（31 / 35）**，后端 145 → 158 个测试（此后又补了匹配频道等用例，2026-10-01 复测为 162；
> 2026-10-04 补上 `POST /api/auth/logout` 后为 **91%（32 / 35）**；同日扩卡池 + 重写选卡器（双方兴趣 / 换叠）又补了一批用例，为 173 个测试）。
> 口径写在 `backend/src/ws/` 的文件头，几条容易踩的：
>   - 握手四条依次判：**Origin 白名单 → 频道存在 → 令牌有效 → 房间存在**（各回 403 / 404 / 401 / 404）；
>     浏览器 `WebSocket` 不能自定义请求头，所以令牌走 `?token=`，同时也认 `Authorization` 头。
>   - **没有 Origin 就放行**：浏览器发 WebSocket 一定带 Origin、伪造不了；带不了的只有非浏览器客户端
>     （node / curl / 以后的 APK），它们已经被令牌拦过一道，与 REST 的 CORS 同一个口径。
>   - **定向推送按 `(账号, 身份)` 过滤**：当时 demo 的两种身份共用 `DEMO_USER_ID`，
>     只按账号过滤会把「学习者该弹的接受框」推到母语者那台设备上。
>     （**2026-10-01 起账号按 `deviceId` 现场长出来，两台设备就是两个账号**，这条过滤依然要保留——
>     同一个账号仍有学习者 / 母语者两种身份。）
>   - `POST /api/rooms` 直接成房时推的 `match:matched` 带 `requestId: null`
>     （= 房已开好、不用接受，前端据此不弹接受框）。
>   - 领域层通过注入的 `events` 喊事件，`emit` **吞掉所有异常** —— 推不动消息不能把一次成功的成房变成 500。
>   - 房间频道的转发白名单是 `rtc:offer` / `rtc:answer` / `rtc:ice` / `rtc:level` / `room:peer-muted` / `room:card`。
>     `rtc:level`（对方音量，约 11 条/秒）是给跨设备档位画对方波形用的：那边没有 `BroadcastChannel`
>     可以本地互看，只能靠它。`room:card`（`{ cardId, index }`）让双方翻到**同一张卡**：
>     谁翻谁广播，收到的人跟过去、且**不再回推**（否则两边会来回弹）。
> 未做：房间 403 参与者校验（谁都能连任意房间号，只要令牌有效）、断线重连补发、TURN 真实凭证。
>
> **实现备注（账号模型，2026-10-01）**：`POST /api/auth/session` 原来把每个设备都认成同一个
> `DEMO_USER_ID`，两台真设备互相看不见对方——这是「两台设备连不上」的根因。现在账号按
> `deviceId` 现场长出来（没见过的建号、见过的复用），`role` 只进令牌、不进账号（一个账号两套人格）；
> 资料 id 由 `profileIdFor(accountId, role)` 派生。服务端出厂种子全空，演示数据只剩测试里的注入池。
> 顺带修掉一处契约违约：`settings.anonymous` 的出厂值后端写成了 `true`，契约（10 第 4.3 节）要求 `false`。

### Phase 5 · 联调与冻结（10/05 ~ 10/09）

- [x] 按 09 第 4.7 节联调 REST 主线（步骤 1 ~ 4、4b、6）：默认档位已打到真后端。`cd frontend && npm run e2e:real` 用真服务走完落地 → 注册 → 入队 → 成房 → 话题卡 → 结算 → 评价 → 伙伴 → 我的 / 排行榜 / 设置 → 退出并换人，2026-10-04 复测 17/17（2026-10-04 新增「注册前不建号」「点注册才建号」「退出并换人」三步）
- [x] 步骤 7（拒麦克风 / 拔网线 / 对方中途退出 / 刷新丢房 / 令牌失效）已逐条彩排：`cd backend && npm run rehearse:rtc`，2026-10-04 复测 22/22
- [x] 步骤 5（WSS 信令 + `/api/rtc/ice-servers`）：信令、ICE、前端 transport 抽象都已完成（`npm run preflight:lan` 10/10 + `npm run rehearse:rtc` 22/22），**两台真机也已经实测打通**——各自注册一个账号、进同一间房、对着麦克风说话能互相听见。真机联调走公网隧道（根 README 第六节），TURN 仍按决定后置（同 Wi-Fi / 隧道够用）
- [ ] 弱网演练：把后端人为加上 300 ~ 800ms 延迟，确认前端三态（加载中 / 空 / 失败）都正常
- [x] 兜底演练：拒麦克风、拔网线、对方中途退出、刷新丢房——信令层已由 `npm run rehearse:rtc` 逐条跑过（22/22），确认后端不返回死胡同；真机上也已复演一遍，浏览器侧表现与彩排一致
- [ ] 10/06 功能冻结后只修 bug；10/08 ~ 10/09 配合真机彩排，随时能一键重置演示数据（`POST /api/dev/reset`）

## 5. 接口优先级：当时先做的这 25 个（够跑完 5 分钟 happy path）—— 全部已完成

| 分组 | 端点 | 方法 | 为什么先做 |
| --- | --- | --- | --- |
| 账号资料 | `/api/auth/session` | POST | demo 一键进入，一切的入口 |
| 账号资料 | `/api/me` | GET | 首屏一次拿齐两份资料 + 设置 + 进度摘要 |
| 账号资料 | `/api/me/profile/learner` | PUT | 注册第二步：学习者资料 |
| 账号资料 | `/api/me/profile/buddy` | PUT | 「我是粤语母语者」那条路 |
| 账号资料 | `/api/me/settings` | PUT | 匿名与可见范围（服务端要按它裁剪下发） |
| 字典 | `/api/tags` | GET | 标签选择器与匹配条件编辑器 |
| 匹配 | `/api/match/queue` | POST | 学习者入队 |
| 匹配 | `/api/match/queue` | DELETE | 「取消匹配」的唯一出口 + 级联作废未接受的请求 |
| 匹配 | `/api/match/queue` | GET | 母语者浏览等待者（含 matchScore，按分数降序） |
| 匹配 | `/api/match/criteria` | PUT | 契约与实现都保留，但**当前 UI 未接线**（匹配页不再让用户选兴趣），留给后续筛选需求 |
| 匹配 | `/api/match/candidates/:learnerId` | GET | 资料预览页 |
| 匹配 | `/api/match/requests/:requestId/accept` | POST | 接受 → 原子成房（第二次拿 409） |
| 匹配 | `/api/match/requests/:requestId/decline` | POST | 不接受 → 留在队列、计时不清零 |
| 匹配 | `/api/rooms` | POST | 母语者确认开始通话 → 原子成房 |
| 房间 | `/api/rooms/:roomId` | GET | 进房；房间没了要报 404 room_gone |
| 房间 | `/api/rooms/:roomId/cards` | GET | 三语话题卡（先返回固定卡池） |
| 房间 | `/api/rooms/:roomId/end` | POST | 结算（必须幂等） |
| 伙伴 | `/api/me/buddies` | GET | 「我的伙伴」的已连接列表 |
| 伙伴 | `/api/me/buddy-requests` | GET | 收到的 + 我发出的 |
| 伙伴 | `/api/me/buddy-requests` | POST | 结算页发出申请（不等于成为伙伴） |
| 伙伴 | `/api/me/buddy-requests/:peerId/accept` | POST | 现场接受一条申请 |
| 伙伴 | `/api/me/buddy-requests/:peerId/decline` | POST | 现场拒绝一条申请 |
| 沉淀 | `/api/me/progress` | GET | 首页与我的页统计（XP / 成就 / 等级） |
| 沉淀 | `/api/me/history` | GET | 连线记录页 |
| 沉淀 | `/api/leaderboard` | GET | 周榜 / 月榜 |

## 6. 仍然降级到 mock 的 3 个（不影响 demo）

这 3 个就是 `frontend/src/services/httpApi.js` 的 `FALLBACK_METHODS`——后端没实现，
前端自动转发给 mock 实现，页面不会卡死。

| service 方法 | 端点 | 方法 | 什么时候需要 |
| --- | --- | --- | --- |
| `signInWithCredentials` | `/api/auth/login` | POST | 只有 APK 的正式登录要（见 08） |
| `refreshToken` | `/api/auth/refresh` | POST | 同上；Web 端先发 12 小时有效期的不透明令牌 |
| `checkVersionPolicy` | `/api/app/version-policy` | GET | 只有 APK 启动时要 |

> **原来这份清单有 9 个，另外 6 个已经实现**：`POST /api/rooms/:roomId/feedback`、
> `POST /api/me/saved-phrases`、`DELETE /api/me/buddies/:peerId`、
> `DELETE /api/me/buddy-requests/:peerId`、`GET /api/rtc/ice-servers`、
> `POST /api/auth/logout`（`signOut`，2026-10-04 接上）。
> 其中 `/api/rtc/ice-servers` 只下发 STUN，TURN 真实凭证仍未配（同 Wi-Fi 与隧道够用）。

## 7. 怎么自测与联调

- 后端自测：`node --test`（覆盖每个端点的正常 / 400 / 401 / 404 / 409 分支）；**成房的 409 与结算的幂等必须有测试**
- 手工冒烟：`curl http://localhost:8787/api/tags`、`curl -X POST http://localhost:8787/api/auth/session -d '{"role":"learner"}'`
- 前端联调：**不用改代码**——默认档位就是真后端。`node frontend/tools/serve.mjs` 之后浏览器开 `https://localhost:4173/` 即可；要看纯模拟数据加 `?api=mock`
- 现场真机演示：**走公网隧道**（根 README 第六节），两台设备不必在同一个 Wi-Fi、浏览器也没有证书警告。局域网 + 自签证书只在起不了隧道时用，而且必须先把证书装进信任库，不要点掉「不安全」
- 契约不漂移：`cd frontend` 然后 `npm run check`（三个脚本会校验端点集合、属性字典、词表、mock 对照表）

## 8. 曾经的待拍板项（现已按默认值落地）

| # | 问题 | 当时采用的前端默认值 | 落地情况 |
| --- | --- | --- | --- |
| B1 | 后端技术栈？ | **Node.js + 内置 `node:http`**（零依赖、现场断网也能起），要框架再上 Fastify / Express | ✅ 照此落地；信令多一个依赖 `ws` |
| B2 | 数据存哪？ | 内存 + JSON 快照 | ✅ 照此落地（`backend/.data/`，已 gitignore） |
| B3 | 匹配队列与 `match:matched` 谁驱动？ | **后端**持有队列并推送事件（07 Q-G11） | ✅ 后端持有；`/ws/match` 推送，前端 `app/matchSync.js` 接收 |
| B4 | AI 话题卡归谁？ | 后端先返回本地卡池，真 LLM 后置（07 Q-G21） | ✅ 本地卡池（472 张 = 13 个兴趣主题 × 4 档 × 8 张 + 7 个通用主题 × 4 档 × 2 张），按**双方兴趣交集**出卡 + 按房间号 / 第几叠做种子洗牌；真 LLM 仍未接 |
| B5 | 令牌形式与 `/v1` 版本段？ | 不透明令牌 + 生产环境再加 `/v1`（07 Q-G22） | ✅ 不透明令牌（12 小时）；`/v1` 未加 |
| B6 | 字段命名口径（`reasons` / `unlocked` 等）？ | **以 `frontend/docs/10-api-v1.md` 为准**（07 Q-G20） | ✅ 已按 10 落地，`npm run check` 双向校验 |

## 9. 下一步（后端侧，都不阻塞 demo）

主线已收口，剩下的按重要性排：

1. **房间类接口与信令补「参与者」校验**（`GET /cards`、`POST /end`、`POST /feedback`、`/ws/rooms/:roomId`）：
   以前只有一个演示账号所以不可达，**现在两台设备就是两个账号，这个洞已经可达**。
   顺序照旧：先给 `frontend/docs/10-api-v1.md` 加 403 条款，再改实现。
2. **信令断线重连补发**：断线期间的事件不重放，前端重连后靠 REST 拉一次现状（`queue:updated` 在连上时会立刻推一份）。
3. **TURN 临时凭证签发**：跨网络 / 对称 NAT 才需要，同 Wi-Fi 与隧道够用。
4. **APK 路线仍未实现的 3 个端点**：见第 6 节，需求清单在 [frontend/docs/08-apk-and-backend-asks.md](frontend/docs/08-apk-and-backend-asks.md)。

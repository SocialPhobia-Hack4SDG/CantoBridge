# CantoBridge · 后端

> 语音语伴平台的 API 服务。**REST 侧零依赖**（只用 Node 内置能力）+ **JSON 快照**存储，
> 现场断网、换机器都能直接起；实时信令用一个依赖（[`ws`](https://github.com/websockets/ws)），
> 见下方「实时信令」。
>
> 当前阶段：**Phase 0 ~ Phase 4 全部完成，含实时信令**（37 个契约端点里已实现 34 个，194 条用例全绿，
> 见下方「已实现」；剩余 3 个是 APK 正式登录 2 个 + 版本策略，均不影响 Web demo）。
> **两台真机已能互相看见并接通语音**（2026-10-01）。
>
> 资料是**双身份模型**（契约 2.3 / 2.4）：一个账号两份资料（`learner` / `buddy`），
> 一行一个人格、分开存分开改，切身份不会丢掉另一边。

## 怎么跑

```bash
cd backend
npm install               # 只有一个依赖：ws（实时信令）
npm start                 # 默认 8787 端口，打印本机与局域网地址 + 信令地址
# 或者指定端口 / 快照位置：
PORT=8787 CANTOBRIDGE_DATA=/tmp/cb.json node src/server.js
# 配了 TURN 就一起下发（不配只回 STUN，同 Wi-Fi 够用）：
CANTOBRIDGE_TURN_URL=turn:turn.example.com:3478 \
CANTOBRIDGE_TURN_USERNAME=demo CANTOBRIDGE_TURN_CREDENTIAL=secret npm start
# CORS 默认放行 localhost 与私有网段（10.x / 172.16-31.x / 192.168.x）；要额外加源就逗号分隔：
CANTOBRIDGE_CORS=https://example.com,https://foo.example.com npm start
```

```bash
npm test                  # node --test：194 个，覆盖接口、信封、CORS、幂等、持久化、契约、信令、冒烟
npm run smoke             # 一条命令验收 Phase 0+1：21 项检查，打印人能读的报告
npm run check             # 契约校验：已实现路由 ↔ frontend/docs/10-api-v1.md
npm run smoke:ws          # 真链路信令冒烟（需要前端 4173 与后端 8787 都在跑，见下）
npm run preflight:lan     # 出发前自检：现在能不能拿两台设备同 Wi-Fi 实测
npm run rehearse:rtc      # 双端彩排：两条真 rtc.js 会话走真信令 + 五条兜底
```

`npm run smoke` 会起一个**真服务**（临时数据文件 + 随机端口，不碰 `backend/.data/`），
把验收路径走一遍（共 21 项）：健康检查 → 字典 → 按设备注册 → 拿两份资料 → 无令牌 401 → 写 learner 资料 →
**确认 buddy 那份没被动** → 写 buddy 资料 → 越界 400（兴趣超 5 个 / 回礼里出现 yue）→
幂等回放 → 405/404 → CORS → **匹配队列**（重复入队 409 / 取消 410 / 取消时连坐作废待接受请求）→
**成房原子**（第二次 409 `room_taken`）→ 话题卡（8 张、落在该难度窗口内）→
结算（积分等于 `xpFor`，同 / 换 `requestId` 都不会把 XP 加两次）→ 反馈 + 句型收藏 →
**重启后数据还在** → 一键重置。
现场想快速回答「后端现在能不能用」就跑它。

`npm run smoke:ws` 是**浏览器要走的那条路**：经前端 `4173` 的 HTTPS 反代与 `/ws` 隧道连后端信令。
`npm test` 里的信令测试是直连后端的，验不到中间那层隧道与「Origin 从 http 变成 https」这件事，
所以这一层单独有一个冒烟。跑之前两个服务都要在：

```bash
cd backend  && npm start          # 8787
cd frontend && npm run serve      # 4173（HTTPS + /api 反代 + /ws 隧道）
cd backend  && npm run smoke:ws   # 15 项：握手 / 定向推送 / 转发 / 结算 / 掉线
```

### 双设备实测前的两个自检

上面两个冒烟回答的是「后端自己好不好」。这两个回答的是「**两台设备现在能不能连**」——
它们验的是局域网地址、证书 SAN、CORS、P2P 协商这一整条只有真机才会走的链路。

```bash
cd backend  && npm run preflight:lan   # 10 项，全过才值得拿起第二台设备
cd backend  && npm run rehearse:rtc    # 22 项，把信令层能自动验的全验掉
```

**`npm run preflight:lan`** 是唯一一个**走局域网地址而不是 `localhost`** 的检查，十层依次过：
拿到局域网地址 → 读得到自签证书 → 证书 SAN 覆盖当前所有局域网地址 →
从局域网地址能不能打开 `4173` 并经反代拿到 `/api/health` →
**运行中的服务递出来的证书跟磁盘上的是不是同一张** → 这个地址的 Origin 在不在 CORS 白名单里 →
手机装证书的入口 `/cert.crt` 通不通且类型对不对 → 私钥有没有被静态分发 →
这个地址上能不能拿到令牌 → `wss://<局域网地址>:4173/ws/match` 能不能握手。
失败时直接打印该改什么。

> **两个证书的坑，分属两层，别混。** 一是 **SAN 漂了**：浏览器只认 SAN、不认 CN，
> 而自签证书里的 IP 是本机局域网地址，换了 Wi-Fi（换了网段）之后旧证书就不含新地址了。
> `serve.mjs` 现在**启动时会比对 SAN 与当前地址、对不上就自动重签**，所以这条通常是复核。
> 二是 **改了证书但忘了重启**：SAN 那条读的是磁盘上的文件，探活那条又关掉了证书校验
> （见运行时那条 `NODE_TLS_REJECT_UNAUTHORIZED` 警告），两条都过也可能是在对着一张错证书 ——
> 所以单列一条，直接 `tls.connect` 抓服务器实际递出来的那张比指纹。手机上这两种表现一模一样，
> 都是证书错误。

**`npm run rehearse:rtc`** 跑的是**两条真的 `rtc.js` 会话**，各拿一个真 WebSocket 经前端反代连真后端，
走完 offer / answer / ICE / `rtc:level` / live，再逐条演五条兜底：
对方中途退出 / 自己拔网线 → 降级 → 一键切模拟通话 / 拒麦克风 / 刷新丢房 / 令牌失效。

唯一被替换的是 `RTCPeerConnection`（Node 里没有 WebRTC，装 `wrtc` 不值得）。也就是说
**除了媒体栈，两台设备之间会发生的每一步都跑了**。真正只有真机能回答的那一条
（「两个浏览器能不能打通 P2P」）**已于 2026-10-01 在真机上验证成立**：
两台设备各注册一个账号、进同一间房、对着麦克风说话能互相听见。

同一个替身（`frontend/tests/helpers/rtc-stub.mjs`）也被 `frontend/tests/services/rtc.test.mjs` 用，
所以单测与彩排不会各自漂移。

冒烟三连：

```bash
curl http://localhost:8787/api/health
curl http://localhost:8787/api/tags
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/session \
  -H 'content-type: application/json' -d '{"role":"learner","deviceId":"device-my-laptop"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")
curl http://localhost:8787/api/me -H "authorization: Bearer $TOKEN"
```

## 已实现

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 + 五张表计数（契约外用，运维自检） |
| `GET /api/tags` | 六张公开词表字典（`kind` 可选，只回其中一张；另外四张是契约内但不下发的取值） |
| `POST /api/auth/session` | 按 `deviceId` 现场建号或复用（没见过的建账号、见过的认回原账号）：`role`（`learner` / `buddy`）与 `deviceId` 必填，返回令牌与身份；**`role` 只进令牌、不进账号**（一个账号两套人格），**选身份不算填资料** |
| `POST /api/auth/logout` | 退出：只作废**当前这一条**令牌（`sessions` 按令牌存，不按账号），同账号在别处的会话照旧；令牌本来就失效 → 401 `not_authorized`（前端拿到 401 也会清本地令牌，所以重复退出不留痕）。**账号与资料一个都不删**——退出 ≠ 注销 |
| `GET /api/me` | 一次拿齐 `learnerProfile` + `buddyProfile` + `settings` + `progress` |
| `PUT /api/me/profile/learner` | 部分更新学习者资料（`interests` 上限 5，写完即完成注册） |
| `PUT /api/me/profile/buddy` | 部分更新母语者资料（会说语言 / 想聊话题 / 回礼 `wantToLearn`，取值是母语词表去掉粤语） |
| `PUT /api/me/settings` | 界面语言 / 匿名 / 可见范围 / 榜单可见性 |
| `POST /api/match/queue` | 入队（`learnerProfileSnapshot` / `anonymous` / `criteria` 可选）。**已经在队列里再打一次 → 409 `already_queued`**，前端拿它当「直接进等待面板」，不当错误 |
| `DELETE /api/match/queue` | 取消等待。同一个动作里**级联作废还没接受的匹配请求**（连坐），没排过队 → 410 `queue_expired` |
| `GET /api/match/queue` | 母语者视角的等待者列表，按 `matchRank` 降序；`limit` / `interests` 可选；**匿名与可见范围由服务端裁剪** |
| `GET /api/match/recommendations` | 学习者视角：此刻有空的粤语母语者（首页「推荐伙伴」） |
| `PUT /api/match/criteria` | 自定义匹配条件；`topics` 为 `null` / `[]` = 清掉自定义，回到按资料兴趣找 |
| `GET /api/match/candidates/:learnerId` | 候选人预览：`candidate` / `matchedTags` / `matchScore` / `reasons` / `roomAvailable`；人不存在 404，**被摘走仍可预览但 `roomAvailable:false`** |
| `POST /api/match/requests/:requestId/accept` | 接受 → **原子成房**；第二次处理同一条 / 过期 / 不是自己的 → 410 `match_request_expired`；抢不到人 → 409 `room_taken` |
| `POST /api/match/requests/:requestId/decline` | 不接受（或倒计时到点）：人**留在队列**、计时不清零，peer 仍可被别人摘走 |
| `POST /api/rooms` | 成房（母语者传 `learnerId`，学习者首页「直接聊」传 `buddyId`）：同一个伙伴只能被摘走一次，第二次 409 `room_taken` |
| `GET /api/rooms/:roomId` | 房间元信息（Phase 3 会继续补话题卡与结算）；房间不存在 → 404 `room_gone` |
| `GET /api/rooms/:roomId/cards` | 三语话题卡：从 472 张本地卡池（13 个兴趣主题 × 4 档 × 8 张 + 7 个通用主题 × 4 档 × 2 张）里选。**默认取双方在房里那个身份的兴趣交集**（**不是并集**：只有一方点过的主题一张都不出），只在兴趣主题里出卡；`level` 缺省取**学习者**的水平，`interests` 可显式覆盖，`count` 默认 8（夹 1~32），`round` 指第几叠（夹 0~64，种子 = `房间号:round`，**同房两侧拿到同一叠**），`exclude` 传上一叠看过的卡 id（换叠零交集）。兴趣主题凑不满一叠时先在兴趣主题内放宽难度（按离本人档位远近排序），最后才拿通用主题兜底 —— **交集为空时走的就是这一格**；学习者账号里已聊过的主题往后挪（读 `topicsSeen`） |
| `POST /api/rooms/:roomId/end` | 结算。**幂等两道保险**：`requestId` 复打由外壳层回放；房间上存了 `settlement`，换 `requestId` 重打也返回同一份，**绝不再加一次 XP**。积分与成就规则与前端纯函数同源 |
| `POST /api/rooms/:roomId/feedback` | 评价。词表按**被评价的人**的身份选（对方是母语者就用 `LEARNER_FEEDBACK_TAGS`）；空 tags 且未 `skipped` → 400 |
| `POST /api/me/saved-phrases` | 句型收藏（`cantonese` / `phrase` 至少给一个） |
| `GET /api/me/buddies` | 已经互相接受的伙伴列表 |
| `DELETE /api/me/buddies/:peerId` | 解除伙伴；只删关系，历史 / 积分 / 成就全部保留 |
| `GET /api/me/buddy-requests` | 收到的 + 我发出的申请；支持 `direction` / `status` 过滤 |
| `POST /api/me/buddy-requests` | 发出申请；重复 pending 幂等、双向申请自动成伙伴；已经是伙伴按用户确认返回 `200 status: buddy` |
| `POST /api/me/buddy-requests/:peerId/accept` | 接受收到的申请 → 成为伙伴；申请随后直接移除 |
| `POST /api/me/buddy-requests/:peerId/decline` | 拒绝收到的申请；申请直接移除，不留尴尬记录 |
| `DELETE /api/me/buddy-requests/:peerId` | 撤回我发出的申请 |
| `GET /api/me/progress` | 进度 / 全量已解锁成就 / 服务端计算的伙伴等级 |
| `GET /api/me/history` | 连线记录；支持 `buddyOnly` / `limit` |
| `GET /api/leaderboard` | weekly / monthly × learner / buddy；自己的实时数据会重排，匿名行连 userId 都裁剪 |
| `GET /api/rtc/ice-servers` | 进房协商前拉一次。**本轮只下发 STUN**（同 Wi-Fi 直连够用）；配了 `CANTOBRIDGE_TURN_*` 就一起下发 TURN。只有连 STUN 都没有才 503 `turn_unavailable` |
| `POST /api/dev/buddy-request` | **契约外的演示口子**：模拟「收到一条伙伴申请」，对应前端 mock 的 `receiveBuddyRequest` |
| `POST /api/dev/match-request` | **契约外的演示口子**：模拟匹配引擎，替当前账号造一条「待接受」请求（真实环境是匹配引擎 + `/ws/match` 推送，见 Phase 4）。前端 mock 的 `requestMatch({ reason: 'demo' })` 对应的就是它 |
| `POST /api/dev/reset` | **契约外的本地口子**：一键重置演示数据（现场救场用）。注意它会**连令牌表一起清掉**，旧令牌立刻失效，前端要重新 `POST /api/auth/session` |

## 实时信令（WebSocket）

信令只做两件事：**配对状态同步** + **SDP / ICE 转发**，不承载媒体（音频走 P2P）。
和 REST **共用同一个端口、同一份令牌**。

| 频道 | 事件 | 方向 | 什么时候推 |
| --- | --- | --- | --- |
| `/ws/match` | `queue:updated` | 下行 | 连上时 + 队列任何变动（入队 / 取消 / 被摘走） |
| `/ws/match` | `match:matched` | 下行 | 有人为你成房 / 造了待接受请求。`requestId` 为 `null` = 房已开好，不用接受，直接进房 |
| `/ws/match` | `match:taken` | 下行 | 列表里某位候选人被摘走，前端让它淡出 |
| `/ws/match` | `queue:joined` | 上行 | 客户端确认「我在等了」，服务端回一份当前列表当确认 |
| `/ws/rooms/:roomId` | `room:ready` | 下行 | 房内凑齐两条连接（`peerReady` 变 `true`） |
| `/ws/rooms/:roomId` | `rtc:offer` / `rtc:answer` / `rtc:ice` | 双向 | 原样转发给房里**其他人**，绝不回给发送方 |
| `/ws/rooms/:roomId` | `rtc:level` | 双向 | 对方说话音量（0~1），跨设备档位靠它画对方的波形；约 11 条/秒 |
| `/ws/rooms/:roomId` | `room:peer-muted` | 双向 | 静音徽标，同样是转发（不是服务端状态） |
| `/ws/rooms/:roomId` | `room:card` | 双向 | 翻话题卡（`{ cardId, index }`），转发给房里其他人，让双方看同一张；收端跟过去、不再回推 |
| `/ws/rooms/:roomId` | `room:peer-left` | 下行 | 房内某条连接断开且还有别人 |
| `/ws/rooms/:roomId` | `room:ended` | 下行 | `POST /api/rooms/:roomId/end` 成功，另一端跟着跳结算页 |
| 两条频道 | `error` | 下行 | 上行消息坏 JSON / 类型不在白名单，信封与 REST 同形状 |
| 两条频道 | `ping` / `pong` | 双向 | 保活 |

**握手四条依次判**（谁先不过谁先拒，都回与 REST 同形状的错误信封，方便现场排障）：

| 顺序 | 检查 | 不过就回 |
| --- | --- | --- |
| 1 | `Origin` 在白名单里（`http(s)://<本机/局域网地址>:<任意端口>`） | `403 forbidden` |
| 2 | 路径是 `/ws/match` 或 `/ws/rooms/<roomId>` | `404 not_found` |
| 3 | 令牌有效（`?token=` 或 `Authorization: Bearer`） | `401 not_authorized` |
| 4 | 房间真的存在（只有房间频道要判） | `404 room_gone` |

```bash
# 拿令牌
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/session \
  -H 'content-type: application/json' -d '{"role":"learner","deviceId":"device-my-laptop"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")
# 连上就会收到一条 queue:updated
npx --yes wscat -c "ws://localhost:8787/ws/match?token=$TOKEN" -H "Origin: http://localhost:4173"
```

三条容易踩的口径，都写在 `src/ws/` 的文件头：

1. **令牌走查询串**：浏览器的 `WebSocket` 构造函数不允许自定义请求头，带不了
   `Authorization`；同时也认 `Authorization` 头，方便 node / curl 客户端。
2. **没有 `Origin` 就放行**：浏览器发 WebSocket 一定带 `Origin`，恶意页面伪造不了；
   带不了 `Origin` 的只有非浏览器客户端，它们已经被令牌拦过一道 —— 与 REST 的 CORS 同一个口径。
3. **定向推送按 `(账号, 身份)` 过滤**：一个账号有 learner / buddy 两种身份，
   只按账号过滤会把「学习者该弹的接受框」推到母语者那个标签页上。

## 目录

```
backend/
├── src/
│   ├── server.js            装配：CORS → 路由 → body → 幂等 → handler → 统一信封；
│   │                        再挂信令（接管 upgrade），REST 与 WS 共用同一份 db 与令牌
│   ├── http/                地基：envelope（信封/错误码）、router（路由表 + :param）、
│   │                        cors、body、auth（Bearer）、idempotency（requestId 去重）
│   ├── ws/                  protocol.js（频道解析 / 握手取令牌 / 上行白名单，纯函数可单测）、
│   │                        hub.js（连接登记簿：按频道登记、转发排除发送方、按身份定向）、
│   │                        signaling.js（握手四条判 + 转发 + 领域层 → 信令层的事件桥）
│   ├── store/               db.js（内存表 + JSON 快照）、seed.js（出厂种子：**空**）
│   ├── domain/              account.js（账号/资料/设置）、dictionary.js（词表）、
│   │                        match.js（队列 / 候选 / 匹配条件）、rooms.js（成房 / 接受 / 拒绝）、
│   │                        rtc.js（ICE 服务器下发）、
│   │                        social.js（伙伴申请 / 伙伴 / 进度 / 历史 / 榜单）、
│   │                        peerView.js（候选人对外视图：匿名与可见范围服务端裁剪）、validate.js
│   ├── lib/                 matching.js（与前端 logic.js 同源的打分与排序）
│   └── data/                vocabularies.js（词表）、leaderboard.js（榜单常量）
├── tests/                   接口 / 信封 / CORS / 幂等 / 持久化 / 字典 / 契约 /
│                            算法同源 / 真实账号场景 / 队列 / 候选 / 成房 / 信令 / ICE
├── tools/                   check-contract.mjs（已实现路由 ↔ docs/10 契约，含词表 / 错误码 / 字段名）、
│                            smoke.mjs（Phase 0+1 验收剧本）、
│                            smoke-ws.mjs（真链路信令冒烟：经前端反代与 /ws 隧道）、
│                            preflight-lan.mjs（双设备实测前自检：局域网地址 / 证书 SAN / CORS / wss 握手）、
│                            rehearse-rtc.mjs（双端彩排：两条真 rtc.js 会话走真信令 + 五条兜底）
└── .data/                   JSON 快照（gitignore，每个环境自己生成）
```

## 约定（与前端契约一致）

- **统一信封**：成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message } }`。
  前端只认 `error.code`，所以新增错误码必须先写进 `frontend/docs/10-api-v1.md`。
- **鉴权**：`Authorization: Bearer <token>`；令牌是 12 小时有效期的不透明串。
- **幂等**：写接口带 `requestId`，同一个键重复提交返回第一次的结果（弱网重试不会把 XP 加两次）。
  键里带令牌，不同账号用同一个 `requestId` 不会互相串结果。
- **字段校验**：枚举越界、类型不对、字段名不认识 → 400 `bad_request`，消息里带字段名。
- **出厂全空**：两份资料除 `userId` 外全是 `null` / 空数组，`onboarded: false`——
  注册三页就是要把这些填上；进度与设置给一份合理初值（xp 360 / 连续 3 天 / 46 分钟）。
- **两份资料分开存**：资料表一行一个人格，按 `(accountId, role)` 定位，两个口子各改各的，
  响应里不下发内部字段（`accountId` / `role`）。
- **五张表**：`users` / `profiles` / `queue` / `rooms` / `relations`，另有 `settings` / `progress` /
  `sessions` / `matchRequests` 四张 demo 辅助表（最后一张装「待接受的匹配请求」）。
- **成房必须原子**：`accept` 与 `POST /api/rooms` 都可能成房，谁先到谁赢，第二个 409 `room_taken`。
  原子性由 `db.claimQueueRow()` 保证（检查 + 置位在同一个同步调用里，不靠前端把列表项删掉来假装）。
- **不接受 ≠ 退出匹配**：`decline` 只跳过这一位，队列行原封不动；彻底退出只有 `DELETE /api/match/queue`。
- **互补只加权不筛选**：语言互补（`wantToLearn` ∩ 对方母语）只加 8 分决定顺序，
  谁都不从列表里消失——小规模冷启动下，筛掉人就等于匹配不到人。
- **打分与排序只写一遍**：`src/lib/matching.js` 与前端 `logic.js` 逐行同源，
  `tests/matching.test.mjs` 会把两边对同一组输入的输出逐个比对（改了公式忘了同步就红）。
- **匿名与可见范围在服务端裁剪**：候选人一律走 `domain/peerView.js`，
  匿名行不下发 `displayName`（前端用自己的语言包写「匿名伙伴」），后端不掺 UI 文案。

## 已知限制（接真后端前要知道）

- 房间元信息、话题卡、结算、反馈和房间信令均校验参与者；无关账号返回 403 `forbidden`。公网邀请入口和部署配置见根目录 [deploy/README.md](../deploy/README.md)。
- `pickCards({ count: NaN })` 会返回空数组（与前端 `topicPicker.js` 行为一致）；
  HTTP 层的 `clampCount` 已把缺省 / 非数字兜成 8，所以接口发不出这个空数组。
- **信令没有断线重连补发**：断线期间的事件不重放，前端重连后靠 REST 拉一次现状
  （`queue:updated` 在连上时会立刻推一份，正是为此）。
- 本地与云端均支持静态 TURN 配置；当前免费部署使用 Metered 500 MB 免绑卡档位的凭证，Cloudflare 临时签发保留为可选适配。实际跨网络语音仍须在完成云账户配置后用真机验收。
- 引入 `ws` 之后后端不再是**完全**零依赖。REST 侧仍然是纯 `node:http`，
  信令只多这一个包（`ws` 自身零依赖），`npm install` 之后离线可跑。

## 契约是唯一真源

字段级契约在 [frontend/docs/10-api-v1.md](../frontend/docs/10-api-v1.md)（37 个端点、两份资料的属性汇总）。
`npm run check` 会拦住四类漂移：

1. 代码里实现了契约没声明的路由；
2. `/api/tags` 下发的字段与契约那一行写的响应字段不一致；
3. 后端词表与 `frontend/src/data/tags.js` 不一致（多一个 / 少一个取值都报错）；
4. 代码里用了契约第 3.1 节没声明的错误码。

所以改接口的顺序永远是：**先改契约文档 → 再改实现 → 最后跑 `npm run check`**。

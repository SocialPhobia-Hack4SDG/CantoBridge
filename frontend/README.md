# CantoBridge · 前端

> 让粤语学习者与粤语母语者（Cantonese Buddy）一对一开口聊天：AI 生成普通话 / 粤语 / 英文三语话题卡，把「先学一门语言，再找机会用它」变成「在真正使用一门语言的过程中学习它」。

**当前状态：规划文档 + 零依赖 MVP，默认就是真后端。** 16 个路由、38 个组件、582 个测试全绿。打开 `https://localhost:4173/` 直接连本机后端（`8787`）；想跑纯模拟数据、不开后端，加 `?api=mock`。`npm run e2e:real` 已用真后端走完 5 分钟主路径（17/17，2026-10-05 复测）；**两台真机的语音连线也已经打通** —— 各自注册一个账号、进同一间房、对着麦克风说话能互相听见。

`tools/serve.mjs` 现在是**同源反向代理**：一个端口同时发静态文件、把 `/api/*` 转给后端、把 `/ws/*` 的 upgrade 隧道给后端，并且默认走 **HTTPS**（自签证书自动生成，**启动时比对局域网地址、过时就自动重签**）。这样手机用局域网 IP 打开时 `getUserMedia` 才拿得到麦克风——局域网 IP 不算安全上下文，只有 `localhost` 算。

## 怎么跑

不需要 `npm install`——这个 MVP 是**零依赖、无构建步骤**的 ES Module，只用浏览器原生能力和 Node 内置能力。

```powershell
# 在 frontend/ 目录下
node tools/serve.mjs          # 默认 4173 端口，HTTPS；会同时打印局域网地址

# 浏览器打开
#   本机（真后端）：   https://localhost:4173/           需要先在 backend/ 跑 npm start（8787）
#   本机（纯 mock）：  https://localhost:4173/?api=mock  不需要后端，数据全在浏览器里
#   手机同一 WiFi：    https://<命令行打印的局域网 IP>:4173/
```

首次启动会生成自签证书到 `tools/.certs/`，浏览器会提示「不受信任」——**本机自己看界面**选「继续访问」即可；**上真机别这么做**，走下面的公网隧道（真证书、零警告）。**这份证书是跟着本机局域网地址走的**：换 Wi-Fi、换网段之后启动会自动重签（日志里会说原因），旧的作废、手机重装一次即可，不用手动删 `tools/.certs/`。想用纯 HTTP（本机 localhost 调试足够）加 `--http`：

```powershell
node tools/serve.mjs --http            # 纯 HTTP，反代照常
node tools/serve.mjs --backend http://127.0.0.1:9999   # 后端不在 8787 时
```

默认档位的接口**打成同源 `/api/...`**（由反代转给 8787），所以 HTTPS 页面不会撞 mixed content。要绕过反代直连后端，用 `?direct`；要指到任意后端，用 `?backend=http://192.168.1.5:9999`。（老链接里的 `?api=http` 仍然等价于默认档位，照旧能用。）

现场 demo 用手机浏览器打开局域网地址即可（手机优先的 430px 竖屏布局；桌面浏览器会把内容居中成一个手机框）。

### 两台设备真实通话：开演前先自检

页面默认就连后端，信令与 P2P 也已经接通 —— **两台设备的麦克风已经能互通**（2026-10-01 真机实测）。
下面这两步是出发前的复核，不是「还没做」。

**先选访问方式——要上真机就用公网隧道，别用局域网自签证书。** 局域网那套每台设备都要
手动信任一次证书（浏览器一直挂「不安全」），换 Wi-Fi 还要重来；隧道是 Cloudflare 边缘的
真证书，零警告、不用同一个 Wi-Fi。隧道配置不在本仓库内。

开演前先跑这两个脚本（都在 `backend/`，都需要 `npm start` 与 `npm run serve` 在跑）：

```bash
cd backend && npm run preflight:lan   # 10 项：局域网地址 / 证书 SAN / 运行中证书是否跟上 / CORS / wss 握手
cd backend && npm run rehearse:rtc    # 18 项：两条真 rtc.js 会话走真信令 + 五条兜底
```

`preflight:lan` 是唯一走**局域网地址**而非 `localhost` 的检查——换了 Wi-Fi 之后
自签证书的 SAN 可能不含新地址，手机就会报证书错误。现在 `serve.mjs` 启动时会自己比对
SAN 与当前地址、对不上就重签，所以这一条通常已经是复核位；脚本仍会在你拿起手机之前先喊出来。
细节见 `backend/README.md` 的「双设备实测前的两个自检」。

**走隧道时自检换成这条**（它同时验了公网域名下的 REST 与 `wss` 握手，也就是
`CANTOBRIDGE_CORS` 有没有配对）：

```bash
cd backend && npm run rehearse:rtc -- --base https://<隧道域名>
```

然后两台设备各开那个 `https://<隧道域名>/`（**不会有任何证书警告**），进同一个房间，
对着麦克风说话即可。**通话档位不用手动切**：真后端档位下出厂值 `sim` 会自动升到
`远端信令`（见 `src/services/index.js` 的 `resolveSignalMode`）—— 这一步以前要两台设备
各自去 `/dev/mock` 切，最容易忘，忘了双方就都只看得到假波形、听不到声音。

> `RTCPeerConnection` 的 P2P 打洞没法在 Node 里模拟，脚本能保证的只有「除了媒体栈，每一步都对了」；
> 真正只有真机能回答的那一条 —— **两个浏览器之间能不能打通 P2P —— 已经在真机上验过、成立**。

> 走局域网自签证书那条路时，手机端操作是：两台设备各开 `https://<局域网 IP>:4173/`，
> 各自信任一次证书。能用，但这就是下面那节要解决的问题。

### 手机上一直报「不安全」怎么办

> **能选就别走 1 和 2。** 上真机一律用上面那条公网隧道——真证书、零警告、每台设备都不用手动
> 信任、还不用连同一个 Wi-Fi。下面三条是**只在局域网自签证书这条路**上才需要的补救。

这是**自签证书**的必然结果，不是配置错了。浏览器验证 HTTPS 要做两件事：证书里的名字跟地址对不对得上
（我们的 SAN 含局域网 IP，这条过），以及签发链能不能走到手机系统信任库里的一条根证书。
这张证书的签发者就是它自己，手机信任库里没有它 —— 链断在起点，所以报「无法验证身份」。

三条路，从最推荐到最省事：

1. **换真证书：走公网隧道**（**真机联调就用它**）。用 `cloudflared` 之类的隧道拿一个真域名，
   连蜂窝网络也能测 —— 不再报「不安全」，每台设备都不用手动信任。
2. **把证书装进手机**（起不了隧道时才用）。手机浏览器打开 `https://<局域网 IP>:4173/cert.crt` 下载，
   然后按系统流程装。**iOS 必须两步**：装完描述文件后还要去
   「设置 > 通用 > 关于本机 > 证书信任设置」打开完全信任 —— 少第二步等于没装，
   而且这一步很容易漏，因为装描述文件的流程看起来已经「完成」了。
3. **点过去**（只适合**本机自己看界面**）。iOS Safari：警告页 →「显示详细信息」→「访问此网站」；
   Android Chrome：「高级」→「继续前往 <IP>（不安全）」。页面会一直挂着「不安全」——
   这等于关掉整条链路的加密保护，**两台设备真机联调不要这么做**。

换 Wi-Fi 之后证书又报错的话：先**重启一次 `npm run serve`**（它会自动重签并说明原因），
再看命令行重新打印的那个局域网地址——地址本身也可能变了，手机要打开新链接。
还不对就跑 `cd backend && npm run preflight:lan`，它会逐层告诉你卡在哪。

## MVP 现在跑通了什么

演示脚本按 [docs/02-frontend-scope.md](docs/02-frontend-scope.md) 第 2 节的 5 分钟时间轴走：

| 步骤 | 路径 | 看得到什么 |
| --- | --- | --- |
| 1 | `/` | 落地页：一句话定位 + 两张能力卡 + 「开始使用」唯一入口；开发控制台不再暴露给普通用户 |
| 2 | `/onboarding/role` `profile` `privacy` | 选身份 → 一屏一题填资料（母语 / 水平 / 兴趣标签 / 学习目标 / 身份，**出厂全部为空、不预选任何一项**）→ 设置资料可见范围，右侧实时预览「别人会看到你什么」。匿名默认关闭，之后可在「我的 → 设置」主动开启 |
| 3 | `/match` | 学习者：**一张开始卡片**（一位说明 + 一个「开始匹配」按钮，**匹配前不再选兴趣**；点一下直接入队，入队后原地换成等待面板）+ 等待面板（计时 + 「按什么找人」的摘要 + **取消匹配**出口），**排队挂在后台，离开这一页也不会断、计时不清零**；匹配成功后右上角弹 `MatchAcceptToast`（头像 + 名字 + 10 秒倒计时 + 接受 / 不接受，任何页面都会弹）；母语者：候选人列表带匹配度百分比 |
| 4 | `/room/:roomId` | 语音房间：头像 + 声波 + 计时 + 三语话题卡（左右滑动 / 箭头切换）+ 句型收藏 |
| 5 | `/room/:roomId/summary` | 结算：本次时长、+XP、新解锁成就、给对方反馈、发出伙伴申请 |
| 6 | `/me` `/leaderboard` `/history` | 「我的伙伴」插槽（收到的申请 / 我发出的申请 / 已连接的伙伴）、成就墙、周榜 / 月榜 × 学习者榜 / 伙伴榜、连线记录 |

兜底都做完了，现场不怕：

- **没有麦克风 / 没授权**：提示麦克风不可用，保留接收真实声音的旁听能力，麦克风按钮置灰。真实通话不再切换到模拟模式。
- **对方掉线**：横幅提示，2 秒后自动结算，不会卡在房间里。
- **刷新丢房**：房间只存在内存里，刷新后回匹配大厅并挂「房间已经不在了」提示。
- **接口失败**：页面走失败态 + 「离线数据」横幅 + 重试按钮。
- **迷路**：任何不存在的路径都有兜底页，不回显白屏。
- **救场**：`/dev/mock` 演示控制台可以即时改身份、模拟延迟、话题卡难度、通话模式（模拟 / 本地双标签页 / 远端信令）、后台匹配开关与接受弹窗倒计时上限，还能「模拟匹配成功」造一条匹配请求，一键重置演示数据，快速跳转任意路由。
- **配色太扎眼**：`/me` 的「配色主题」卡可切换**配色主题**——「薄荷绿」（默认，浅灰底 + Jade 绿）与「暖橙」（**米黄底 + 明橙色按钮**）；`/dev/mock` 挂了同一个开关，方便不离开当前页换色。切主题**只改 CSS 变量、不重渲染页面**，所以不会打断正在进行的匹配或通话（见 [docs/05-design-system.md](docs/05-design-system.md) 第 2.5 / 7.13 节）。

## 文件地图

2026-10-13 公网通话更新：真实后端档位禁用模拟兜底与演示房间入口，连接失败明确显示未就绪，并提供「重新连接」。修复授权等待期间丢失 SDP / ICE、ICE 早于远端描述到达及无 streams 音轨播放的问题。房间下方「通话检查」可显示信令、中继、媒体流量和播放状态，输出不包含密钥、密码或网络地址。开发 mock 档位的测试模拟仍独立保留。

```
frontend/
├── index.html            浏览器入口（直接 <script type="module">，无打包）
├── package.json          只有脚本，没有 dependencies
├── src/
│   ├── app/              app.js 装配（路由 / 守卫 / 三态 / 后台匹配引擎 / 主题同步）、routes.js 路由表、store.js 状态、page.js 页面契约、main.js 入口、session.js 启动引导（自动登录，换身份重登）、socialSync.js 伙伴关系同步、matchSync.js 匹配频道长连接（收 queue:updated / match:matched / match:taken）
│   ├── components/       38 个纯展示组件：base / onboarding / home / match / room / progress
│   ├── data/             标签枚举、话题库（13 个兴趣主题 × 4 难度 × 8 张 + 7 个通用主题 × 4 难度 × 2 张 = 472 张卡）、成就表、枚举文案映射
│   ├── i18n/             界面文案 286 个 key × 简 / 繁 / EN（粤语是内容语言，出现在话题卡里）
│   ├── lib/              纯函数：router / logic / topicPicker / audio / viewModel / signal / swipe / dom
│   ├── pages/            16 个页面模块
│   ├── services/         mockApi.js（纯 mock 档位的实现，候选池默认空）+ httpApi.js（37 个方法走真后端，3 个后置方法降级）、rtc.js 通话会话（sim / local / remote 三档，local 走 BroadcastChannel、remote 走 WebSocket）
│   └── styles/           tokens.css 设计 token + app.css
├── tests/                582 个测试（含 app.test.mjs 端到端 happy path，以及 tools/e2e-real.mjs 真后端脚本）
│   └── helpers/          rtc-stub.mjs：RTC 替身（虚拟时钟 / 假 WebSocket / BroadcastChannel / RTCPeerConnection / 麦克风 / Audio），单测与 backend 的双端彩排共用；另有 app-harness.mjs（把 app 真跑起来的 DOM harness）与 http-stub.mjs（假 fetch）
├── tools/                serve.mjs 同源反代服务器（静态 + /api + /ws 隧道 + HTTPS 自签证书 + /cert.crt 证书下载）、e2e-real.mjs 真后端端到端脚本、check-docs.mjs / check-ui.mjs / check-api.mjs 一致性校验
├── tasks/                交接提示词：把一次改动整段复制给实现 agent
└── docs/                 10 份规划文档（见下）
```

## 测试与一致性校验

```powershell
node --test "tests/**/*.test.mjs" "tools/**/*.test.mjs"   # 或 npm test：582 个测试
npm run check                                             # 或 node tools/check-docs.mjs && node tools/check-ui.mjs && node tools/check-api.mjs
```

校验分两块跑：

- **`tests/`**：纯函数单测（路由 / 话题选卡 / view model / store / i18n / mockApi）+ 组件渲染 + **`tests/app.test.mjs` 端到端集成测试**。后者用 DOM / Window stub 真把 `app.start()` 跑起来，从落地页一路点到结算页，并覆盖守卫、兜底、界面语言切换。它抓出过三个会让现场白屏的 bug：`start()` 引用未定义变量、`MatchPage.render` 在 `load()` 之前读 `view.local`、`SessionSummaryPage.render` 在 `load()` 之前读 `view.data`——都是单测全绿而真实浏览器一点就崩的类型。
- **`tools/check-docs.mjs`**：把 [docs/03-ia-and-pages.md](docs/03-ia-and-pages.md) 的路由表与 [docs/05-design-system.md](docs/05-design-system.md) 的组件清单当可执行契约，校验 11 条不变量（文档齐全、README 导航完整、路由无重复、跨文档引用闭合、每个路由都有三态、组件双向闭合、mermaid 合法、站内链接可解析、里程碑日期齐全、所有 `/api/` 路径都在 09 声明过（含 `POST /api/...` 写法，本地专用口子除外）、文档里写死的路由 / 组件 / 文档 / 测试数量与实际一致）。
- **`tools/check-ui.mjs`**：反向校验**代码与文档一致**——路由表 ↔ `src/app/routes.js`、组件清单 ↔ `src/components/`、页面名 ↔ `src/pages/`、文档里出现的文案 key ↔ `src/i18n/` 语言包。
- **`tools/check-api.mjs`**：把**属性汇总与接口契约**钉在代码上——37 个端点与 09 第 3.2 节一一对应、54 条属性字段与 `src/app/store.js` 的默认值一一对应、词表与 `src/data/tags.js` 一一对应、成就表与 `ACHIEVEMENT_CATALOG` 一一对应、mock 对照表与 40 个 service 方法一一对应、所有 JSON 示例可 `JSON.parse`；另外，根目录 `TODO.md` 与 `frontend/tasks/` 下的交接提示词所引用的接口，也必须在 09 的清单里声明过。

## 与 docs/04 的偏差（已知，待你拍板）

[docs/04-tech-stack.md](docs/04-tech-stack.md) 推荐的是 **Vite + React + TypeScript + Tailwind**。本轮为了「先跑通」用的是**零依赖原生 ES Module + 手写 DOM 构造器**，原因：

- 装依赖需要联网授权，会挡住「5 分钟能演完」这个第一目标；
- 现场断网、换机器时不依赖 `node_modules`，`node tools/serve.mjs` 一定能起来。

代价与后续：没有 JSX、没有类型检查、组件写法是 `h(tag, props, children)`。但**分层、路由表、设计 token、i18n、service 抽象、页面三态这些结构完全按 docs/04 / docs/09 落地**，所以迁移到 Vite + React 主要是把 `h()` 换成 JSX、把 `routes.js` 换成 react-router 的机械工作，业务逻辑（`src/lib/`、`src/data/`、`src/services/`）可以原样搬。

## 交付形态

手机浏览器 Web，前端单页应用。现场 demo 大概率是窄屏设备，所以一切以 375~430px 竖屏为第一优先，桌面浏览器只做居中手机框，不做桌面版布局。

Android APK 是 P1 加分项，用 Capacitor 包装同一份 Web 产物，不开第二个代码库；它带来的后端新增需求见 [docs/08-apk-and-backend-asks.md](docs/08-apk-and-backend-asks.md)。

## 文档导航

按顺序读；`03` 是路由与组件的**唯一真源**，其它文档引用页面/组件时必须与它一致（有自动校验，见下文）。

| 文档 | 内容 | 读者 |
| --- | --- | --- |
| [docs/01-product-brief.md](docs/01-product-brief.md) | 产品与用户：用户画像、核心场景、痛点、价值主张、竞品对照 | 全队 / 讲 pitch 的人 |
| [docs/02-frontend-scope.md](docs/02-frontend-scope.md) | 前端范围与边界：做什么、不做什么、Demo 必须跑通的路径、可 mock 清单、兜底矩阵 | 前端 / 产品 |
| [docs/03-ia-and-pages.md](docs/03-ia-and-pages.md) | 信息架构、路由表、逐页元素与状态、关键流程图 | 前端 / 设计 |
| [docs/04-tech-stack.md](docs/04-tech-stack.md) | 技术选型：框架、状态、样式、i18n、路由、mock 层、语音通话、部署 | 前端 |
| [docs/05-design-system.md](docs/05-design-system.md) | 视觉基调、设计 token、核心组件清单与验收要点 | 设计 / 前端 |
| [docs/06-roadmap.md](docs/06-roadmap.md) | 里程碑与任务拆解，对齐 9/24 会议与 10/9 交付 | 全队 |
| [docs/07-open-questions.md](docs/07-open-questions.md) | 待团队 / 后端确认的问题，以及素材之间的矛盾点 | 全队 |
| [docs/08-apk-and-backend-asks.md](docs/08-apk-and-backend-asks.md) | Android APK 方案，以及需要向后台提出的新增需求清单 | 全队 / 后端 |
| [docs/09-frontend-logic-and-api.md](docs/09-frontend-logic-and-api.md) | 前端逻辑拆分：分层与目录、后端接口清单、前后端对接方式 | 前端 / 后端 |
| [docs/10-api-v1.md](docs/10-api-v1.md) | **后端接口 v1 契约**：属性汇总（54 条字段）、37 个端点的请求 / 响应字段、枚举与错误码、DTO 示例、mock 对照 | 后端 / 前端 |
| [tasks/bc-exchange-implementation.md](tasks/bc-exchange-implementation.md) | **实现交接提示词**：「语言交换 + 供给优先」（B+C）的文件级清单、测试要求与验收 | 前端 / 实现者 |


## 素材来源与优先级

> 立项素材原本放在仓库根目录的 `foundation/`，**已从本仓库移出**，不随仓库分发。

产品定义以**《框架规划》**为准；PDF 明确留问的地方（视频还是语音、匹配方式、界面语言、头像），按**更晚的《hackathon 项目提示词》**收敛：

| 优先级 | 素材 | 说明 |
| --- | --- | --- |
| 1（权威） | 《框架规划》（6 页） | 产品定义、用户、匹配、话题卡、激励、隐私、完整流程 |
| 2 | 《hackathon 项目提示词》 | 同一作者更晚的实现级指令：只做语音、手动匹配、不做头像、界面语言三选一、逐页交互细节 |
| 3 | 微信截图（赛道定义） | Smart Living, Culture & Belonging |
| 4（仅参考） | 微信截图（早期头脑风暴） | 「围港粤话」LBS 互助 + 头衔 + 霓虹暗色方向，**与 PDF 已明显分歧**，视觉方向已被素材 2 取代 |

> 三份素材的矛盾点已逐条记录在 [docs/07-open-questions.md](docs/07-open-questions.md)。

## 仓库约定

见根目录 `AGENTS.md`：每轮对话后写测试并保证全绿，然后用 `git add` + `git commit` 提交，commit message 用中文描述。

后端的任务清单在根目录 [TODO.md](../TODO.md)：接口实现顺序、P0 最小集、联调步骤与待拍板项都在那里，每轮对话后更新，**任务勾选状态以它为准**。

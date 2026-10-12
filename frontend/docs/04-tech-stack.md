# 04 · 技术选型

## 1. 决策摘要

一句话：**Vite + React + TypeScript + Tailwind 的纯客户端 SPA，手机优先，原生 WebRTC 语音（只做音频），全后端能力走可切换的 mock 层，静态托管。**

> **实际落地与本文档的偏差（2026-10-01 补记）**：为了「先跑通 + 现场断网也能起」，实际实现是
> **零依赖原生 ES Module + 手写 DOM 构造器**（无构建步骤、不装 `node_modules`），而不是本文推荐的
> Vite + React + TS + Tailwind。**分层、路由表、设计 token、i18n、service 抽象、页面三态都按本文与 09 落地**，
> 所以迁移主要是把 `h()` 换成 JSX、把 `routes.js` 换成 react-router 的机械工作，业务逻辑（`src/lib/`、
> `src/data/`、`src/services/`）可以原样搬。
> 同理，第 8 节的 Vercel 静态托管也未采用：本机由 `tools/serve.mjs` 同源反代 + HTTPS 提供，
> 真机联调走 cloudflared 隧道，**仓库里没有任何部署配置**。

| 领域 | 选型 | 版本 | 关键理由 | 主要风险 |
| --- | --- | --- | --- | --- |
| 构建 | Vite | 7.x | 冷启动秒级、配置极少、Hackathon 迭代最快 | 无 |
| 框架 | React + TypeScript | React 19 / TS 5.x | 生态最全，队友上手成本最低 | 无 |
| 样式 | Tailwind CSS | 4.x | 原子类配合设计 token，浅色主题与单一主色落地快 | 4.x 与 3.x 配置语法不同，需注意插件版本 |
| 路由 | React Router | 7.x（声明式模式） | 用 `createBrowserRouter` 即可，路由表与本文档一一对应 | 部署必须配 SPA 重写，否则刷新 404 |
| 客户端状态 | Zustand | 5.x | 无 Provider 嵌套、样板代码少，适合 demo 规模 | 无 |
| 服务端状态 | 不引入 | —— | demo 后端全是 mock，引入 TanStack Query 属于过度设计 | 后端接口真接入时需补一层缓存策略 |
| 动画 | Framer Motion | 12.x | 话题卡拖拽、匹配成功浮层、徽章弹出都靠它 | 拖拽组件需注意与浏览器手势冲突 |
| i18n | i18next + react-i18next | 最新 | 三语切换最成熟，支持命名空间与缺 key 回退 | 粤语用字需人工校对，不要机翻 |
| 语音 | 原生 WebRTC API（仅音频） | —— | 不引第三方 SDK，可控、体积小，出现问题能自己查 | TURN 与信令需要方案，见第 4 节 |
| 测试 | Vitest + React Testing Library | 最新 | 与 Vite 同源配置，零额外构建 | 无 |
| 代码规范 | ESLint + Prettier | 最新 | 多人协作基本盘 | 无 |
| 包管理 | pnpm | 最新 | 安装快、磁盘省，Vercel 原生支持 | 队友若用 npm 会产生锁文件冲突，需统一 |
| 部署 | Vercel（或 Netlify） | —— | 一行命令上线，自带 HTTPS 与预览链接 | 免费额度与国内访问速度 |

## 2. 为什么是 Web SPA 而不是别的

### 2.1 为什么不用 Next.js

素材 4 在没有指定技术栈时建议了 Next.js。我们仍然选 Vite，这是一处**有意的偏离**，理由如下：

- Next.js 的价值在 SSR、SEO 与服务端数据获取。CantoBridge 的核心是**进入后的一对一实时语音通话**，页面几乎不会被搜索引擎索引，也不需要首屏服务端渲染。
- 引入服务端运行时会让 WebRTC 的信令部署与本地调试多一层复杂度，而我们只有 10/9 一个截止日。
- demo 阶段所有数据都走 mock 层，没有需要服务端聚合的场景；静态托管天然满足 HTTPS 与 `getUserMedia` 的要求。

**万一团队坚持 Next.js：** 前端代码基本不受影响（第 3 章的目录结构可以直接搬进 `app/`），代价是要额外配置服务端运行时、部署环境与信令联调，预计多花 1 天。此事已登记为 [07-open-questions.md](07-open-questions.md) 的 F1。

### 2.2 为什么不做 PWA

PWA 的收益是「加到主屏」和离线缓存，成本是 Service Worker 生命周期、缓存版本管理、iOS 上更啰嗦的权限提示。现场演示是扫码开链接，PWA 带来的边际收益很低，风险却不低。等 10/9 交付后再作为加分项评估。

### 2.3 为什么不做原生（React Native / Flutter）

早期头脑风暴里建议过 React Native / Flutter，那是当时「LBS 地图 + 双盲互助」方向的产物。现在产品是「扫码即用的网页 demo」，原生需要打包、签名、安装描述文件，现场演示风险高得多。**本决策与素材 3 的建议存在分歧，以产品形态为准。**

### 2.4 那 APK 怎么做

如果确实要出 Android 安装包，**用 Capacitor 包装同一份 Web 产物**，而不是重写一个原生应用：`src/` 一行不用改，麦克风权限交给原生层接管，后续要加推送也有现成插件。

代价是 App 端失去了 Web 端的两条逃生口（同浏览器双标签页信令、明文 http），因此**信令与 TURN 从可选变成必需**，并会连带出一批后端新增需求。完整清单见 [08-apk-and-backend-asks.md](08-apk-and-backend-asks.md)。

## 3. 目录结构约定

```text
frontend/
  docs/           本次规划文档（01 ～ 10）
  tools/          文档一致性校验（零依赖 Node 脚本）
  src/
    app/          路由表、AppShell、Provider、路由守卫
    pages/        路由级页面，与 03 的路由表一一对应
    components/   05 中的组件清单（纯展示）
    features/     按领域组织：onboarding / home / match / preview / room / reward / profile
    services/     唯一数据入口：index.ts 按开关切 mock 或 http
    data/         Topic Database、词表、成就定义（没有 fixtures：候选池由 service 层注入，见 09 第 4.1 节）
    types/        DTO 与 view model 类型
    stores/       Zustand stores，见 03 第 7 节
    i18n/         三个界面语言包
    styles/       设计 token 与全局样式
    lib/          工具函数、WebRTC 封装、字段映射
```

**约定：** 职责划分与 [09-frontend-logic-and-api.md](09-frontend-logic-and-api.md) 第 2.2 节一致。`components/` 只放纯展示组件，`services/` 是唯一允许发请求的地方，`data/` 不含任何网络逻辑。

## 4. 语音通话方案（不做视频）

素材 4 明确「本项目只设计 Audio Call，不开发 Video Call」，因此本章只保留音频链路，原先的视频分支与摄像头相关逻辑已删除。

### 4.1 技术路线

直接用浏览器原生 API：`navigator.mediaDevices.getUserMedia` 采集，`RTCPeerConnection` 建连，`BroadcastChannel` 或 WebSocket 交换 SDP 与 ICE 候选。不引入任何第三方通话 SDK。

### 4.2 三级降级（与 02 的兜底矩阵对应）

| 级别 | 信令通道 | 网络 | 适用场景 | 现场可靠性 |
| --- | --- | --- | --- | --- |
| 1 远端模式 | WebSocket 服务 | STUN + TURN | 两台真机跨网络演示，效果最好 | 中，依赖 TURN 可用 |
| 2 本地模式 | `BroadcastChannel` | 仅 host candidate，无需 STUN | 同一浏览器两个标签页演示，零网络依赖 | 高 |
| 3 模拟模式 | 无 | 无 | 前两级都失败时，用假音频 + 静态声波撑完整流程 | 最高 |

**默认策略：** 现场优先走第 1 级；演示前彩排时如果 TURN 不稳定就切第 2 级；第 3 级只作为保险，任何时候都能一键切过去，UI 完全一致。

**APK 端注意：** 第 2 级依赖同浏览器的两个上下文，在 App 里不存在，因此**安装包只保留第 1 级与第 3 级**，TURN 不再是可选项。

### 4.3 已知风险

- **iOS Safari 的自动播放限制：** 远端音频必须由用户手势触发播放，否则静默失败。这就是兜底矩阵第 8 条「点击开始通话」手势门的由来，属于预期行为。
- **TURN 成本：** 免费额度有限。若预算为零，就把第 2 级作为主方案，并接受「只能同浏览器演示」的限制。
- **HTTPS 强制：** `getUserMedia` 只在安全上下文可用，本地开发用 localhost，线上必须有证书。**注意局域网 IP 不算安全上下文**——手机用 `http://192.168.x.x:4173` 打开会被直接拒掉麦克风。本项目的 `tools/serve.mjs` 因此默认起 HTTPS（自签证书自动生成到 `tools/.certs/`），并把 `/api/*` 与 `/ws/*` 同源反代给后端：https 页面调 http 接口会撞 mixed content，连 `ws://` 也会被拒，同源一次解决三件事。

## 5. i18n 方案

素材 4 规定界面语言为**简体中文 / 繁體中文 / English** 三选一；粤语是**内容语言**（出现在话题卡与句型里），不是界面语言。这两件事必须分开，是本项目最容易搞混的一点。

| Locale 代码 | 界面语言 | 说明 |
| --- | --- | --- |
| `zh-Hans` | 简体中文 | 默认界面语言 |
| `zh-Hant` | 繁體中文 | 面向香港与繁体用户 |
| `en` | English | 面向国际学生与非中文母语者 |

**关键约定**

- 话题卡是**内容数据**，不走 i18n 语言包，每张卡自带粤语 / 普通话 / 英文三份文本；切换界面语言不改变卡片的语言顺序。
- 粤语用字（睇、緊、咩、嘅、冇、嘢、咗、唔、係）必须人工校对，**不做机器转换**，字体覆盖检查见 05 第 3.1 节。
- 界面语言与学习者的「母语」是两个独立概念，不要混用。
- 缺 key 时回退英文并挂 `FallbackBanner`，绝不显示裸 key。
- 语言包按命名空间拆分（common / onboarding / match / room / reward），避免首屏加载全部文案。

## 6. Mock 数据层

原则：**业务组件永远不知道数据是真是假。**

```text
src/data/                静态数据：用户、伙伴、Topic Database、词表、成就、榜单
src/services/            统一访问入口，返回 Promise，含 300~800ms 人为延迟
src/services/index.ts    按 VITE_USE_MOCK 决定走 mock 还是真实 HTTP
src/services/mock/ai.ts  Mock AI Service：generateConversationCard()
```

- 服务层签名与未来真实接口保持一致，后端就位时只替换实现。
- **AI Mock Service 独立成 service**（素材 4 要求）：`generateConversationCard()` 读取兴趣交集与粤语水平，从 `src/data/` 的 Topic Database 选卡；Topic Database 至少覆盖 Anime / Food / University / Travel / Movies / Sports / Hong Kong Culture / Daily Life 八个主题，每张卡带三语文本、Useful Expressions 与难度档。将来接真实 GenAI 时只换这一个文件。
- 人为延迟是刻意保留的：它让加载态在演示时真的被看到，也逼前端把三态写完整。
- `MockControlPanel` 通过 `uiStore` 覆盖延迟、匹配结果、信令模式等开关。
- 数据校验用 Zod 在服务层出口做一次收口，防止后端响应与前端期望漂移。

## 7. 质量与测试

| 层级 | 工具 | 覆盖什么 |
| --- | --- | --- |
| 文档一致性 | Node 内置 `node:test` | 路由表与组件清单的跨文档闭合，零依赖，见 README |
| 单元测试 | Vitest | store 逻辑、话题卡选卡算法、积分计算 |
| 组件测试 | React Testing Library | 三态渲染、标签选择上限、隐私开关联动预览 |
| 端到端 | Playwright（可选，时间允许才做） | 5 分钟 happy path 的自动化复现 |
| 手动 | 真机彩排 | 兜底矩阵逐条演练，见 02 |

**优先级：** 文档一致性校验与 store 单测必须先绿；组件测试覆盖 P0 组件；Playwright 属于锦上添花。

## 8. 部署

- 静态托管到 Vercel，`vercel.json` 配置 SPA 重写，把所有路径交给 `index.html`。
- 环境变量：`VITE_USE_MOCK`、`VITE_SIGNAL`（sim / local / remote）、`VITE_SIGNAL_URL`、`VITE_API_BASE`、`VITE_TURN_URL`、`VITE_TURN_CREDENTIAL`。
- 每次推送自动产出预览链接，方便队友在手机上验证。
- 演示前一天冻结部署，之后只允许从固定的预览链接演示，避免现场构建失败。

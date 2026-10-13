# 05 · 视觉与组件系统

> 视觉方向以素材 4《hackathon 项目提示词》第 16–18 节为准：**浅色、极简、Apple 式克制、只用一个主色**。早期头脑风暴（素材 3）里的「香港霓虹灯牌 + 暗色夜话」方向**已被素材 4 取代**，理由与记录见 [07-open-questions.md](07-open-questions.md) 的 E6。

## 1. 视觉基调

三个关键词：**留白、轻盈、有人情味。**

- **留白**：一屏只讲一件事，信息少而明确；页面左右各留 20px，卡片之间留 12–20px。
- **轻盈**：浅灰底 + 白卡片 + 极轻的边框与阴影。不用重投影，不用多层玻璃拟态堆叠。
- **有人情味**：圆角、柔和的单一主色、平滑的微交互；像一位耐心的朋友，而不是一个考试系统。

**第一眼必须让人感受到：** 轻松、可信、现代、有温度。

**反面清单（明确不要）：** 不做 Dating App 的卡片滑人语感、不做 Moodle / LMS 的课程表格、不做后台 Dashboard 的密集图表、不做 Gaming 的高饱和与粒子动效、不做 AI Chatbot 的聊天气泡界面、不做彩虹渐变。

## 2. 色彩 Token

### 2.1 背景层级

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg-base` | `#F5F5F7` | 页面底色（素材 4 指定） |
| `--bg-raised` | `#FFFFFF` | 卡片、面板（素材 4 指定 Card 为 White） |
| `--bg-sunken` | `#ECECEF` | 语音舞台底、输入框底 |
| `--bg-overlay` | `rgba(245, 245, 247, 0.72)` | 浮层遮罩，配 12px 模糊 |
| `--bg-accent-soft` | `#E8F5EF` | 主色浅底：选中态、徽章底、标签选中 |

### 2.2 主色与强调色

**只用一种主色**（素材 4 明确要求），建立与香港、粤语文化相关的辨识度。

| Token | 值 | 语义 |
| --- | --- | --- |
| `--accent` | `#0E9F6E` | 唯一主色（柔和 Jade Green / Emerald）：主按钮、选中态、进度条 |
| `--accent-strong` | `#0A7A54` | 按下态与文字级的深色变体，保证对比度 |
| `--accent-soft` | `#E8F5EF` | 浅底衬色 |
| `--on-accent` | `#FFFFFF` | 主色实心块（主按钮、选中药丸、徽章）上的**文字色**。业务样式里**不许写死 `#fff`**——主题 2 的明橙底上必须换成深墨字 |
| `--on-danger` | `#FFFFFF` | `--danger` 实心块（挂断、错误）上的文字色 |

**身份区分不靠颜色**：粤语学习者与粤语母语者用**图标 + 文字 + 主色深浅**区分，不引入第二种主色。这一点是有意为之——两色身份系统会把产品推向 Dating App 的观感。

### 2.3 文本与边框

| Token | 值 | 用途 |
| --- | --- | --- |
| `--text-primary` | `#1D1D1F` | 正文与标题（素材 4 指定） |
| `--text-secondary` | `#6E6E73` | 副标题、说明文字 |
| `--text-muted` | `#5E6E64` | 辅助提示、占位、禁用 |
| `--border-subtle` | `rgba(0, 0, 0, 0.06)` | 分割线、卡片描边 |
| `--border-strong` | `rgba(0, 0, 0, 0.12)` | 输入框聚焦、选中态底衬 |

### 2.4 语义色

| Token | 值 | 用途 |
| --- | --- | --- |
| `--success` | `#0E9F6E` | 连接成功、保存成功 |
| `--warning` | `#B7791F` | 网络不稳、匹配超时 |
| `--danger` | `#C63C3C` | 挂断、错误 |

语义色只允许出现在状态点、横幅与挂断按钮上，**不做大面积铺底**。挂断按钮用实心填充加电话图标，不靠红色本身表意。

### 2.5 配色主题（可切换）

上面 2.1–2.4 写的是**默认主题 `mint`**（浅灰底 + Jade 绿）。界面另有一套**主题 2 `warm`：米黄底 + 明橙色按钮**，由「我的」页的 `ThemeSwitch` 切换（页头刻意不放，理由见 03 第 4.2 节），选择记在 `settings.theme` 并持久化。「每个主题只用一种主色」这条原则没有被打破——切主题换的是那个主色，不是在同一个主题里塞第二种主色。

| Token | `mint`（默认） | `warm`（主题 2） | 说明 |
| --- | --- | --- | --- |
| `--bg-base` | `#F5F5F7` | `#FAF3E6` | 米黄色页面底 |
| `--bg-raised` | `#FFFFFF` | `#FFFDF7` | 暖白卡片 |
| `--bg-sunken` | `#ECECEF` | `#F3E7D3` | 语音舞台底、输入框底 |
| `--bg-overlay` | `rgba(245, 245, 247, 0.72)` | `rgba(250, 243, 230, 0.78)` | 浮层遮罩 |
| `--bg-accent-soft` | `#E8F5EF` | `#FFE8CC` | 主色浅底 |
| `--accent` | `#0E9F6E` | `#F97316` | **明橙色按钮**（主题 2 的核心） |
| `--accent-strong` | `#0A7A54` | `#9A4A08` | 按下态与文字级深色变体 |
| `--accent-soft` | `#E8F5EF` | `#FFE8CC` | 浅底衬色 |
| `--on-accent` | `#FFFFFF` | `#3A2100` | 明橙底配深墨字 5.4:1；配白字只有 2.4:1，不达标 |
| `--text-primary` | `#1D1D1F` | `#2B2115` | 暖调深褐 |
| `--text-secondary` | `#6E6E73` | `#6F5C46` | 对比度 5.75:1 |
| `--text-muted` | `#5E6E64` | `#78664F` | 辅助提示、占位、禁用 |
| `--border-subtle` / `--border-strong` | `rgba(0, 0, 0, 0.06)` / `rgba(0, 0, 0, 0.12)` | `rgba(90, 62, 20, 0.10)` / `rgba(90, 62, 20, 0.20)` | 暖调描边 |
| `--warning` | `#B7791F` | `#9A4A08` | 暖色主题下不和主色抢眼 |
| `--shadow-card` / `--shadow-raised` | 黑色 rgba | 暖褐 rgba | 阴影带一点暖色，避免在米黄底上发脏 |

**实现约定（只有三条，别扩散）：**

1. 颜色字面量**只允许**出现在 `src/styles/tokens.css`；业务样式一律 `var(--…)`。主色实心块上的文字必须用 `--on-accent` / `--on-danger`，禁止再写 `#fff`（亮橙底上会糊）。
2. 每套配色的「底色 + 主色」另抽一对 `--palette-mint-*` / `--palette-warm-*`：两组主题变量引用它，`ThemeSwitch` 的色点也读它——**色点显示的颜色必然等于切过去之后的真实颜色**，不会两处漂移。
3. 字号、间距、圆角、动效、字体栈**不随主题变**，全站共用一份。

**时序：** `app.start()` 先把 `settings.theme` 写到 `<html data-theme>` 再渲染第一帧；之后 store 每次变动都同步一次（值没变就 `return`，不碰 DOM）。**切主题不触发整页重渲染**：颜色全走 CSS 变量，重建页面只会让当前页重新取数、闪一下骨架屏。

### 2.6 阴影

| Token | 值 | 用途 |
| --- | --- | --- |
| `--shadow-card` | `0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)` | 常规卡片 |
| `--shadow-raised` | `0 2px 6px rgba(0, 0, 0, 0.06), 0 16px 40px rgba(0, 0, 0, 0.10)` | 浮层、身份选择卡 |

全站只有这两级阴影，且必须极轻。禁止发光（glow）效果——那是素材 3 暗色方向的遗留。

## 3. 字体与排版

### 3.1 字族

素材 4 指定的系统字体栈，按顺序回退：

```text
-apple-system, BlinkMacSystemFont, Inter, Arial, sans-serif
```

| 用途 | 字族 | 备注 |
| --- | --- | --- |
| 全站正文与标题 | 系统字体栈（见上） | 移动端优先，天然贴合 iOS / Android 观感 |
| 简体中文 | PingFang SC / Noto Sans SC | 系统字体栈在中文环境下的实际落点 |
| 繁体与粤语用字 | PingFang HK / Noto Sans HK | 必须确认覆盖粤语特有字，见下方检查清单 |
| 计时器与 debug 面板 | 系统等宽（`ui-monospace`） | 只用于计时与 Demo 面板 |

**粤语用字覆盖检查清单**（上线前逐字目视验证）：睇、緊、咩、嘅、冇、嘢、咗、唔、係、畀、啲、佢、哋、嚟、乜、揦。任一字符回退到系统默认字形即视为字体配置有误。

### 3.2 字号阶梯（移动端）

| Token | 大小 / 行高 | 用途 |
| --- | --- | --- |
| `--text-xs` | 12 / 16 | 徽标、辅助说明 |
| `--text-sm` | 14 / 20 | 次要正文 |
| `--text-base` | 16 / 24 | 正文，输入框最小字号（避免 iOS 自动缩放） |
| `--text-lg` | 18 / 26 | 小标题 |
| `--text-xl` | 22 / 30 | 页面标题 |
| `--text-2xl` | 26 / 34 | 话题卡普通话行 |
| `--text-3xl` | 32 / 40 | 话题卡粤语行 |

## 4. 间距、圆角与描边

| 类别 | 值 | 说明 |
| --- | --- | --- |
| 间距基准 | 4px | 所有间距取 4 的倍数：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 |
| 页面左右边距 | 20px | 全站统一 |
| 卡片内边距 | 20px | 紧凑卡片用 16px |
| 卡片圆角 | 16–24px | 素材 4 指定区间：小卡 16px，大卡片 20px，身份选择卡与话题卡 24px |
| Chip 圆角 | 999px | 药丸形（Pill Shape） |
| 描边 | 1px | 选中态叠加 2px 主色描边 |
| 触控目标 | 不小于 44×44px | 含不可见热区扩展 |

## 5. 动效

素材 4 要求：动画 150–300ms、平滑 ease-out，允许 Fade、Slide、轻微 Scale / Lift，**不要 Bounce、粒子效果或 Gaming Style 动画**。

| 场景 | 时长 / 曲线 | 说明 |
| --- | --- | --- |
| 微交互（按钮反馈、开关） | 150ms ease-out | 要有回应感，不能延迟 |
| 常规转场（浮层、抽屉） | 200ms cubic-bezier(0.32, 0.72, 0, 1) | 全站统一 |
| 页面切换 | 240ms | 尽量少用，避免演示时感觉卡 |
| 话题卡切换 | 220ms ease-out | 跟手拖拽 + 松手后平滑归位，**不做回弹过冲** |
| 匹配等待呼吸 | 2.4s 循环，只改 opacity / scale | 让等待不焦虑，幅度要小 |
| 徽章解锁 | 280ms ease-out | 结算页的情绪爆点，用淡入加轻微上浮，不用弹跳 |

**`prefers-reduced-motion` 生效时：** 全部动画降级为瞬时或淡入（150ms），呼吸与循环动效停止。

## 6. 组件清单

组件名是**唯一真源**。`03-ia-and-pages.md` 引用组件时必须与本表一致，反之亦然，由 `frontend/tools/check-docs.mjs` 双向校验。

| 组件 | 文件 | 用途 | 关键 props | 覆盖状态 |
| --- | --- | --- | --- | --- |
| `AppShell` | `src/app/AppShell.tsx` | 页面外壳：宽度限制、安全区、全局背景、跨路由插槽（一次性提示 / 页面横幅 / 匹配弹窗，三者分槽） | children、notice、banner、nav、toast | 常规页、沉浸页、有匹配弹窗 |
| `TopBar` | `src/components/TopBar.tsx` | 页头：返回、标题、右侧动作 | title、onBack、action | 有返回 / 无返回 |
| `PresetAvatar` | `src/components/avatars.js` | 预设头像显示与匿名人影 | avatarId、anonymous、size | 默认、匿名、圆形裁剪 |
| `AvatarPicker` | `src/components/avatars.js` | 注册和资料选择预设头像 | value、wallet、t、initial、onChange | 免费、解锁、灰色禁用 |
| `ThemeSwitch` | `src/components/ThemeSwitch.tsx` | 配色主题切换（「我的」页配色主题卡，全站唯一入口） | value、onChange、t | 两套主题各自选中、与 /dev/mock 的开关同步 |
| `BottomNav` | `src/components/BottomNav.tsx` | 四个 Tab 导航 | active | 四个 Tab 分别选中 |
| `StepProgress` | `src/components/StepProgress.tsx` | onboarding 三段进度 | total、current | 1/3、2/3、3/3 |
| `LoadingSkeleton` | `src/components/LoadingSkeleton.tsx` | 骨架屏 | variant、rows | 卡片 / 列表 / 文本 |
| `EmptyState` | `src/components/EmptyState.tsx` | 空态 | title、description、action | 无数据 / 无搜索结果 |
| `ErrorState` | `src/components/ErrorState.tsx` | 失败态 | message、onRetry | 可重试 / 不可重试 |
| `FallbackBanner` | `src/components/FallbackBanner.tsx` | 降级提示横幅 | tone、message、action | info / warning / danger |
| `RoleSelectCard` | `src/components/RoleSelectCard.tsx` | 身份选择卡（图标 + 标题 + 副标题，无示例标签） | role、selected、onSelect | 未选、选中、禁用 |
| `TagPicker` | `src/components/TagPicker.tsx` | 标签多选 | tags、value、max、onChange | 未达上限、已达上限、空字典 |
| `LevelSelector` | `src/components/LevelSelector.tsx` | 粤语水平选择 | value、onChange | 四档切换 |
| `PrivacyToggleList` | `src/components/PrivacyToggleList.tsx` | 公开范围开关 | items、onChange | 全开、全关、逐项切换 |
| `QuestionPager` | `src/components/QuestionPager.tsx` | 资料页的分页问卷：一屏一题，滑动 / 上一项 / 下一项，进度点标出已填与当前位置；末项那颗可换成「下一步」直接收尾 | index、total、filled、counterLabel、prevLabel、nextLabel、finalLabel、onPrev、onNext、onFinal | 首项（上一项禁用）、中间项、末项（给了 onFinal 就是可点的「下一步」，没给则下一项禁用）、已填 / 未填混合 |
| `HomeActionCard` | `src/components/HomeActionCard.tsx` | 首页主 CTA 卡 | role、headline、ctaLabel、waitingCount、onStart | 学习者文案、母语者文案、等待人数为 0 |
| `StatTile` | `src/components/StatTile.tsx` | 轻量统计小块 | label、value、hint、onOpen | 有值、零值、离线值 |
| `BuddyCard` | `src/components/BuddyCard.tsx` | 匹配大厅列表行 | buddy、highlightTags、anonymous | 实名、匿名、无交集标签 |
| `BuddyBrowseList` | `src/components/BuddyBrowseList.tsx` | 等待者列表 | buddies、onPick、isLoading | 有数据、下拉刷新、空、失败 |
| `ProfilePreviewCard` | `src/components/ProfilePreviewCard.tsx` | 对方资料预览大卡 | peer、matchedTags、anonymous、reason | 实名、匿名、部分字段未公开 |
| `MatchWaitingPanel` | `src/components/MatchWaitingPanel.tsx` | 等待面板：呼吸光圈、已等时长、按什么找人的摘要与取消匹配 | elapsed、criteria、cancelLabel、onCancel；`relaxLabel` / `onRelax` 可选（当前匹配页不传 = 不渲染「放宽条件」按钮） | 等待中、超时、退出匹配；带/不带放宽入口 |
| `MatchCriteriaEditor` | `src/components/MatchCriteriaEditor.tsx` | 自定义匹配条件：「随便聊」一键全选 + 逐个勾选主题（**当前未接线**：匹配页已不再让用户选兴趣，组件保留给后续筛选需求） | options、value、onToggle、onSelectAll、onSave、onClose | 全选（随便聊）、部分选中、一个未选（保存禁用） |
| `MatchAcceptToast` | `src/components/MatchAcceptToast.tsx` | 匹配成功弹窗（右上角细条，不接管全屏） | peer、remaining、totalSeconds、onAccept、onDecline | 倒计时中、倒计时将尽（变红）、匿名、已接受、已拒绝 |
| `CallStage` | `src/components/CallStage.tsx` | 语音通话舞台 | peer、mode、audioLevel | 连接中、通话中、旁听模式、模拟模式 |
| `AudioWaveform` | `src/components/AudioWaveform.tsx` | 声波可视化 | level、active、variant | 有声、静音、连接中 |
| `RoomHeader` | `src/components/RoomHeader.tsx` | 房间顶部（含房主自动标签） | peer、elapsed、anonymous、status、hostLabel、hostIntentLabel | 实名、匿名、弱网、房主标签（母语者 / 学习者） |
| `CallControls` | `src/components/CallControls.tsx` | 通话控制条 | muted、speakerOn、onHangup、disabled | 常规、静音、无麦克风权限 |
| `TopicCard` | `src/components/TopicCard.tsx` | 单张三语话题卡 | card、level、onOpenPhrase | 三档难度 |
| `TopicCardStack` | `src/components/TopicCardStack.tsx` | 话题卡牌堆 | cards、index、onChange、onSave | 首张、末张、拖拽中 |
| `PhraseChips` | `src/components/PhraseChips.tsx` | 可复用句型提示 | phrases、savedIds、onPick、onSave | 展开、已收藏 |
| `RewardCard` | `src/components/RewardCard.tsx` | 结算卡片 | duration、cardsUsed、points、role | 学习者文案、母语者文案、零时长 |
| `SessionFeedbackSheet` | `src/components/SessionFeedbackSheet.tsx` | 反馈标签与「发出伙伴申请」 | role、options、value、onSubmit、onSkip、onConnect、requestState | 未选、已选、已跳过、申请已发出（pending）、已是伙伴（buddy） |
| `BuddyRequestList` | `src/components/BuddyRequestList.tsx` | 「我的伙伴」插槽：收到的申请 / 我发出的申请 / 已连接的伙伴 | buddies、requests、labels、onAccept、onDecline、onCancel、onRemove | 三种状态齐全、只有其中一种、全新用户空态 |
| `AchievementBadge` | `src/components/AchievementBadge.tsx` | 单枚成就徽章 | achievement、locked、onOpen | 已解锁、未解锁、新解锁 |
| `AchievementWall` | `src/components/AchievementWall.tsx` | 成就墙 | achievements、onSelect | 有成就、全新用户 |
| `LeaderboardList` | `src/components/LeaderboardList.tsx` | 排行榜列表 | entries、meId、period、role | 周榜、月榜、自己不在前列 |
| `MockControlPanel` | `src/components/MockControlPanel.tsx` | Demo 控制台 | state、onChange | 各开关状态 |

## 7. 关键组件详述

### 7.1 `RoleSelectCard` 身份选择卡

- **看到什么：** 竖排大卡，圆角 24px，白底加 `--shadow-raised`。顶部图标，中间身份名（22px 半粗），下方一句副标题。**不再有示例标签行**（去掉之后卡片更矮、也更聚焦：身份选择只回答「你是谁」）。选中后整卡描边变 `--accent` 2px，底色变 `--accent-soft`，右上角出现勾。
- **点什么：** 整卡都是可点区域；点击有 150ms 轻微缩放反馈。
- **约束：** 两张卡互斥，不允许都不选，也不允许多选。
- **验收：** 未选时主按钮禁用且卡片下方有提示；选中态在浅色背景下对比度不低于 4.5:1。
- **文案基调（2026-09-29 定稿并已落地）：** 两张卡都要读成「交换」而不是「招募」。母语者卡的副标题是 `role.buddyCardSubtitle`「也想练普通话 / English —— 交换」；卡下方一行说明是 `role.note`「说粤语的人想练普通话或 English，想学粤语的人正好一起练——对等的交换，各取所需」。原先那句防守式的「不是老师，只要愿意用粤语聊天就好」已删除：开口先否认，等于自己先把义务的帽子戴上。**禁用词：** 老师 / 教师 / 教授者，以及义工 / 志愿 / 公益 / 奉献 / 陪伴 / 帮扶——`tests/i18n.test.mjs` 有一条测试逐条扫描三语语言包，写进去就会红。
- **这一页不做二合一身份卡：** 不要在这里加「我想学的语言」字段——它属于资料页第 4 题的**可选**项；合并会改掉身份模型（`role` 是账号级的二选一），该提议已评估并被否决，理由见 [07-open-questions.md](07-open-questions.md) 第 9.3 节。

### 7.2 `TagPicker` 标签选择器

- **看到什么：** 标签药丸形流式排列，未选中为白底 + 1px `--border-strong` + 次要文字；选中为主色浅底 + 主色文字 + 主色描边。每行自动换行，文字不截断。
- **点什么：** 点选或取消；达到上限后未选中的标签降到 `--text-muted` 并禁用，同时顶部显示「最多选 5 个」。
- **状态：** 加载中显示 8 个 chip 骨架；数据为空时显示 `EmptyState`。
- **验收：** 达到上限后继续点击不产生状态变化；已选数量实时显示。

### 7.3 `MatchWaitingPanel` 匹配等待页

- **看到什么：** 直径 160px 的呼吸光圈（主色浅底，只改 opacity 与 scale），光圈内是自己的头像或匿名图标；下方是等待时长（等宽数字，秒级跳动）；再下方一行「按什么找人」的摘要（资料里的水平 + 兴趣；资料为空时这一行不渲染）；底部只剩一枚按钮「取消匹配」。`relaxLabel` / `onRelax` 不传时**不渲染**「放宽匹配条件」——匹配前不再选兴趣之后，面板里没有可改的条件了。顶部一行小字说明「匹配成功后本房间会从公共列表移除」。
- **点什么：** 「取消匹配」退出队列，同时作废还没接受的匹配请求（右上角 `MatchAcceptToast` 立刻收起），然后回首页并挂一条「已取消」提示横幅。传了 `relaxLabel` 的调用方（例如未来的筛选需求）才会多出一枚「放宽条件」按钮，点了只改条件、**不清零等待计时**。
- **样式：** 「取消」是安静按钮（`btn-quiet`：透明底 + 1px `--border-subtle` + `--text-secondary`），比次要按钮再弱一档，且字重降到 500——出口动作不该和其它按钮抢视线，也降低误触。位置固定在超时兜底块之上，兜底块出现时按钮不跳位。
- **状态：** 等待超过 8 秒出现超时兜底入口；被别人选中时由 `MatchAcceptToast` 在右上角提示，不打断当前页面。
- **计时：** 秒级刷新由页面层的 `setInterval` 直接改「已等待」那行文字（`startWaitingTicker`），不触发整页重渲染——重渲染会打断 CSS 动画。**两种身份都要启动**：母语者的默认视图是「寻找伙伴」，但「我也在等」同样有等待面板；面板不在时 tick 直接返回，不空转。
- **验收：** 等待期间页面不卡顿——动画只走 CSS transform / opacity，不触发重排；离开这一页再回来，等待时长接着走，不重新排队；取消之后不留空转定时器，页面上任何位置都不再显示「正在匹配」。

### 7.4 `TopicCardStack` 话题卡滑动组件

- **看到什么：** 一叠白卡，圆角 24px，最上面一张是当前话题卡，后面卡片露出约 12px 边缘。当前卡左上角显示 `Topic 3 of 8`，右上角是难度档位，从上到下三行：粤语（32px 半粗）、普通话（26px）、英文（16px 次要色）。卡片下方独立一行 `PhraseChips`。
- **点什么：** 左右跟手拖拽；拖过 35% 宽度或甩出速度超过阈值即切换，未过阈值时**平滑归位**（220ms ease-out，不回弹过冲）。同时支持左右方向键与辅助开关（无障碍）。
- **状态：** 第一张时左侧不能再退（`‹` 置灰、归位）；最后一张时 `›` 置灰，并在牌堆下方出现两颗按钮——**「再来八张」**（`btn-primary`，换一整叠新的）与**「聊完，去结算」**（`btn-secondary`）。看过的卡挂一枚「聊过了」，牌堆进度条读的是**真正看过几张**（跨叠累计），不是当前序号。
- **验收：** 跟手感必须顺——这是整个 demo 中最容易被感知的交互质量点。

### 7.5 语音通话室（`CallStage` + `AudioWaveform` + `RoomHeader` + `CallControls`）

- **看到什么：** 浅灰舞台（`--bg-sunken`）铺满上半屏，正中是对方头像或匿名图标（直径 96px），下方是 `AudioWaveform` 声波，随对方音量起伏。顶部 `RoomHeader`：对方昵称或「匿名伙伴」、通话计时、匿名徽标、连接状态点，以及一枚**房主自动标签**（`pill` 的 `tone-accent`）——按房间模式**派生**（与「我的」里的身份同源）：母语者房主显示「房主 · 教粤语」、学习者房主显示「房主 · 学粤语」。它进房即带上、不落库、房间里不给切换开关；`hostLabel` / `hostIntentLabel` 只给一半时整枚徽标不渲染。底部 `CallControls` 三个按钮等距分布：麦克风、扬声器 / 听筒、挂断；挂断按钮最大且为实心 `--danger`。**没有摄像头按钮。**
- **点什么：** 点麦克风切换静音；点扬声器切换外放 / 听筒；点对方头像展开对方公开资料；点挂断进入结算。
- **状态：** 连接中显示双方头像与「正在建立连接」，超过 8 秒转降级提示；麦克风不可用时进旁听模式，`AudioWaveform` 只显示对方声波，控制条除挂断外置灰并附说明。
- **验收：** 所有降级路径下控制条布局不跳变；静音状态不能只靠颜色表达，必须带斜杠图标。

### 7.6 首页（`HomeActionCard` + `StatTile`）

- **看到什么：** `HomeActionCard` 是一张 24px 圆角的大白卡：一句问句（学习者「Ready to practise Cantonese?」，母语者「有人正在等一位粤语伙伴」）、一个主色实心大按钮，母语者卡在按钮下方多一行「现在有 N 人正在等」。`StatTile` 是一行 2×2 或 1×4 的小白卡，每块一个数值加一行标签。
- **点什么：** 点主按钮进入 `/match`；`StatTile` 只展示数据，不伪装成可点击按钮，页面跳转统一交给底部导航。
- **状态：** 卡片文案不依赖数据，永远先渲染；`StatTile` 数据未到时显示骨架；离线值在角落标注「离线数据」。
- **验收：** 一屏之内能同时看到主 CTA 与统计块，不出现需要滚动才能看到主按钮的情况。

### 7.7 对方资料预览（`ProfilePreviewCard`）

- **看到什么：** 一张大白卡：大号匿名图标或首字母图标、标题（User ID 或「匿名伙伴」）、母语与粤语水平一行、身份标签、兴趣标签（与我重合的用 `--accent-soft` 底高亮）、匹配度百分比，以及两三条「为什么会匹配」的理由。底部固定主按钮「Start Conversation」与次按钮「返回列表」。
- **点什么：** 点兴趣标签展开一张相关话题卡预览；点主按钮成房并进入房间；点次按钮返回列表并保持滚动位置。
- **状态：** 加载中显示骨架且主按钮禁用；对方已被别人挑走时整页替换为 `EmptyState`。
- **验收：** 对方未公开的字段**不得渲染占位文案暴露其存在**，只显示「对方没有公开这一项」。

### 7.8 成就与排行榜（`AchievementBadge` + `AchievementWall` + `LeaderboardList`）

- **看到什么：** 徽章是 88×88 的圆角 20px 卡片，主色描边，图标在上、名称在下；未解锁时整体降到 40% 不透明度并加锁图标，点击显示解锁条件。排行榜每行 56px 高，前三名的名次标记用主色浅底。
- **点什么：** 点徽章展开成就说明；点榜单行查看对方公开资料（匿名者不可点）。
- **状态：** 新用户成就墙全部灰显并给出一句引导；榜单为空时显示 `EmptyState`。
- **验收：** 关闭「排行榜可见性」的用户在榜上显示为「匿名伙伴」且不泄露任何标签；榜单标题不出现「教师」字样（学习者榜 / Buddy 榜）。

### 7.9 结算与反馈（`RewardCard` + `SessionFeedbackSheet`）

- **看到什么：** `RewardCard` 顶部一句「Great conversation.」，中间大号时长（例如 18 min），下方一行「+120 XP」，再下方是本次聊过的话题标签与本次解锁的 `AchievementBadge`。紧接着 `SessionFeedbackSheet` 从底部滑入：一行可多选的反馈标签，右下角「Skip」；选完或跳过后，浮层换成一句「Would you like to connect again?」，两个按钮「发出伙伴申请」与「暂时不要」。
- **点什么：** 点标签切换选中；点「Skip」跳过反馈；点「发出伙伴申请」→ 只写入一条待确认的申请，按钮收起并换成「伙伴申请已发出，等 ta 确认」；点「暂时不要」直接回个人主页。
- **状态：** 时长过短（例如立刻挂断）时不发徽章，只显示一句「下次聊久一点就能点亮新成就」；结算接口失败时用本地估算值渲染并挂 `FallbackBanner`；`requestState` 为 `pending` / `buddy` 时都不再渲染两个按钮。
- **验收：** 反馈流程最多两步、可全程 Skip，且**不能阻塞**「回个人主页」这条出路；任何情况下都**不允许**出现「点一下就单方面成为伙伴」。

### 7.10 「我的伙伴」插槽（`BuddyRequestList`）

- **看到什么：** 个人主页里的一张普通卡片，标题「我的伙伴」。下面按状态分三组，每组一行：
  - 收到的申请 → 圆形头像 + 名字 + 灰字「待你确认」 + 两个按钮 `接受`（主色实心）/ `拒绝`（次要描边）。
  - 我发出的申请 → 名字 + 「等待对方确认」 + `撤回申请`。
  - 已连接的伙伴 → 名字 + 「互相确认的伙伴」 + `解除伙伴`。
- **点什么：** 按钮即动作，点完立刻调接口再整页重取，行会在分组之间移动（收到的申请 → 已连接的伙伴）。
- **状态：** 三个分组都为空时只显示一句可执行引导「还没有伙伴——聊完一场，发出第一份伙伴申请吧」，不显示空分组标题；只有伙伴列表失败时才在插槽内部显示 `ErrorState` + 重试，页面其余部分照常可用。
- **约束：** 名字超过一行时省略号截断，按钮永远不换行（`flex: none`），最窄 320px 宽下三个元素仍要一行放得下。
- **验收：** 「发出申请」与「成为伙伴」必须是两个不同的状态，插槽里任何一行都不会出现「已保存」这种单方面说法的文案。

### 7.11 `MatchAcceptToast` 匹配成功弹窗（右上角细条）

- **看到什么：** 贴在视口右上角的一条窄弹窗（宽 `min(360px, 100vw - 20px)`，右留 12px、上方 `72px` 让开 TopBar；390px 屏上实测 360×111），圆角 20px，白底加 `--shadow-raised`。第一行：32px 圆头像（匿名时灰底「?」）+ 标题「匹配到伙伴啦」与伙伴名字上下两行 + 右侧等宽字体的倒计时数字；第二行右对齐两个按钮：`接受`（主色实心）/ `不接受`（白底描边）。弹窗顶部有一条 3px 进度条，按总时长匀速缩短。**「超时会回到等待队列」这类解释文案不上屏**（细条要矮），改挂在 `aria-label` 上给读屏用。
- **点什么：** 点「接受」→ 立刻进房 `/room/:roomId`；点「不接受」→ 弹窗收起，人留在等待队列，等待时长不清零。
- **状态：**
  - 倒计时中：进度条匀速缩短，数字每秒跳一次。秒数变化只改那一个数字节点，不重建 DOM——否则进度条动画每秒都会被重置。
  - 只剩 3 秒：整条弹窗加 `is-urgent`，进度条与数字变 `--danger` 红。
  - 到点没做选择：等同于「不接受」，回到等待队列（默认值，待后端确认，见 07 的 Q-G12）。
  - 匿名：头像显示「?」，名字显示「匿名伙伴」，其余信息一律不下发。
- **约束：** 不接管全屏、不盖住 TopBar（标题与返回仍然可点）与底部导航。插槽整体 `pointer-events: none`、弹窗本体 `pointer-events: auto`——用户必须能继续操作当前页面。
- **验收：** 在任何路由（含 `/home`、`/leaderboard`、`/me`）都能弹出；同一时刻最多只有一条；点完按钮弹窗必须立刻消失，不留残影。

### 7.12 `MatchCriteriaEditor` 自定义匹配条件（当前未接线）

> **状态：** 2026-09-29 起匹配页不再让用户勾选兴趣（闸门简化成一张只有「开始匹配」的开始卡片，等待面板也不再提供「放宽匹配条件」）。这个组件**保留但没有任何地方在用**：`settings.matchCriteria` 与 `PUT /api/match/criteria` 也还在，留给后续的筛选需求。要彻底删掉它可以另开一次清理（同时删字段、接口、词表与文案）。

- **看到什么：** 就地展开的一张白卡（不弹浮层、不遮住任何东西，也不会打断页面上的其他内容）。从上到下：标题 → 一句说明 → 整行的「随便聊」按钮（虚线描边；全部勾上时变成实线 + 主色浅底）→ 13 个主题标签药丸（复用 `TagPicker` 的流式排列）→ 右对齐的「已选 3 / 13」→ 底部的行动按钮。
- **什么时候出现：** **当前没有任何入口**——2026-09-29 起匹配页不再让用户勾选兴趣，等待面板也不再提供「放宽匹配条件」。下面这些形态与交互描述是**组件自身的能力规格**，留给后续的筛选需求复用（历史上曾挂在「排队前闸门」与「放宽匹配条件」两个入口上，均已下线）。
- **点什么：**
  - 点「随便聊」→ **一键把全部主题勾上**（13 个标签同时高亮），这是「不挑主题、什么都聊」的快捷方式。
  - 点任意主题标签 → 加上 / 去掉一个；手动把最后一个也勾上，效果与「随便聊」完全一致（判定用 `coversAllOptions`，不看用户是怎么勾的）。
  - 点「保存」→ 写进 `settings.matchCriteria`（会持久化，刷新之后还在）并收起；等待面板的条件摘要立刻改成「已选条件」或「随便聊」。
  - 点「收起」→ 丢弃草稿、恢复原条件，不改任何状态（不传 `closeLabel` 时不渲染这个按钮，底部只剩「保存」一个出路）。
- **状态：** 一个都没选时主按钮禁用并给出一句「一个都不选就没法按主题找人，点『随便聊』表示都行」——「没选」和「都行」是两件事，不能含糊。
- **与资料的关系：** 打开时用「当前有效条件」预勾：自定义过就用自定义的，没自定义过就用资料里的兴趣。所以在原条件上放宽是勾掉几个，而不是从空白开始。
- **约束：** 改条件**不清零等待计时**——「已经等了多久」记录的是人等过多久，不该因为改了口味就假装回到起点。真实实现里保存后要让服务端重新评估排队（前端只管把偏好送上去）。

### 7.13 `ThemeSwitch` 配色主题切换

- **放在哪：** 只在 `/me` 的「配色主题」卡里，**全站唯一入口**。页头刻意不放（页头仅保留返回箭头与标题，再加内容会挤标题、顶出横向滚动），会话房间是沉浸页也没有入口——需要演示不同配色，进门前先切好。
- **看到什么：** 两张药丸并排，每张左边一个 12px 色点（该主题的主色），右边是主题全名「薄荷绿」「暖橙」，36px 高，一行放不下就换行、不做横向滚动。
- **点什么：** 点另一个主题 → 立刻换色（改 `<html data-theme>`），同时选中项反白。点当前已选中的那一张不做任何事（不重复写 store）。
- **状态：** 只有「选中 / 未选中」两种，选中态复用 `.pill.is-selected`（主色浅底 + 主色描边 + 半粗字）并带 `aria-pressed`。**色点不是唯一线索**——旁边始终有文字，满足第 8 节「状态不能只靠颜色表达」。
- **为什么点完不等重渲染：** 配色是纯 CSS 变量，换颜色不该让任何页面重新 `load()` 取数。所以组件在点击后**自己把两张药丸的选中态刷上去**，主题变化只交给 store（store 的通知再去同步 `<html data-theme>`）；`app.js` 也只在界面语言变化时才重建页面。这样切主题不掉数据、不闪骨架。
- **唯一入口 + 一个救场口：** 用户界面里只有 `/me` 一处；`/dev/mock` 的「配色主题」开关走的是同一套 store 动作，用来在不离开当前页的情况下换色（演示救场）。两边共用一组文案 key（`theme.<id>`），不会出现「一处切了、另一处没跟上」。
- **验收：** `/me` 与 `/dev/mock` 任一处切换后，另一处下次出现时选中态一致；刷新后保持；切换过程中没有横向溢出，也不出现骨架屏闪烁。

### 7.14 `QuestionPager` 问卷分页器（资料页一屏一题）

- **放在哪：** 只在 `/onboarding/profile`（资料与标签）。填资料是 onboarding 里最长的一步——学习者 5 题、母语者 4 题，平铺在手机上是一面「标签墙」；一屏一题把注意力和进度都收拢到当前这道题。
- **看到什么：** 顶部一行进度——左边是与题目等宽的进度点（**已填＝实心灰、当前＝主色、未到＝半透明**），右边一句「第 2 / 5 项 · 已填 3 项」；中间是当前这道题的标题与控件（`TagPicker` / `LevelSelector`），装在白卡里；底部两颗等宽按钮「上一项 / 下一项」——**走到末项时右边那颗换成可点的「下一步」**，点它保存已填部分并进入资料可见范围页；再往下右下角是一颗**小号安静按钮「暂时跳过」**（`.btn-quiet .btn-sm`，靠右）——它刻意不做成主按钮：资料不是必填关卡，不该用视觉重量催用户填完。
- **点什么：**
  - 在题目卡片上**左右滑动** → 下一项 / 上一项（阈值 56px，与 `TopicCardStack` 共用 `src/lib/swipe.js`；卡片用 `touch-action: pan-y`，竖直滚动照常）。
  - 点「上一项 / 下一项」→ 同上；首项的「上一项」置灰禁用。末项那颗按钮换成「下一步」——**它是问卷走到头之后的正常出口，不再置灰**（原因见下面「约束」）。
  - 点「下一步」或「暂时跳过」→ 保存**当前已填的部分**并进入资料可见范围页。两颗按钮做的是同一件事，差别只在位置与视觉重量：前者是走到头之后的自然出口，后者是任何一题都能用的逃生口；没填的部分之后可以回「我的 → 编辑资料」补。
- **状态：** 已填 / 未填只体现在进度点上，不做拦截；兴趣一个都没选时，兴趣那一题会显示「至少选 1 个兴趣」，「下一步」与「暂时跳过」照旧可用（与 03 第 5.3 节一致）。
- **约束：** 滑动**不做自动提交**（收尾只能按按钮，避免误触）；换题不丢已填内容——草稿一直在页面的 `view.local.form` 里，点了「下一步」或「暂时跳过」才落库。
- **验收：** 390px 窄屏上单题不出现横向滚动；连续划到最后一题再划回来，之前的选择全部还在；末项那颗按钮可点且写着「下一步」，点它（或点「暂时跳过」）都能进资料可见范围页，资料里每一项都与刚才填的一致。

### 7.15 匹配度与「语言互补」徽标（`BuddyCard` / `ProfilePreviewCard`）

- **看到什么：** 列表行与大卡右上角沿用现有那枚匹配度徽标（`matchScore` 百分比，主色浅底）。**母语者视角**下，若这一位与自己填的「想练语言」互补（对方母语 = 我想练的语言），徽标旁边多一枚**语言互补**小徽标：`--accent-soft` 底、`--accent` 字、14px、前置一个双向箭头图标；预览大卡上另加一行正文，例如「TA 也想练普通话」。
- **为什么必须有：** 排序权重是隐形的。没有徽标，互补把人往上排这件事在台上完全看不出来，机制等于白做。
- **约束：** 只出现在母语者视角。学习者的「想练语言」恒为粤语，互补恒成立——给每个人都加一枚徽标等于加了一个没有信息量的标签。
- **验收：** 徽标不换行、不挤压匹配度百分比；375px 窄屏下两枚徽标同排不溢出。

## 8. 无障碍与触控底线

| 项 | 要求 |
| --- | --- |
| 对比度 | 正文与背景不低于 4.5:1，大字号不低于 3:1 |
| 触控目标 | 不小于 44×44px |
| 输入框字号 | 不小于 16px，避免 iOS 聚焦时自动缩放 |
| 动效 | 尊重 `prefers-reduced-motion` |
| 颜色 | 状态不能只靠颜色表达，必须配图标或文字 |
| 焦点 | 键盘可达，浮层打开时焦点锁定 |

## 9. 文案词表（与素材 4 对齐）

正式界面一律使用「粤语伙伴 / Cantonese Buddy」，**不出现「老师 / 教师 / 教授者」**，也不出现「义工 / 志愿 / 公益 / 奉献 / 陪伴 / 帮扶」——双方是平等交换，不是单方面帮忙（2026-09-29 定稿，见 [07-open-questions.md](07-open-questions.md) 第 9.4 节）。

| 词表 | 取值 |
| --- | --- |
| 身份 | University Student、Exchange Student、Working Professional、New to Hong Kong |
| 母语 | 普通话、English、Other |
| 界面语言 | 简体中文、繁體中文、English |
| 粤语水平 | Beginner、Elementary、Intermediate、Advanced |
| 学习目标 | Daily Conversation、Make Local Friends、University Life、Workplace Cantonese、Hong Kong Culture |
| 教 / 学标签 | Teach Cantonese、Learn Cantonese（**由身份派生**：粤语母语者 = 教、粤语学习者 = 学；不可自选） |
| 兴趣 | Movies、Anime、Gaming、Music、Food、Travel、Hiking、Basketball、Football、Badminton、Photography、Technology、Hong Kong Culture |
| 母语者可聊话题 | Hong Kong Food、Movies、Gaming、University Life、Travel、Local Culture、Sports |
| 母语者可选的「想练的语言」 | 普通话、English、Other（**取值复用「母语」词表，不含粤语**）；默认空，不填也能完成资料 |
| 话题卡主题 | Anime、Food、University、Travel、Movies、Sports、Hong Kong Culture、Daily Life、Gaming、Music、Hiking、Basketball、Football、Badminton、Photography、Technology、Weather、Work、Shopping、Festivals |
| 学习者成就 | First Conversation、Cantonese Explorer、7-Day Streak、Culture Explorer |
| 母语者成就 | First Buddy Session、Helpful Local、Culture Ambassador、Conversation Hero |
| 学习者反馈标签 | Friendly、Patient、Easy to Understand、Helpful |
| 母语者反馈标签 | Active Learner、Friendly、Willing to Speak Cantonese、Great Conversation |

**头像约定：** 本 demo **不做头像系统**，不使用上传与编辑；一律用统一的抽象默认图标或首字母图标。

商城主题预览使用独立 `[data-preview-theme]` 容器，与真实主题共享同一套 CSS Token。容器先重置默认颜色，再覆盖选定主题，避免继承当前使用的主题。预览为只读示例首页，不写 settings.theme、不扣积分或解锁主题。头像与配饰专栏支持真实兑换和主动应用。

宽度达到 900px 后自动使用电脑布局：延续系统字体、大留白、圆角卡片、轻边框和主题色，在 1180px 内容框内根据页面安排双列或四列统计卡，表单限制在 680px 以保证阅读长度。窄于 900px 自动使用手机布局，不提供也不保存手动显示模式。

人物头像统一为温暖的日常插画，奶油色、柔和绿色为主。初始三款免费：灰色无脸默认人影、两款穿奶油白上衣的基础人物；基础男性使用白色背景，初始选项不显示免费字样。商城提供四款不同发型、服装和背景的人物，包括原绿背景男性头像；不显示商品名称，描述保留在无障碍标签中。原头像框入口改为“配饰”，提供奶茶、菠萝包、叮叮车三款 SVG 小徽章，每次佩戴一枚，位于头像右下角，约占直径四分之一，可选择“无配饰”。使用当前头像预览，兑换只解锁，不自动佩戴。匿名隐藏个性头像和徽章。旧头像框记录保留但不再渲染。存储和接口沿用 frameId/ownedFrames，AvatarPicker 的 kind=frame 对应徽章选择。

手机个人主页采用头像＋姓名两列布局，身份标签放在姓名下方。姓名 20px、身份说明 13px、身份标签 12px，统计数字 24px、统计说明 13px。姓名支持自然换行；个人页使用本地化简短身份名称，避免中英双语在窄屏重复挤占空间。桌面保留横向排布。

品牌入场：使用正式 CB 桥梁 logo.png，浅绿柔光背景与低幅度上浮，1.1 秒清晰显现、2.2 秒开始淡出、2.65 秒释放页面。跳过与 Escape 立即释放焦点和滚动，减少动态效果时直接显示页面。仅本站浏览器首次播放，调试可用 ?intro=preview。

聊天室使用动态视口高度，话题卡伸展填充剩余空间，头像为 44px 横向状态区，建议句型自适应列数。通话控制始终占底部一行，极长内容在卡片或建议区域内阅读。用户主动翻卡播放 130ms 低音量滤波摩擦声，可关闭；远端同步与越界不播放，退出销毁 AudioContext。

底部导航：一个共享的圆角选中滑块，以 420ms ease-out 位移动画在四个选项间滑动。导航 DOM 跨路由复用，当前页面有 aria-current 标注，色彩跟随主题，减少动态效果时关闭过渡。

通话“声音开/关”控制远端 audio 元素的 muted，不影响自己的麦克风，音轨晚到或替换时保留选择；重新开启尝试恢复播放。结算评价与伙伴申请独立显示提交中、成功和失败，失败保留选择并可重试；提交中禁止重复提交及通过结算操作离开页面。评价未选择标签时不可提交，成功后禁止重复保存。

首页无推荐时使用紧凑提示，不重复主匹配按钮；桌面主卡片展开整行，避免空白大卡。首次聊天前显示轻量开场引导，已有聊天后显示统计。点推荐伙伴进入房间时禁止重复操作。

我的页将编辑资料入口放在身份卡旁，语言、匿名、主题和隐私操作归入默认收起的设置区；账号操作另行收起，商城保留醒目入口。点击自己的头像展开独立外观面板，预览头像和徽章后保存；取消不写入，保存只提交 avatarId/frameId，失败保留草稿可重试，两身份同步，不重新走注册问卷。

匹配等待说明后台继续；其它主页面显示可点击的匹配状态入口，取消或进房后立即移除。等待一分钟后提供继续等待或稍后再来的提示，不虚构预计等待时间或在线人数。取消失败说明仍在队列，并保留重试按钮。

聊天室只保留卡片顶部位置与看过进度，不在翻页按钮间重复位置；已聊话题默认折叠，翻卡音效归入卡片设置。第一张提供可关闭的开场引导，关闭后本次房间不再出现。麦克风和播放受限警告仍保留。

商城头像和徽章在手机、电脑均以双列展示，点击图片直接预览；免费商品一步解锁，非零价格商品仍需确认，可取消而不扣款。解锁不会自动应用，成功后明确提示点击使用；请求进行中禁止重复操作，失败可重试，应用后提供状态反馈。

辅助文字提高对比度，五种主题在页面底色、卡片底色上的辅助文字与主按钮文字保持至少 4.5:1。聊天室提示、进度和控制说明调整为 13px。卡片与主按钮减轻阴影，统计和折叠设置不使用阴影，保留原有品牌配色。


### 2026-10-13 对话视觉与自适应更新

- 首页使用主题色对话气泡与本地 SVG 电车图形，支持简体、繁体、英文；装饰不依赖外部图片请求。
- 通用图标使用本地 SVG 路径、统一 24×24 viewBox 与 currentColor，五种主题共享同一套图形。
- 首页主操作用主题浅色大区域，伙伴保留卡片，统计与历史采用轻量分区。
- 话题卡保留粤拼在原文之前的阅读顺序，通过粤语大字、拼音与翻译字号区分层级。通话控制使用明确图形和文字。
- 按钮以最小高度约束，长文本可增高；手机窄屏、平板、桌面分别调整布局，不给标题设禁止换行。
- 挂断按钮：浅色主题深红配白字，夜间主题浅红配深色字；五种主题的主要按钮与挂断按钮对比度均达到 4.5:1。
- 真机横竖屏、系统字体放大与实际浏览器视觉验收由用户操作后确认。

# 公网部署交接 · 2026-10-13

## 最新进展 · 用户自行操作浏览器

2026-10-13 语音调试：用户已通过邀请入口，并报告两台设备听不到声音、连接不稳定。代码中复现并修复授权期间丢失 SDP / ICE、ICE 早于远端描述到达、无 streams 音轨丢失播放等问题。真实通话禁用模拟兜底和演示房间，增加 ICE 重连与不含密钥的「通话检查」。此改动必须在 Render 手动部署后再用两台设备复测。用户尚未提供设备系统、浏览器及网络组合；不能宣称实际媒体链路已恢复。

本轮属于 making it better：改善已经部署的真实通话。最终回归结果：后端 193、前端 582、根目录 38，共 813 项全部通过；文档与接口检查通过。移动浏览器的手势解锁也已覆盖异步上下文恢复场景。新增检查不收集或输出密码、密钥、SDP、IP 地址。

固定访问地址由用户截图确认：[CantoBridge](https://cantobridge.onrender.com)。本轮不得操作浏览器，部署与检查步骤由用户执行。复测时双方允许麦克风、确认声音开关打开，打开「通话检查」并刷新，比较 signalState / turnServers / remoteTracks / connectionState / bytesSent / bytesReceived / audioBlocked。出现问题时只接收这份安全报告或脱敏日志，不索取 TURN 密码、Supabase key 或邀请码。

- 用户已报告 Supabase 初始化 SQL 执行成功，并找到 Project URL 和服务端 Secret key；尚未由运行中的后端验证实际连接。
- Cloudflare 要求绑定付款方式，用户拒绝，本次不再使用。
- Metered 的 20 GB 免费档位也要求绑卡。用户选择可免绑卡开通的 500 MB Free Trial Global，并报告已找到 Username / Password。还需从 Show ICE Servers Array 取得实际 TURN 地址。
- 默认部署已改为 Metered 静态凭证，使用 `CANTOBRIDGE_TURN_PROVIDER=static` 与 URL / Username / Credential 三个变量。API Key 不需要；Supabase 密钥和 TURN 密码由用户直接填入 Render，不经过聊天。
- 下一步从 Render 连接仓库和配置环境变量继续。以下旧的 Cloudflare 待办已作废。
- 改用 Metered 后回归结果：后端 193、前端 582、根目录 28，共 803 项全部通过；文档与接口检查通过。仍未部署或验证真实中继通话。

## 目标与进度判断

本轮属于 **making it exist**：建立一个不依赖本机开机的免费公网内测版本。现有产品功能的权限与凭证改进属于 making it better。

目标：电脑关机后评委仍能打开固定 HTTPS 链接，并供少量受邀用户内测。全部使用免费方案，不买域名、不升级套餐、不授权付费。用户要求自己操作浏览器登录和平台连接；本轮暂停云平台操作，下一次继续。

## 已完成

- 根目录 README、启动与测试命令、Render Free 单服务配置 `render.yaml`。
- 单进程启动：公网页面入口与私有本机接口服务，同源代理 REST / WebSocket，平台负责 HTTPS。
- Supabase 快照适配与初始化 SQL；RLS / grants 禁止浏览器角色读取或修改。
- 串行请求、数据库 revision 比较保存、保存成功后回包与广播；失败时回滚内存并停写。
- 云服务重启保留账号、资料、积分、伙伴关系与历史，清理旧排队和进行中房间。
- Cloudflare TURN 临时凭证签发与账号缓存，长期 token 不进入浏览器。
- 全站邀请口令、签名 HttpOnly / Secure cookie、账号上限、请求和信令连接限制。
- 房间资料、话题卡及信令增加参与者检查；原结算和反馈检查保留。
- 新设备密钥和会话令牌改为密码学随机值，旧本地存档保持兼容；公网不接受旧短设备 ID。
- 公网仅分发运行资源，隐藏工具、测试、文档、依赖、环境配置与证书。
- 实际 PostgreSQL 测试验证 SQL 可重复执行、权限隔离及冲突更新；部署入口测试覆盖权限、信令、重启恢复与保存失败。

## 尚未完成，不能宣称已上线

- [ ] 用户确认 Render、Supabase、Cloudflare 已登录。最后看到 Render 控制台已登录；Supabase 有 Free 组织但尚未建立本项目数据库；Cloudflare 登录尚未确认。
- [ ] 用户在 Supabase 新建专属 CantoBridge Free 项目（建议靠近香港的区域），自行设置数据库密码；不复用其它项目用户数据。
- [ ] 在该项目 SQL Editor 执行 `deploy/supabase.sql`，确认表与函数创建成功，并检查 anon / authenticated 无权限。
- [ ] 获取 Supabase 项目 URL 与服务端 secret key，只填入 Render Environment；不要发在聊天或提交仓库。
- [ ] 用户在 Cloudflare Realtime TURN 创建 key，确认免费使用和超额费用边界；保存 key ID 与 API token 到 Render。
- [ ] 用户连接 Render 到 GitHub 仓库，使用 Blueprint 或手动创建 **一个 Free Web Service**，关闭自动部署。
- [ ] 核对所有环境变量，完成首次部署，记录实际固定 HTTPS 地址与邀请口令。当前没有可交付的公网 URL。
- [ ] 使用实际 Supabase / Cloudflare 服务验证保存和凭证签发；目前自动测试使用本地 PostgreSQL及模拟远端响应，不能替代云端验收。
- [ ] 两个不同设备注册、匹配、真正听到对方声音、同步翻卡并结算；一台 Wi-Fi、一台手机流量。
- [ ] 数据保存后在空闲时重启 / 重新部署，确认资料与历史恢复。
- [ ] 关闭本机服务及电脑，另一台设备仍能通过公网地址访问与通话。
- [ ] 闲置后再次访问，确认免费冷启动能恢复；评审前确认 Supabase 未暂停。
- [ ] 用户自行决定是否将 GitHub 仓库改为 Public、选择项目 LICENSE、补赛事提交材料。本轮不更改仓库可见性。

## 下次按这个顺序继续

1. Supabase 项目和初始化 SQL。
2. Cloudflare TURN key，确认没有付费承诺。
3. Render 连接仓库与环境配置，首次部署。
4. 云端数据、跨网络语音及关机后访问验收。

详细填写说明见 [README.md](README.md)。账户登录、授权、创建密码及密钥配置由用户在浏览器自行完成。

## 约束与已知边界

- Render 闲置会休眠，首次访问可能等待约一分钟；免费额度耗尽或供应商故障会影响服务。
- Supabase 低活跃项目可能暂停，需在后台恢复；应定期自行导出备份。
- Cloudflare 1,000 GB/月免费额度不等于硬性费用上限，不绑定付费或接受升级前须核对实际账户设置；邀请保护不能保证绝对不超额。
- 数据快照适配仅支持小规模单实例，不要让第二个服务或预览环境共用同一份快照。
- 重启会中断正在进行的通话和排队；已保存历史与进度保留。
- 登录仍依赖设备密钥，尚无正式邮箱认证、跨设备找回。清浏览器数据会丢失账号访问入口。
- 自动测试通过不能证明真实设备麦克风和跨网络媒体链路已经通过。

## 本轮验证

在仓库根目录运行 `npm test` 与 `npm run check`。根目录测试需要先 `npm ci` 安装仅用于测试的 PGlite；后端依赖使用 `npm ci --prefix backend`。部署构建只安装后端依赖，不安装测试数据库运行库。

本轮最终结果：后端 193 / 193、前端 582 / 582、根目录云部署与公开检查 26 / 26，共 801 项全部通过，无跳过或取消。`npm run check` 和 `git diff --check` 通过。尚未执行真实云账户和真机媒体验收。


## 2026-10-13 苹果设备布局与检查刷新（making it better）

- 通话房间改为可滚动的弹性布局，修复检查面板占用额外一行后卡片被压缩的问题；长卡片文字从顶部可达，窄屏标题与按钮允许换行。
- 检查报告只更新自己的区域，不重绘通话与卡片；等待期间禁用重复刷新，页面正常重绘后也恢复当前按钮。
- WebRTC getStats 最多等待两秒；超时或拒绝返回 statsUnavailable，保留基本通话状态，不输出原始错误或凭证。
- 验证：后端 193、前端 582、根目录 40，共 815 项全部通过；npm run check 与 git diff --check 通过。
- 需要用户在 Render 手动部署最新提交后，在苹果设备检查长卡片、展开报告、连续刷新及横竖屏；本轮未操作用户浏览器或完成苹果真机验收。


## 2026-10-13 取消网站入口口令（making it better）

- 默认直接进入首页；已有 CANTOBRIDGE_INVITE_CODE 环境变量不会再次开启口令页，无需用户删除旧变量。
- 可选的邀请保护仅在 CANTOBRIDGE_INVITE_REQUIRED=true 时启用；Blueprint 默认 false。
- 保留账号、房间成员、来源限制、流量限制与 50 账号上限；测试验证无邀请 cookie 的真实 HTTP 与 WebSocket 路径。
- 全量测试后端 193、前端 582、根目录 42，共 817 项全部通过，无跳过；npm run check 和 git diff --check 通过。
- 待用户在 Render 手动部署最新提交，再用无痕窗口确认打开链接后直接进入首页。

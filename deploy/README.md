# 免费公网内测部署

## 1. Supabase：初始化数据存储

在你的 Supabase Free 组织中创建一个专用于 CantoBridge 的项目，优先选择靠近香港的区域。不要将其它项目的真实用户数据迁入本项目。

在该项目 SQL Editor 运行 [supabase.sql](supabase.sql)。它创建独立的 `cantobridge_snapshots` 表与保存函数，启用 RLS，并禁止 `anon` / `authenticated` / PUBLIC 访问；只有后端 service_role 可以读写。不修改已有业务表。

从项目 Connect / API 设置取得项目 URL 和服务端 secret key（`sb_secret_...`；也兼容旧 service_role JWT）。不要使用 publishable / anon key，也不要把服务端 key 放进前端、GitHub 或聊天记录。

小规模内测沿用现有数据结构，以单行 JSONB 快照持久化。每个成功写请求必须先保存到数据库再返回成功和广播信令；使用 SQL 中的 revision 比较更新，避免两个进程互相覆盖。这不是多实例数据库架构，只允许一个服务实例、一个部署环境使用这份快照。不要给同一数据库创建第二个 Render 服务或预览环境。

数据库读取失败或数据结构损坏时启动失败，不自动清空数据。保存失败、超时或版本冲突时停止业务写入、健康检查变为 503，须修复连接后重启。请求可能已在远端保存但响应丢失；恢复后先核对数据。启动会清理旧队列和未完成房间；已结束房间及用户历史保留。

## 2. Metered：无需绑卡的 TURN 配置

用户实际开通的是 Metered Free Trial Global 500 MB 档位，无需绑卡。20 GB 档位和 Cloudflare Realtime 在本账户开通流程均要求付款方式，所以本方案不使用它们。500 MB 仅作为演示和初步通话验证额度，持续内测须观察实际剩余流量，不能保证长期够用；以 Dashboard 的实际套餐与重置规则为准。

在 Metered TURN Server 页面创建 Credential，并打开 Instructions / Show ICE Servers Array。复制所有以 `turn:` / `turns:` 开头的 `urls`，以逗号拼成一个环境变量；不包含 `stun:`，后端另有默认 STUN 配置。将 `username` 和 `credential`（Password）分别填入下面的用户名和密码变量。使用 Dashboard 给出的实际服务器地址，不照抄文档示例，不把 JSON 对象或引号填入 URL 变量。不需要 Show API Key，也不需要 Developers 的账户级 Secret key。

凭证仅从 Render 环境变量读取，经邀请保护和账号鉴权后下发给浏览器。此档位使用共享静态 TURN 凭证；响应 `expiresAt` 是客户端缓存期限，不是静态密码自动到期时间。不要将凭证提交仓库；受邀用户在浏览器可以读取使用通话所必需的 TURN 凭证，内测后在 Metered 撤销或轮换它们。邀请码和限流不能绝对防止凭证被复制。达到免费额度可能中断中继，需要检查余额；不能用模拟动画替代真实通话验收。

Cloudflare 临时签发代码保留为可选适配，但默认 Blueprint 不使用它。不要在本次部署填写 Cloudflare key 或开通付费。

## 3. Render：部署一个免费服务

连接 GitHub 的 `SocialPhobia-Hack4SDG/CantoBridge`，选择 Blueprint 使用根目录 `render.yaml`。

也可以手动创建 Web Service：

| 设置 | 值 |
| --- | --- |
| Runtime | Node |
| Root Directory | 留空（仓库根目录） |
| Region | Singapore |
| Instance Type | Free |
| Build Command | `npm ci --prefix backend` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Auto Deploy | 关闭；避免内测通话时自动重启 |

环境变量：

| 名称 | 来源 |
| --- | --- |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SECRET_KEY` | Supabase 服务端 secret key / service_role |
| `CANTOBRIDGE_TURN_PROVIDER` | `static` |
| `CANTOBRIDGE_TURN_URL` | Metered 提供的所有 TURN / TURNS URL，以逗号分隔 |
| `CANTOBRIDGE_TURN_USERNAME` | Credential 的 Username |
| `CANTOBRIDGE_TURN_CREDENTIAL` | Credential 的 Password / credential |
| `CANTOBRIDGE_INVITE_CODE` | Blueprint 自动生成；手动部署时生成至少 16 字符随机口令 |
| `CANTOBRIDGE_MAX_ACCOUNTS` | `50` |
| `NODE_VERSION` | `22` |

Render 自动提供 `PORT`、`RENDER` 和 `RENDER_EXTERNAL_URL`。默认只允许该 HTTPS 域名；若以后使用自定义域名，将 `PUBLIC_ORIGIN` 设置为那个 HTTPS 域名（不带路径）。无需买域名、申请本地证书或创建第二个公网后端。

部署成功后记录 Render 实际分配的固定 URL。把这个链接与邀请口令直接提供给评委和内测用户；不要把口令写在公开仓库。邀请 cookie 有效七天，HttpOnly、Secure、SameSite=Lax；更换口令会让旧 cookie 失效。

## 4. 验收

1. 未输入口令时仅看得到内测入口，API 和 WebSocket 不能绕过口令；开发接口返回 404。
2. 两个不同浏览器注册、填写资料、匹配，实际说话能互相听见，切卡同步，结束后各自有历史。
3. 一个设备用 Wi-Fi，另一个用手机流量，重复真实通话；检查确实使用真实通话而不是模拟动画。另测试拒绝麦克风、断线、刷新和再次进入。
4. 保存个人资料与积分后，在没有进行中通话时手动重新部署。再次打开仍认出账号，资料、积分和历史不丢；旧排队和旧通话不继续。
5. 关闭本机两个开发服务器，另一台设备仍能通过固定 URL 使用项目。再关闭电脑验证。
6. 闲置后再次打开，接受免费冷启动等待，确认可以进入。评审前检查 Supabase 未暂停并走完真实通话。

若 Supabase 低活跃暂停，需要在 Dashboard 恢复，再检查 Render 服务；可能需要手动重启。不要依赖本机隧道或本机进程保持公网服务。

## 免费限制与维护

Render 免费运行时间、带宽和构建额度有限；闲置 15 分钟后休眠，唤醒约一分钟。免费本地磁盘不持久，所有账号数据必须由 Supabase 保存。不要使用 30 天到期的 Render 免费 Postgres 替代本方案。未添加付款方式时，Render 超额可能暂停服务。Supabase Free 低活跃七天可能暂停，免费版没有自动备份，需要在项目 Dashboard 定期导出并妥善保管。

邀请口令只限制访问范围。设备密钥属于账号凭证，不提供给别人，不在页面公开展示。旧本地短设备 ID 不导入公网环境；公网新账号使用密码学随机值。此方案用于少量受邀用户，没有正式邮箱登录、密码找回或多实例扩展能力。

官方参考：[Render Free](https://render.com/docs/free)、[Render Blueprint](https://render.com/docs/blueprint-spec)、[Supabase API keys](https://supabase.com/docs/guides/api/api-keys)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Metered TURN quickstart](https://www.metered.ca/docs/turn-server-service/quickstart/)。实际免费开通条件以账户页面为准。

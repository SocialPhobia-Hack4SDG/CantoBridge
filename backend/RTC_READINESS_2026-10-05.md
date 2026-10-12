# 连麦实现与上线准备检查 · 2026-10-05

阶段：making it better（核验现有 MVP，明确上线缺口）。

检查基线：GitHub `origin/main` 的 `05dd99c`，执行快进拉取后没有新的远端提交。本报告与新增测试为本地审查成果，未部署、未修改用户账号数据。

## 结论

已经实现真实一对一语音所需的前后端主链路，适合受控演示；不能把“代码已接通”当作“公网任意两名用户可靠连麦已经验收”。正式上线前需要完成 TURN、HTTPS/WSS 与公网域名配置、房间权限修复和开发接口关闭，再进行不同网络的真机互听验收。

## 已实现的链路

| 部分 | 当前实现 | 证据 |
| --- | --- | --- |
| 真实账户与资料 | 每设备独立账号、身份、资料与设置；用户名可保存 | `src/domain/account.js`，真接口端到端 |
| 匹配与成房 | 入队、候选列表、选择对手、原子成房、实时推送 | `src/domain/match.js`、`src/domain/rooms.js`、`src/ws/signaling.js` |
| 麦克风与传音 | `getUserMedia({audio:true,video:false})`、轨道发送、SDP/ICE 交换、远端 audio 播放与手势解锁 | `../frontend/src/services/rtc.js` |
| 通话模式 | 默认真接口，首次将 sim 升为 remote；模拟通话仍作为降级选项，不能视为真实互听 | `../frontend/src/services/index.js`、`../frontend/src/pages/room.js` |
| 信令 | 同一后端承载 `/ws/match` 和 `/ws/rooms/:roomId`；令牌与 Origin 检查、转发、退出通知 | `src/ws/signaling.js` |
| 结算 | 结束对话、历史、双方积分、评价与商城兑换 | 真接口端到端及后端回归 |

REST 契约实现 34/37；正式凭证登录、令牌刷新、APK 版本策略仍由前端 fallback 处理，不等于整个项目全部完成。

## 上线前需处理

1. **TURN 与公网真机验收。** 默认 ICE 只下发 Google STUN。后端支持通过 `CANTOBRIDGE_TURN_URL`、`CANTOBRIDGE_TURN_USERNAME`、`CANTOBRIDGE_TURN_CREDENTIAL` 配置中继，前端会使用，但本次未验证真实 TURN 服务及公网 relay 音频路径。已有本机后端启动日志记录 TURN 未配置；这不是对未知线上服务器配置的证明。不同网络或受限 NAT 下仅 STUN 不能保证连接成功。
2. **HTTPS、WSS、域名与常驻服务。** 前端默认同源 `/api` 与 `/ws`，现有 Node 前端服务支持反代 WebSocket upgrade；公网必须使用受信任 HTTPS，正确反代 API 与 WSS，并把网站精确 Origin 加入 `CANTOBRIDGE_CORS`。测试确认默认公网 Origin 返回 403，配置后能握手。仅上传静态页面不包含后端与信令服务。仓库没有验证过的公网部署配置，本轮没有实际部署或测试线上域名。
3. **房间信令权限。** `src/ws/signaling.js` 的握手只检查 Origin、有效会话与房间存在，未检查是否属于该房间或房间是否结束；ready 按连接数计算，未限定两名不同参与者。隔离内存数据库实际测试确认：第三个账号持自己的有效令牌可以加入他人的 active 房间，也可以加入 ended 房间。需要校验参与者、状态及同身份重复连接策略。这证明可加入、接收或干扰信令，不代表已证明能窃听既有加密音频。
4. **开发接口。** `createServer()` 默认 `devRoutes:true`，CLI 没有关闭该默认值；`POST /api/dev/reset` 对应处理器没有登录或管理员检查，可清空整个数据库。应在生产启动路径关闭开发路由；不能仅隐藏前端按钮。关闭后需要另行确认依赖 `/api/dev/match-request` 的演示匹配路径，真实选人直接成房已经有独立实现。
5. **正式账户与持久化。** 当前按本机 deviceId 识别账户，令牌用 `Math.random()` 生成，属于演示设计；正式发布需评估认证与令牌实现。内存 Hub/队列配 JSON 快照适合单实例，需持久磁盘和备份；不能直接以临时文件系统或互不共享状态的多个实例部署。

## 本轮验证与边界

- 前端 529/529、后端新增部署配置测试后 181/181；前后端接口契约、UI 与文档校验通过。
- 新增 `tests/rtcDeployment.test.mjs`：实际 HTTP 验证仅 STUN / 配置 TURN 下发与鉴权；实际 WebSocket 验证公网 Origin 默认拒绝、配置允许、无效令牌仍拒绝。
- 真接口端到端 17/17：注册、资料、匹配、话题卡、结算、评价、积分、设置与退出。该脚本采用 DOM 替身，且待接受匹配用开发接口生成，不代表完整生产匹配模式均已验收。
- 双端彩排 22/22：临时内存数据库 + 临时前端反代 + 真 WebSocket + 真实 rtc.js，验证 offer/answer/ICE 转发、翻卡同步、挂断、失联降级和无效令牌。媒体栈使用替身，没有真实录音、真实 NAT 穿透或真人互听。本轮初次脚本默认找 4173 未找到服务，之后用独立临时反代重跑成功；未重启或改动已有服务。
- 仓库 README 记录 2026-10-01 曾通过两台设备互听。本报告将其视为历史记录，没有重复进行物理真机验收，也没有公网通话成功率数据。

## 最终验收建议

先补齐上述上线缺口，再用两个独立账号，在家庭 Wi-Fi 与手机蜂窝网络、不同 Wi-Fi、桌面与移动浏览器组合下测试；确认双向声音、静音、权限拒绝、自动播放解锁、断网退出与双方结算。至少一次检查实际选中的 ICE candidate 为 relay，证明 TURN 中继真实可用。正式域名下还应验收越权房间请求被拒绝、开发接口不存在及服务重启后数据保留。

参考：[WebRTC 官方 TURN 说明](https://webrtc.org/getting-started/turn-server)、[MDN getUserMedia 安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

# CantoBridge

让粤语学习者与粤语使用者一对一语音交流，以普通话、粤语、英文话题卡帮助开口。

这是黑客松 MVP：支持设备账号、双身份资料、匹配、真实 WebRTC 语音、同步话题卡、结算、伙伴申请、历史记录和积分商城。话题卡来自预先准备的内置内容库，当前不调用实时生成模型。

## 本地运行

需要 Node.js 22 或更新版本。打开两个终端：

```sh
# 终端一，仓库根目录
npm ci --prefix backend
npm --prefix backend start

# 终端二，仓库根目录
npm --prefix frontend run serve
```

打开 `https://localhost:4173/`。本地服务器会生成自签证书。公网部署使用云平台提供的受信任 HTTPS，不分发本机证书。仅查看模拟界面可以打开 `https://localhost:4173/?api=mock`。

## 免费公网内测

部署方案：一个 Render Free 服务同时提供前端、REST 和 WebSocket，Supabase Free 保存数据，Metered TURN 为跨网络语音提供中继。当前用户选择无需绑卡的 500 MB 免费试用档位，额度有限，先用于演示验收。电脑关机后云服务继续独立运行。

**当前状态：部署代码已准备；实际公网链接和真实跨网络通话需要完成账户配置与验收后才能确认。**

详细步骤、环境变量、安全边界与验收流程见 [部署说明](deploy/README.md)。仓库根目录的 `render.yaml` 明确选用免费服务，不创建付费磁盘或数据库。

公网内测需要邀请口令，最多接受 50 个设备账号。账号目前与浏览器设备密钥绑定；清除浏览器数据会丢失该账号的访问入口，暂不支持跨设备找回。邀请口令不等于个人登录密码。

免费服务有额度和休眠限制：Render 闲置后会休眠，首次访问可能等待约一分钟；Supabase 低活跃项目可能暂停，需在后台恢复。超额、暂停或供应商故障会影响访问，不保证全天秒开。服务重启或重新部署会中断正在进行的通话和排队，已保存的资料、积分、伙伴关系和历史会保留。

## 验证

```sh
npm ci
npm test
npm run check
```

测试包括前后端回归、邀请口令与权限、云端重启恢复、并发保存、保存失败、TURN 配置和完整公网入口。自动测试不替代两台真实设备的麦克风与跨网络通话验收。

## 文档与素材

- [前端说明](frontend/README.md)、[后端说明](backend/README.md)
- [API 契约](frontend/docs/10-api-v1.md)
- [头像来源记录](frontend/assets/avatars/README.md)、[Logo 来源记录](frontend/assets/branding/README.md)
- 粤拼生成工具的第三方许可保留于 [ToJyutping-LICENSE.txt](frontend/tools/ToJyutping-LICENSE.txt)。仓库目前没有项目级开源许可证。

真实环境配置、密钥、用户数据、依赖和私人工作记忆不得提交。`.env.example` 仅列变量名，不包含真实凭证。

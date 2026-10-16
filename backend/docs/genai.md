# GenAI 接口准备

阶段：making it exist。只完成后端接口和提供方边界；尚未接入真实模型、语音识别或前端页面。

默认使用本地 sample 提供方，无需密钥、不发出外部请求、不产生 API 费用。每次成功响应都带 `mode: "mock"`、`provider: "sample"`、`model: null`。不得将这些示例响应描述成真实 AI 生成或学习评估。

## 通用约定

- 两接口都需要现有会话的 `Authorization: Bearer <token>`，两种身份都可调用，不要求创建房间。
- 成功为 HTTP 200，信封 `{ ok: true, data: ... }`；参数错误为 400 `bad_request`，无有效会话为 401 `not_authorized`，错误方法为 405 `method_not_allowed`。
- 可选 `requestId` 为1–128长度的非空白字符串，同一令牌、同一路径、同一 ID 按现有幂等缓存回放；修改输入时使用新 ID。未提供时每次执行，失败响应不缓存。
- 只接受文档字段，嵌套对象也拒绝未知字段。文字去首尾空格；长度按 JavaScript UTF-16 长度计算，上限在去空格前检查。
- 不保存聊天、不创建房间、不改变资料、收藏、积分或匹配队列。

## POST /api/genai/topic-cards

| 请求字段 | 类型与限制 |
| --- | --- |
| `learnerInterests` | 必填 string[]，允许空数组，原始数组最多5项，每项1–40长度且不可全为空格；去空格、去重，支持自定义兴趣 |
| `buddyInterests` | 同上 |
| `cantoneseLevel` | 必填，`beginner`、`elementary`、`intermediate` 或 `advanced` |
| `count` | 可选整数1–8，默认3 |
| `requestId` | 可选，见通用约定 |

```json
{
  "learnerInterests": ["anime", "food"],
  "buddyInterests": ["food", "travel"],
  "cantoneseLevel": "beginner",
  "count": 2
}
```

响应 `data` 包含来源字段、`cards` 和 `context`。`context` 回显规范化后的四个输入字段，加上双方完全相等的兴趣交集 `sharedInterests`。

`cards` 数量等于 `count`，ID 不重复，每张卡与现有房间卡片同格式：

| 卡片字段 | 类型与限制 |
| --- | --- |
| `id`、`topic` | 非空字符串，各最多100长度 |
| `difficulty` | 上述四档程度之一 |
| `cantonese`、`jyutping`、`mandarin`、`english` | 非空字符串，各最多500长度 |
| `expressions` | 1–4个三语句型对象；每个对象只有 `cantonese`、`mandarin`、`english` 三个必填非空字段，各最多500长度 |

sample根据已知共同兴趣和程度，从现有人工卡池确定性选卡。没有可用共同兴趣时返回通用话题；自定义兴趣保留在 `context`，但不会假装根据它生成新内容。真实兴趣融合生成留给未来模型适配器。

## POST /api/genai/tutor/reply

| 请求字段 | 类型与限制 |
| --- | --- |
| `text` | 必填非空字符串，最多2000长度，不可全为空格 |
| `currentCard` | 必填卡片对象，完整字段与上表一致；可直接传上个接口返回的卡片，也可传现有房间同格式卡片 |
| `requestId` | 可选，见通用约定 |

响应 `data` 包含来源字段、`cardId`、`reply`、`suggestions`。`cardId` 对应传入卡片；`reply` 是只有 `cantonese`、`mandarin`、`english` 的三语对象，各最多1000长度。`suggestions` 为1–3个三语表达对象，各字段最多500长度。

示例回复围绕卡片给固定练习提示；建议直接取自卡片句型。`text` 会校验并传给提供方，但 sample 不理解或评估它，不提供真实纠错，也没有跨请求会话记忆。不接收音频字段。

## 连续调用示例

取得有效令牌后，可用支持 fetch 的 Node.js 运行：

```js
const base = 'http://localhost:8787';
const token = process.env.CANTOBRIDGE_TEST_TOKEN;
async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error.message);
  return result.data;
}
const cards = await post('/api/genai/topic-cards', {
  learnerInterests: ['food'], buddyInterests: ['food'], cantoneseLevel: 'beginner', count: 1,
});
const reply = await post('/api/genai/tutor/reply', {
  text: '我今日去咗食點心', currentCard: cards.cards[0],
});
console.log(cards, reply);
```

## 以后如何接免费模型

`createServer({ genAiProvider })` 支持注入提供方对象。实现 `generateCards(input)` 和 `tutorReply(input)`，分别返回 `{ cards }` 和 `{ reply, suggestions }`；同时声明 `name`、`mode`、`model` 来源信息。默认实现位于 `src/services/genai.js`，HTTP校验与鉴权位于 `src/domain/genai.js`。只有实际调用模型时才可将 `mode` 标为真实服务模式。

输出会再次经过字段、长度、数量及卡片ID唯一性检查；异常和不合格式的内容统一返回 500 `internal`，不暴露原始错误或凭证，也不会静默伪装成生成成功。接入真实API时仍须增加凭证配置、超时、服务额度处理并验证粤语质量；这轮未实现或验证外部服务能力。

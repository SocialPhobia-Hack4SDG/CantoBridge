/**
 * 测试助手：把服务起在**随机端口**上（0 = 让系统挑一个），每个用例自己一份内存 db，
 * 互不干扰；直接 throw 的时候用 `close()` 收尾。
 *
 * 为什么用真 HTTP 而不是直接调 handler：信封、状态码、CORS 头、幂等回放、
 * 坏 JSON 这些恰恰是「只有走完整个链路才会暴露」的问题——和前端用 DOM stub
 * 跑 app.start() 是同一个理由。
 */

import { createServer } from '../../src/server.js';
import { createDb } from '../../src/store/db.js';

/**
 * 每个测试服务实例上的「第一台设备」。所有用例不特别指定时都在这台设备上操作，
 * 所以 `signIn('learner')` 之后再 `signIn('buddy')` 是**同一个人换了身份**——
 * 这正是契约 2.3 / 2.4 的双身份模型。
 */
export const DEFAULT_DEVICE_ID = 'device-default';

export async function startTestServer({
  corsOrigins = [],
  dataFile = null,
  devRoutes = true,
  db = null,
  now = undefined,
  turn = null,
  stunUrls = undefined,
} = {}) {
  const database = db ?? createDb({ filePath: dataFile });
  // `now` 可注入：测「匹配请求过期」「倒计时到点」这类用例要能把时钟拨快
  const app = createServer({
    db: database,
    corsOrigins,
    devRoutes,
    turn,
    ...(now ? { now } : {}),
    ...(stunUrls ? { stunUrls } : {}),
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(method, path, { token = null, body, headers = {} } = {}) {
    const hasBody = body !== undefined;
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, headers: response.headers, text };
  }

  /**
   * 一站式注册：返回**整份会话数据**（`{ token, expiresAt, userId, role }`）。
   *
   * 账号由 `deviceId` 决定：同一个 `deviceId` → 同一个账号（换身份也不换人），
   * 不同 `deviceId` → 两个账号。要演「两台设备」就传两个不同的 deviceId。
   */
  async function signInAs(role = 'learner', { deviceId = DEFAULT_DEVICE_ID } = {}) {
    const result = await request('POST', '/api/auth/session', { body: { role, deviceId } });
    if (result.status !== 201) {
      throw new Error(`signInAs 失败：${result.status} ${result.text}`);
    }
    return result.json.data;
  }

  /** 只取令牌（大多数用例只要它）。身份默认学习者（`role` 见契约 3.6 的 ROLES）。 */
  async function signIn(role = 'learner', options) {
    return (await signInAs(role, options)).token;
  }

  /** 某台设备此刻的账号 id（已经注册过才拿得到，否则 null）。 */
  function accountIdOf(deviceId = DEFAULT_DEVICE_ID) {
    return database.findUserByDeviceId(deviceId)?.userId ?? null;
  }

  /**
   * 信令地址。令牌走查询串 —— 浏览器的 `WebSocket` 构造函数不允许自定义请求头，
   * 所以握手令牌只能挂在 URL 上（见 src/ws/protocol.js 的说明）。
   */
  function signalUrl(path, { token = null } = {}) {
    const url = new URL(path, base.replace(/^http/, 'ws'));
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  return {
    base,
    app,
    db: database,
    request,
    signIn,
    signInAs,
    accountIdOf,
    signalUrl,
    /**
     * 收尾要**先关信令再关 server**：升级过的 socket 不在 http server 的连接表里，
     * 只关 server 的话进程会一直挂着不退出。
     */
    async close() {
      await app.signaling?.close?.();
      await new Promise((resolve) => app.server.close(resolve));
    },
  };
}

/**
 * 信令连接登记簿（Hub）。
 *
 * 这一层**故意不认识任何业务**：它只知道「某个频道上有哪些连接」，
 * 以及「往某个频道推一条消息，可以指定不要推给谁」。
 *
 * 为什么值得单独拆一层：领域层（`domain/rooms.js`、`domain/match.js`）只应该喊一句
 * 「这个人被摘走了」，不该知道 WebSocket 的存在；反过来信令层也不该自己判断
 * 「谁该收到 `match:taken`」。两边都只依赖这个哑登记簿，谁都能单独测。
 *
 * 一个账号可以有多条连接（两个标签页、手机 + 电脑），所以「按账号定向推」是
 * 一对多的，不能假设一个账号只有一条连接。
 */

export function createHub() {
  /** @type {Map<string, Set<object>>} */
  const channels = new Map();

  function setOf(channel) {
    let set = channels.get(channel);
    if (!set) {
      set = new Set();
      channels.set(channel, set);
    }
    return set;
  }

  function* clientsOf(channel) {
    yield* channels.get(channel) ?? [];
  }

  const hub = {
    /** 登记一条连接，返回注销函数（`socket.on('close')` 里调它）。 */
    register(channel, client) {
      setOf(channel).add(client);
      return () => hub.unregister(channel, client);
    },

    unregister(channel, client) {
      const set = channels.get(channel);
      if (!set) return;
      set.delete(client);
      // 空频道要清掉，否则 `channels()` 会随着演示进程一直长
      if (set.size === 0) channels.delete(channel);
    },

    size(channel) {
      return channels.get(channel)?.size ?? 0;
    },

    clients(channel) {
      return [...clientsOf(channel)];
    },

    /**
     * 往频道推一条消息。`except` 里的连接跳过 —— 信令转发**绝不能回给自己**，
     * 否则前端会把本地 description 当成对方的再设一遍。
     * 返回真正发出去的条数（连接已关的会被 `client.send` 拒掉，不算）。
     */
    broadcast(channel, message, { except = null } = {}) {
      let sent = 0;
      for (const client of clientsOf(channel)) {
        if (except && except.has(client)) continue;
        if (client.send(message)) sent += 1;
      }
      return sent;
    },

    /**
     * 定向推给某个人：这个人在这个频道上的**所有**连接都会收到。
     *
     * 目标要写成 `{ userId, role }` 而不是只有 `userId` —— **一台设备可以同时挂着
     * 两个身份**（同一账号的 learner / buddy 各开一个标签页），只按账号过滤的话，
     * 「学习者该弹的接受框」会同时弹到母语者那个标签上。
     * `role` 给 `null` 表示不限身份。
     */
    sendTo(channel, target, message) {
      const userId = target?.userId ?? target;
      const role = target?.role ?? null;
      let sent = 0;
      for (const client of clientsOf(channel)) {
        if (client.userId !== userId) continue;
        if (role !== null && client.role !== role) continue;
        if (client.send(message)) sent += 1;
      }
      return sent;
    },

    channels() {
      return [...channels.keys()];
    },

    clear() {
      channels.clear();
    },
  };

  return hub;
}

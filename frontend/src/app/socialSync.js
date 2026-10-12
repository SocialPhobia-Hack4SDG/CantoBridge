/**
 * 伙伴关系的「打开即准」。
 *
 * 背景：`/dev/mock` 与首屏读的是 store 里的 `social`（`buddies` / `buddyRequests`），
 * 而这两张表只有「我的」「历史」页会主动去拉 —— 直接打开别的页面（尤其 `/dev/mock`）
 * 看到的是本地那份，不是服务端的真实关系。
 *
 * 所以在外壳层补一次「启动即拉」：
 *   1. `start()` 时拉一次；
 *   2. 之后**身份一变就再拉**（登录 / 切换身份＝换了令牌，关系表要重新对齐）。
 *
 * **失败一律静默**：未登录、离线、后端没起都不该拦住启动 —— 这只是锦上添花，
 * 页面自己该拉的还会拉（`/me`、`/history` 不依赖这一层）。
 */

export function createSocialSync({ api, store }) {
  let lastRole = null;

  /** 拉两张表并灌进 store。返回是否成功（失败不抛，调用方也不需要处理）。 */
  async function sync() {
    try {
      const [buddies, buddyRequests] = await Promise.all([api.listBuddies(), api.listBuddyRequests()]);
      store.hydrateSocial({ buddies, buddyRequests });
      return true;
    } catch {
      // 未登录（401）/ 离线 / 后端没起：保持现有镜像，等页面自己拉
      return false;
    }
  }

  /** 订阅身份变化；返回退订函数（与 `store.subscribe` 一致）。 */
  function attach() {
    lastRole = store.getState().role;
    return store.subscribe((state) => {
      if (state.role === lastRole) return;
      lastRole = state.role;
      void sync();
    });
  }

  return { sync, attach };
}

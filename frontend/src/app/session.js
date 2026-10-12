/**
 * 登录引导：**让页面永远不用自己管令牌**。
 *
 * 为什么需要它：走真后端（默认档位）时，除了落地页，几乎所有请求都要带令牌
 * （资料、设置、匹配、成房、结算…），但**没有任何页面会去调 `api.signIn()`**——
 * 于是真后端档位下所有请求都 401，界面到处是错误态。这层就是补这个洞：
 *
 *   1. app 启动时按当前身份登录一次（`POST /api/auth/session` 换令牌）；
 *   2. 之后**身份一变就重新登录**（换身份＝换令牌）。
 *
 * 两条实现约定：
 *   - `ensure()` **先占位再 await**：`signIn` 内部会 `store.setRole()`，那会触发订阅回调，
 *     不先占位就会自己叫自己（mock 档位下是同步的，必踩）；
 *   - 失败**可重试**：登录失败就把占位清掉，下次身份变化或下次启动还能再来。
 *
 * 纯 mock 档位下它是"无害的旁路"：mock 的 `signIn` 只是本地切身份。
 *
 * ## 什么时候**不许**登录（`enabled` 谓词）
 *
 * 注册页出现之后，账号是「用户点了注册」才长出来的，落地页与注册页本身不该建号。
 * 所以 `attach()` 接受一个 `enabled` 谓词，由外壳层回答「这一轮允不允许登录」——
 * 默认 `null` 表示不设限（老行为）。少了它，落地页上任何一次 store 变动
 * （比如切界面语言）都会顺手把账号建出来，注册页就成了走过场。
 */

export function createSession({ api, store }) {
  let lastRole = null;

  /** 确保当前身份有一个可用会话。已经为这个身份登录过就直接返回 false（幂等）。 */
  async function ensure(role = store.getState().role) {
    if (role === lastRole) return false;
    lastRole = role;
    try {
      await api.signIn(role);
      return true;
    } catch (error) {
      lastRole = null; // 失败不算数，允许重试
      throw error;
    }
  }

  /**
   * 退出登录：让服务端把这条会话作废，并把「已经登录过」的记账清掉。
   *
   * 清记账（`lastRole = null`）这一行不能漏，而且比清令牌更要紧：设备 id 就是账号，
   * 退出之后这台机器要能**重新注册成另一个人**——记账还在的话，`ensure()` 会以为
   * 当前身份还登着、直接返回 false，新账号永远建不出来。
   *
   * 失败**不抛**：退出是个「把人放出去」的动作，令牌本来就失效（401）或后端没起
   * 都不该把人锁在里面。服务端那条会话留着不影响本机，演示时用控制台重置即可。
   */
  async function signOut() {
    try {
      await api.signOut?.();
    } catch {
      void 0;
    } finally {
      lastRole = null;
    }
  }

  /**
   * 订阅身份变化：换身份＝换令牌。
   * `onReady` 在**登录成功之后**回调——外壳层用它接着拉关系表（顺序不能反：
   * 没有令牌时拉列表会 401）。
   *
   * `enabled` 回答「现在允不允许登录」，返回 false 时连身份变化也按兵不动
   * （注册前不建号，见文件头的说明）。
   *
   * 这里**故意不预占位**：占位（`lastRole`）统一由 `ensure()` 维护，
   * 否则「只调 attach、不调 ensure」的调用方会觉得启动那次登录已经被处理过而永远不登录。
   */
  function attach({ onReady = null, enabled = null } = {}) {
    return store.subscribe((state) => {
      if (state.role === lastRole) return;
      if (enabled && !enabled()) return;
      void ensure(state.role)
        .then(() => onReady?.())
        .catch(() => {
          // 离线 / 后端没起：保持 mock 兜底，不打扰用户
        });
    });
  }

  return { ensure, attach, signOut };
}

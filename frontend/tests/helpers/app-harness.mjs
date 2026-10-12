/**
 * app 层测试脚手架：把 `app.js` 真的跑起来（DOM/Window stub + 可拨时钟 + 交互快捷方式）。
 *
 * 从 `tests/app.test.mjs` 抽出来，供两处复用：
 *   1. `tests/app.test.mjs` —— 默认注入 mock api（`useMock: true`）；
 *   2. `tools/e2e-real.mjs` —— 用 `apiFactory` 注入**真后端**的 api（`useMock: false`），
 *      一条命令走完「真数据 + 真界面」的主链路。
 *
 * 约定：
 *   - **共用时钟**：`boot()` 造的 `now = Date.now() + clock.skewMs`，`store`、app 层后台匹配、
 *     页面计时读的都是它；`ui.advance(ms)` 拨快它，三边看到的「现在」始终一致。
 *   - **全局定时器改道**：页面里写的是全局 `setInterval`（浏览器里那就是 window 的），
 *     所以要把全局定时器指向 stub，否则页面会绕过 stub 注册真定时器（测试推不动、
 *     进程也退不出）。用完调 `restoreGlobalTimers()`。
 */

import assert from 'node:assert/strict';

import { createApp } from '../../src/app/app.js';
import { STORAGE_KEY, STORAGE_VERSION, createMemoryStorage, createStore } from '../../src/app/store.js';
import { createMockApi } from '../../src/services/mockApi.js';
import { installDom, StubElement } from './dom-stub.mjs';
import { DEMO_POOL } from './demoPool.mjs';

export const REAL_TIMERS = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

/**
 * 页面里用的是全局 setInterval / clearInterval（在浏览器里那就是 window 的定时器，
 * 是正确的写法）。所以测试必须把全局定时器改道到 stub 上，否则页面会绕过 stub
 * 直接注册真实的 Node 定时器：测试既推不动演示倒计时，进程也会因为漏掉的 interval
 * 一直不退出。
 */
export function installGlobalTimers(win) {
  globalThis.setTimeout = (fn, ms) => win.setTimeout(fn, ms);
  globalThis.clearTimeout = (id) => win.clearTimeout(id);
  globalThis.setInterval = (fn, ms) => win.setInterval(fn, ms);
  globalThis.clearInterval = (id) => win.clearInterval(id);
}

/** 还原被改道的全局定时器（测试的 `after()` / 脚本的收尾都要调）。 */
export function restoreGlobalTimers() {
  Object.assign(globalThis, REAL_TIMERS);
}

export async function flush(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Window stub：只实现 app 与页面用到的那部分，定时器全部进队列由测试手动推进。 */
export function createWindowStub(initialHash = '') {
  const listeners = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  let idSeq = 0;
  let hash = String(initialHash);

  function emit(type) {
    for (const handler of [...(listeners.get(type) ?? [])]) handler({ type });
  }

  const win = {
    __CANTOBRIDGE_DEV__: true,
    navigator: {},
    history: { length: 1, back() {} },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    setTimeout(fn) {
      idSeq += 1;
      timeouts.set(idSeq, fn);
      return idSeq;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(fn) {
      idSeq += 1;
      intervals.set(idSeq, fn);
      return idSeq;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    /** 推进虚拟时钟：每轮先跑存活中的 interval，再跑本轮到期的 timeout。 */
    tick(rounds = 1) {
      for (let round = 0; round < rounds; round += 1) {
        for (const fn of [...intervals.values()]) fn();
        const due = [...timeouts.values()];
        timeouts.clear();
        for (const fn of due) fn();
      }
    },
    pendingTimers: () => timeouts.size,
    pendingIntervals: () => intervals.size,
  };

  Object.defineProperty(win, 'location', {
    value: {
      get hash() {
        return hash;
      },
      set hash(next) {
        const target = String(next);
        if (target === hash) return;
        hash = target;
        emit('hashchange');
      },
      replace(next) {
        win.location.hash = next;
      },
      get href() {
        return 'http://localhost/' + hash;
      },
    },
  });

  return win;
}

/** 按可见文字找按钮：比 class 选择器更接近「用户看到的」，也不怕类名调整。 */
export function findButton(root, label) {
  return root.walk().find((node) => node.tagName === 'BUTTON' && node.textContent.includes(label)) ?? null;
}

/**
 * 把 app 跑起来，返回一组交互快捷方式。
 *
 * @param {object} [options]
 * @param {string} [options.hash]            起始 hash（默认 `#/`）
 * @param {'learner'|'buddy'} [options.role] 起始身份（默认 learner）
 * @param {boolean} [options.learnerOnboarded] 预置存储里学习者资料是否「已填过」（默认 true：
 *                                           出厂值是 false，要真注册；多数用例测的是注册之后的界面）
 * @param {boolean} [options.buddyOnboarded] 预置存储里母语者资料是否「已填过」
 * @param {object}  [options.candidates]     mock 候选池（默认 `DEMO_POOL`：有人的世界）。
 *                                           传 `{ learners: [], buddies: [] }` 就是「谁都还没注册」。
 * @param {Function} [options.apiWrapper]    `(baseApi, store) => api`，包一层 mock（老用法）
 * @param {Function} [options.apiFactory]    `(store) => api`，**整个替换**数据源
 *                                           （e2e 用它注入真后端 api）
 * @param {object} [options.storagePreset]   额外并进存档的内容（例如
 *                                           `{ learnerProfile: { onboarded: false } }`）
 * @param {boolean} [options.installTimers]  是否把全局定时器改道到 window stub（默认 true）。
 *                                           走**真 fetch** 时必须传 false：undici 内部要用真的
 *                                           `setTimeout` 并调 `.unref()`，stub 返回数字 id 会直接抛
 *                                           `this.timeout?.unref is not a function`。
 * @param {string}  [options.signalUrl]      信令基址（默认 `null`＝没有信令，匹配频道不连）。
 *                                           要测「匹配频道真的连上了」就传一个基址。
 * @param {Function}[options.webSocket]      `WebSocket` 构造器替身（默认 `null`＝不连）。
 *                                           与 `signalUrl` 一起用：给了替身才能手动推进推送。
 */
export async function boot({
  hash = '#/',
  role = 'learner',
  learnerOnboarded = true,
  buddyOnboarded = true,
  candidates = DEMO_POOL,
  apiWrapper = null,
  apiFactory = null,
  storagePreset = null,
  installTimers = true,
  signalUrl = null,
  webSocket = null,
} = {}) {
  const doc = installDom();
  const root = new StubElement('div');
  root.setAttribute('id', 'app');
  doc.getElementById = (id) => (id === 'app' ? root : null);

  const win = createWindowStub(hash);
  if (installTimers) installGlobalTimers(win);

  // 可拨动的共用时钟：排队时长与匹配弹窗的倒计时都按它算，ui.advance(ms) 推进它
  const clock = { skewMs: 0 };
  const now = () => Date.now() + clock.skewMs;

  // 出厂两份资料都是 onboarded=false（要先真注册）；store 的 saveRoleProfile 会强制置 true，
  // 所以「已经填过」这种状态要通过预置存储来构造。资料 id 由设备 id 派生，这里不覆盖它。
  const storage = createMemoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: STORAGE_VERSION,
      learnerProfile: { onboarded: learnerOnboarded },
      buddyProfile: { onboarded: buddyOnboarded },
      ...(storagePreset ?? {}),
    }),
  );

  const store = createStore({ storage, now });
  store.saveSettings({ mockDelayMs: 0 });
  if (role === 'buddy') store.setRole('buddy');

  // 默认数据源是**注入了候选池的 mock**（产品默认档位已经是真后端了，测试里要的是确定性）；
  // `apiFactory` 直接整个替换（e2e 用它注入真后端 api）
  const baseApi = apiFactory ? null : createMockApi({ store, candidates });
  const api = apiFactory ? apiFactory(store) : apiWrapper ? apiWrapper(baseApi, store) : baseApi;
  // 匹配频道默认不连（`signalUrl` / `webSocket` 都是 null）：单测里不需要真 socket。
  // 要测推送落地时显式传这两个，见 `app.test.mjs` 的「匹配频道」用例。
  const app = createApp({ store, api, doc, win, signalUrl, webSocket });
  app.start();

  return {
    app,
    api,
    store,
    win,
    root,
    doc,
    storage,
    text: () => root.textContent,
    has: (selector) => root.querySelector(selector) !== null,
    one: (selector) => root.querySelector(selector),
    all: (selector) => root.querySelectorAll(selector),
    button: (label) => findButton(root, label),
    /** 把共用时钟往前拨 ms 毫秒（倒计时 / 排队时长都用它）。 */
    advance(ms) {
      clock.skewMs += ms;
    },
    async goto(path) {
      win.location.hash = '#' + path;
      await flush();
    },
    async clickButton(label) {
      const button = findButton(root, label);
      assert.ok(button, '点不到按钮「' + label + '」；当前页面文字：' + root.textContent.slice(0, 300));
      button.click();
      await flush();
    },
    /** 只在底部导航里找按钮：页面正文里也可能有同名入口，这里要测的是导航本身。 */
    async clickNav(label) {
      const nav = root.querySelector('.bottom-nav');
      const item = nav?.walk().find((node) => node.tagName === 'BUTTON' && node.textContent.includes(label));
      assert.ok(item, '点不到底部导航「' + label + '」；当前页面文字：' + root.textContent.slice(0, 200));
      item.click();
      await flush();
    },
    async click(selector) {
      const node = root.querySelector(selector);
      assert.ok(node, '点不到元素「' + selector + '」；当前页面文字：' + root.textContent.slice(0, 300));
      node.click();
      await flush();
    },
  };
}

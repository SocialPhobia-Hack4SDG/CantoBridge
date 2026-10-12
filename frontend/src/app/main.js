/**
 * 入口：装配 store -> service -> app，然后启动。
 * 无构建步骤，index.html 直接用 `<script type="module" src="/src/app/main.js">` 引入。
 *
 * **档位开关**（`docs/09` 第 4.1 节的三档）：本项目没有构建步骤，读不到 `VITE_*` 环境变量，
 * 所以用 URL 参数切换——切档位只改这一处，页面代码一行都不用改：
 *
 *   http://localhost:4173/           → 真后端（**默认**，列表里只有真实注册的人）
 *   http://localhost:4173/?api=mock  → 纯 mock（没有后端时的空世界兜底，候选池是空的）
 *
 * 真后端的接口**默认打成同源 `/api/...`**，由 `tools/serve.mjs` 反代到 8787 ——
 * 这样 HTTPS 页面（手机开麦克风的前提）不会撞上 mixed content。要直连后端就加 `&direct`。
 */

import { BACKEND_PORT, createApi, resolveApiOptions, resolveSignalMode } from '../services/index.js';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { startIntro } from './intro.js';
import { createTranslator } from '../i18n/i18n.js';

// 开关的解析在 services/index.js（纯函数，有单测）；这里只负责「读当前页面」这一件事。
// Node 里没有 location：可选链取值不会抛 ReferenceError（main.js 会被单测直接 import）。
const store = createStore({});
const options = resolveApiOptions(globalThis.location?.search ?? '', globalThis.location?.hostname ?? 'localhost', {
  protocol: globalThis.location?.protocol ?? 'http:',
  host: globalThis.location?.host ?? null,
});

// 真后端档位下把出厂的通话档位升到「远端信令」——否则两台设备各自停在 sim，
// 双方都只看得到假波形、听不到声音，而且当场看不出来（见 resolveSignalMode 的说明）。
const signalMode = resolveSignalMode(store.getState().settings.signalMode, { useMock: options.useMock });
if (signalMode !== store.getState().settings.signalMode) store.saveSettings({ signalMode });

const api = createApi({ store, useMock: options.useMock, baseUrl: options.baseUrl });

// 有 DOM 才启动：这样 main.js 也能被 Node 单测/静态校验导入而不报错
if (globalThis.document) {
  // signalUrl 单独传给 app（而不是挂到 api 上）：api 的方法名集合要和 mock 严格一致，
  // 多挂一个属性就会被 tools/check-api.mjs 的「两个实现方法名逐个相等」判红。
  const app = createApp({ store, api, signalUrl: options.signalUrl });

  // 现场用：控制台可直接改数据、看状态
  globalThis.__CANTOBRIDGE_DEV__ = options.useMock;
  globalThis.__CANTOBRIDGE__ = { store, api, app };

  startIntro({ t: createTranslator(store.getState().locale), preview: new URLSearchParams(globalThis.location?.search ?? '').get('intro') === 'preview' });
  app.start();
}

export { BACKEND_PORT, resolveApiOptions, store, api, options };

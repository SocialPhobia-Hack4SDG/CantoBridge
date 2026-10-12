/**
 * 数据访问层唯一入口：按开关决定走 mock 还是真实 HTTP。
 * 页面与 hooks 只 import 这里的 createApi，不知道数据是真是假（docs/09 第 4.1 节）。
 *
 * 三个档位（`docs/09` 第 4.1 节）在本项目里用 **URL 参数**切换，而不是环境变量——
 * 因为前端**没有构建步骤**（零依赖、浏览器直接跑 ES Module），读不到 `VITE_*` 这类构建期变量：
 *
 *   - 不带参数      → 真后端（`httpApi`）**默认档位**，请求打成同源 `/api/...`
 *   - `?api=mock`   → 纯 mock（没有后端时的空世界兜底，候选池是空的）
 *   - `?api=http`   → 与不带参数等价，保留给既有文档、脚本与书签
 *
 * **默认档位从「纯 mock」翻成「真后端」是产品决定，不是技术调整**：mock 档位自带的
 * 那批假人（4 位假学习者 + 3 位假母语者）没有设备在对面等着，两台真设备各自打开
 * 都只看得到假人、互相看不见——「有谁注册了就看见谁」这件事在默认档位下直接不成立。
 * 想在没有后端的情况下看界面，显式加 `?api=mock`。
 *
 * 切档位只改这一个开关，**页面代码一行都不用改**。
 */

import { resolveSignalUrl } from '../lib/signal.js';
import { createMockApi, ApiError } from './mockApi.js';
import { createHttpApi } from './httpApi.js';

export { ApiError, resolveSignalUrl };

export function createApi({ store, useMock = true, baseUrl = '', fetchImpl = null } = {}) {
  if (useMock) return createMockApi({ store });
  // 真后端 + mock 兜底：未接线的接口原样转发给 mock，页面在「半真」档位下全程可用
  return createHttpApi({ baseUrl, store, fallback: createMockApi({ store }), fetchImpl });
}

/** 后端端口与前端约定一致（backend/README.md：前端 4173 / 后端 8787）。 */
export const BACKEND_PORT = 8787;

/**
 * 档位开关的**唯一解析处**（纯函数，便于单测）：只有显式写 `?api=mock` 才是纯 mock，
 * 其余（不带参数 / `?api=http` / 只带 `?backend=` 等）一律走真后端。
 *
 * 后端地址**默认同源**（`baseUrl: ''`，请求打成 `/api/...`）。为什么不再按主机名拼
 * `http://<hostname>:8787`：手机要开麦克风就必须走 HTTPS，而 https 页面调 http 接口
 * 会被浏览器按 mixed content 拦掉。同源之后由 `tools/serve.mjs` 把 `/api` 反代到后端，
 * mixed content、CORS 白名单、ws/wss 三件事一起消失。
 *
 * 两条退路（都不改业务代码）：
 *   - `&direct`        → 按当前主机名直连 `http://<hostname>:8787`（没走反代时用）
 *   - `&backend=<url>` → 指到任意后端，例如 `http://192.168.1.5:9999`
 *
 * 同时解析**信令基址** `signalUrl`（`docs/10` 第 5 节）：REST 与 WebSocket 必须指向同一个后端，
 * 所以两者在同一个函数里一起算出来，不允许各写一套。`?signal=<url>` 可以单独把信令指走。
 */
/**
 * 通话模式的档位默认值，与 `resolveApiOptions` 同一套「URL 决定档位」的口径。
 *
 * 出厂值 `'sim'` 是给**纯 mock 档位**准备的：没有后端，只能演假波形。
 * 一旦切到真后端（默认档位），`'sim'` 几乎一定是「忘了去 /dev/mock 切」——
 * 而两台设备各自停在 `sim` 时，双方都只看得到假波形、**听不到对方的声音**，
 * 是现场最容易演砸、且当场看不出来的那种失败。所以真后端档位下把出厂值升到 `'remote'`。
 *
 * 只升级**出厂值**：用户主动选过 `local` / `remote` 之后，落盘的值不再是 `'sim'`，不会被覆盖。
 * 在真后端档位下主动选回 `'sim'` 的人，下次打开会被再升一次——这是有意的：
 * 真后端档位下「模拟通话」不该是默认状态，想强制模拟就当场再切一次。
 *
 * 为什么不做成 `signalMode: 'auto'` 这样的新枚举值：契约 `docs/10` 第 3.4 节把
 * `signalMode` 钉死成 `enum(sim,local,remote)`，加值要动契约与三份文档，
 * 而这件事本身只是「默认值取哪个」，不值得扩枚举。
 */
export function resolveSignalMode(current, { useMock = true } = {}) {
  if (useMock) return current;
  return current === 'sim' ? 'remote' : current;
}

export function resolveApiOptions(search = '', hostname = 'localhost', { protocol = 'http:', host = null } = {}) {
  const params = new URLSearchParams(search ?? '');
  const useMock = params.get('api') === 'mock';
  const explicit = params.get('backend');
  const baseUrl = explicit
    ? String(explicit).replace(/\/+$/, '')
    : params.has('direct')
      ? `${protocol}//${hostname || 'localhost'}:${BACKEND_PORT}`
      : '';
  // `host` 带端口（`location.host`），`hostname` 不带——同源信令需要端口，所以优先用 host
  const signalUrl = resolveSignalUrl({
    baseUrl,
    protocol,
    host: host ?? hostname ?? 'localhost',
    explicit: params.get('signal'),
  });
  return { useMock, baseUrl, signalUrl };
}

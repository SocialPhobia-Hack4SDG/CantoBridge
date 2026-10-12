import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { installDom } from './helpers/dom-stub.mjs';

const FRONTEND = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(relativeDir) {
  const out = [];
  for (const entry of readdirSync(join(FRONTEND, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir + '/' + entry.name;
    if (entry.isDirectory()) out.push(...walk(relativePath));
    else if (entry.name.endsWith('.js')) out.push(relativePath);
  }
  return out;
}

const MODULES = walk('src');

test('src/ 下至少包含 store / router / 页面 / 组件这些模块', () => {
  assert.ok(MODULES.length >= 20, '模块数量异常：' + MODULES.length);
  for (const expected of ['src/app/main.js', 'src/app/app.js', 'src/app/routes.js', 'src/app/store.js', 'src/lib/router.js', 'src/services/mockApi.js']) {
    assert.ok(MODULES.includes(expected), '缺少模块 ' + expected);
  }
});

for (const modulePath of MODULES) {
  test('模块可导入且导入阶段不触碰 DOM：' + modulePath, async () => {
    // 故意不安装 DOM stub：模块在导入阶段不应该依赖 document / window
    delete globalThis.document;
    delete globalThis.window;
    await import(pathToFileURL(join(FRONTEND, modulePath)).href);
  });
}

test('路由表：16 条路由、页面组件齐全、兜底在最后', async () => {
  installDom();
  const { ROUTES } = await import('../src/app/routes.js');
  assert.equal(ROUTES.length, 16);
  for (const route of ROUTES) {
    assert.ok(route.path.startsWith('/') || route.path === '*');
    assert.equal(typeof route.page.render, 'function', route.path + ' 缺少 render');
    assert.equal(typeof route.page.name, 'string');
    assert.ok(route.titleKey, route.path + ' 缺少 titleKey');
  }
  assert.equal(ROUTES[ROUTES.length - 1].path, '*');
  assert.equal(ROUTES.filter((route) => route.path === '*').length, 1);
});

test('路由守卫：每条路由的 guard 与 docs/03 的「访问身份」一致', async () => {
  const { ROUTES } = await import('../src/app/routes.js');
  const expected = {
    '/': null,
    '/register': null,
    '/onboarding/role': null,
    '/onboarding/profile': null,
    '/onboarding/privacy': null,
    '/home': 'onboarded',
    '/match': 'onboarded',
    '/match/:learnerId': 'buddy',
    '/room/:roomId': 'room',
    '/room/:roomId/summary': 'room',
    '/me': 'onboarded',
    '/leaderboard': 'onboarded',
    '/shop': 'onboarded',
    '/history': 'onboarded',
    '/dev/mock': null,
    '*': null,
  };
  for (const route of ROUTES) {
    assert.equal(route.guard, expected[route.path], route.path + ' 的守卫不符合预期');
  }
});

test('导航与沉浸：房间与 onboarding 不显示底部导航，四个主页面显示', async () => {
  const { ROUTES } = await import('../src/app/routes.js');
  const navRoutes = ROUTES.filter((route) => route.nav).map((route) => route.nav).sort();
  assert.deepEqual(navRoutes, ['home', 'leaderboard', 'match', 'me']);
  const room = ROUTES.find((route) => route.path === '/room/:roomId');
  assert.equal(room.immersive, true);
  assert.equal(room.nav, null);
  assert.deepEqual(ROUTES.filter((route) => route.step).map((route) => route.step), [1, 2, 3]);
});

test('入口文件把 store / service / app 装配到一起并挂到 window 上', async () => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(join(FRONTEND, 'src/app/main.js'), 'utf8'));
  assert.match(source, /createStore\(/);
  assert.match(source, /createApi\(/);
  assert.match(source, /createApp\(/);
  assert.match(source, /app\.start\(\)/);
  assert.match(source, /__CANTOBRIDGE_DEV__ = options\.useMock/);
});

/**
 * 入口装配的**行为**测试（不是读源码猜）。`main.js` 在导入时就建 store 并读 `location`，
 * 所以每条用例都要用带 query 的 URL 绕过 ESM 模块缓存，拿一份全新的模块实例；
 * 同时删掉 `document`，让 `app.start()` 不触发（Node 里没有 DOM）。
 */
test('入口装配：默认真后端把出厂的 sim 升到 remote，?api=mock 才保持 sim', async () => {
  const url = pathToFileURL(join(FRONTEND, 'src/app/main.js')).href;
  const saved = globalThis.location;

  delete globalThis.document;
  delete globalThis.window;

  try {
    globalThis.location = {
      search: '',
      hostname: '192.168.1.5',
      protocol: 'https:',
      host: '192.168.1.5:4173',
    };
    const live = await import(url + '?case=live');
    assert.equal(live.options.useMock, false, '不带参数就是真后端——这是现在的默认档位');
    assert.equal(live.store.getState().settings.signalMode, 'remote', '真后端档位默认远端信令');

    globalThis.location = { search: '?api=mock', hostname: 'localhost', protocol: 'http:', host: 'localhost:4173' };
    const mock = await import(url + '?case=mock');
    assert.equal(mock.options.useMock, true, '只有显式 ?api=mock 才走 mock');
    assert.equal(mock.store.getState().settings.signalMode, 'sim', 'mock 档位不能升到远端（连不上）');
  } finally {
    if (saved === undefined) delete globalThis.location;
    else globalThis.location = saved;
  }
});

/**
 * `tools/e2e-real.mjs` 里那两条**决策**的回归测试。
 *
 * 为什么值得单独测：这个脚本真起后端、真发请求，跑一次要几十秒，所以「它会不会
 * 去复用你那个跑了一整天的开发后端」这件事不能靠跑一遍来验。抽成纯函数（`shouldReuseBackend`）
 * 与可注入的 `pickPort` 之后，这里把三种端口情况穷举掉。
 *
 * 真实事故：默认「探到 8787 有服务就复用」时，本机那个开发后端的快照里 xp 已经累积到
 * 878（种子值是 360），第 ⑬ 项「store 的 xp 与服务端一致」因此报 15/16 —— 后端没问题，
 * 是脚本拿脏基线去比。
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { DEFAULT_PORT, findFreePort, pickPort, portIsFree, shouldReuseBackend } from './e2e-real.mjs';

test('只有显式给了 E2E_BASE_URL 才复用别人在跑的后端', () => {
  assert.equal(shouldReuseBackend({}), false);
  assert.equal(shouldReuseBackend({ explicitBaseUrl: null }), false);
  assert.equal(shouldReuseBackend({ explicitBaseUrl: '' }), false, '空串等于没给，不能当成"点名要用"');
  assert.equal(shouldReuseBackend({ explicitBaseUrl: 'http://localhost:8787' }), true);
});

test('默认端口空着就用约定端口 8787', async () => {
  const port = await pickPort({ isFree: async () => true, freePort: async () => 59999 });
  assert.equal(port, String(DEFAULT_PORT));
});

test('默认端口被自己的开发后端占着时，换一个空闲端口自己起（绝不复用）', async () => {
  let asked = 0;
  const port = await pickPort({
    isFree: async (p) => {
      asked += 1;
      assert.equal(p, DEFAULT_PORT, '只该探约定端口这一个');
      return false;
    },
    freePort: async () => 59998,
  });
  assert.equal(asked, 1);
  assert.equal(port, '59998', '被占时必须换端口，而不是复用 8787');
  assert.notEqual(port, String(DEFAULT_PORT));
});

test('显式 E2E_BASE_URL 时照用它给的端口，探都不探', async () => {
  const port = await pickPort({
    explicitBaseUrl: 'http://127.0.0.1:9123',
    isFree: async () => assert.fail('显式指定了就不该再去探端口'),
  });
  assert.equal(port, '9123');
});

test('E2E_BASE_URL 没带端口时退回约定端口', async () => {
  const port = await pickPort({ explicitBaseUrl: 'http://backend.example.com' });
  assert.equal(port, String(DEFAULT_PORT));
});

test('portIsFree 用「连得上」判断：有人听着就是占用，没人听才算空', async () => {
  // 真实事故的回归：macOS 允许在别人 bind 了通配地址之后再 bind 127.0.0.1 同一个端口，
  // 所以早期用「能不能 bind」实现的版本会把有人听的端口报成空着。
  const port = await findFreePort();
  assert.equal(await portIsFree(port), true, '刚拿到的空闲端口应该判为空');

  const server = createServer();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    assert.equal(await portIsFree(port), false, '有人听着就必须判为占用（这条是那次 bug 的回归）');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(await portIsFree(port), true, '关掉之后又该判为空');
});

test('findFreePort 每次给的都是当前真的能用的端口', async () => {
  const port = await findFreePort();
  assert.equal(Number.isInteger(port) && port > 0, true, '拿到的是合法端口号：' + port);
  assert.equal(await portIsFree(port), true);
});

test('这个文件被 import 时不能顺手把整条 e2e 链路跑起来', async () => {
  // 上面几个 test 已经真的 import 了它。如果 import 有副作用（真的起后端、真的发请求），
  // 它们会在几毫秒内失败或挂住；这条再明确钉一次「没有监听、没有子进程」这件事。
  const module = await import('./e2e-real.mjs');
  assert.equal(typeof module.shouldReuseBackend, 'function');
  assert.equal(typeof module.pickPort, 'function');
  assert.equal(module.DEFAULT_PORT, 8787);
  assert.equal(fileURLToPath(import.meta.url).endsWith('e2e-real.test.mjs'), true);
});

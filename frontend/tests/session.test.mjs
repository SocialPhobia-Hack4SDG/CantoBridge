import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession } from '../src/app/session.js';
import { createMemoryStorage, createStore } from '../src/app/store.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ signIn } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  const calls = [];
  const api = {
    async signIn(role) {
      calls.push(role);
      if (signIn) return signIn(role, store);
      store.setRole(role);
      return { userId: 'demo-01', role };
    },
  };
  return { store, api, calls, session: createSession({ api, store }) };
}

test('ensure()：按当前身份登录一次，重复调用是幂等的', async () => {
  const { store, calls, session } = setup();

  assert.equal(await session.ensure(), true, '第一次要真的登录');
  assert.deepEqual(calls, ['learner'], '用当前身份登录');
  assert.equal(await session.ensure(), false, '同一个身份不重复登录');
  assert.equal(calls.length, 1);

  store.setRole('buddy');
  assert.equal(await session.ensure(), true, '换了身份要重新登录（换令牌）');
  assert.deepEqual(calls, ['learner', 'buddy']);
});

test('ensure()：登录失败清掉占位，允许重试', async () => {
  let fail = true;
  const { calls, session } = setup({
    signIn: () => {
      if (fail) throw Object.assign(new Error('backend down'), { code: 'internal' });
      return { userId: 'demo-01', role: 'learner' };
    },
  });

  await assert.rejects(() => session.ensure(), /backend down/, '失败要抛出去，交给调用方决定');
  assert.equal(calls.length, 1);
  fail = false;
  assert.equal(await session.ensure(), true, '下一次还能再来');
  assert.equal(calls.length, 2);
});

test('ensure()：不会自己叫自己（signIn 内部会 setRole 触发订阅）', async () => {
  const { store, calls, session } = setup();
  session.attach();
  assert.equal(await session.ensure(), true);
  store.setRole('learner'); // 同身份再设一次
  await flush();
  assert.equal(calls.length, 1, '同身份的 setRole 不该再触发登录');
});

test('attach()：换身份时重新登录，登录成功后才回调 onReady（顺序不能反）', async () => {
  const order = [];
  const { store, calls, session } = setup({
    signIn: async (role, storeRef) => {
      order.push('signIn:' + role);
      storeRef.setRole(role);
      return { userId: 'demo-01', role };
    },
  });
  const unsubscribe = session.attach({ onReady: () => order.push('onReady') });
  assert.deepEqual(order, [], '订阅本身不做事');

  store.setRole('buddy');
  await flush();
  assert.deepEqual(order, ['signIn:buddy', 'onReady'], '先拿到令牌，再拉需要令牌的数据');
  assert.deepEqual(calls, ['buddy']);

  unsubscribe();
  store.setRole('learner');
  await flush();
  assert.equal(calls.length, 1, '退订后不再触发');
});

test('attach()：登录失败也不抛（离线 / 后端没起时静默降级）', async () => {
  const { store, session } = setup({
    signIn: () => {
      throw new Error('backend down');
    },
  });
  session.attach();
  store.setRole('buddy');
  await flush(); // 走到这里没抛异常就算过
  assert.equal(store.getState().role, 'buddy', '本地身份照样切过去了');
});

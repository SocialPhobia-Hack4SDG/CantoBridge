import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSocialSync } from '../src/app/socialSync.js';
import { createMemoryStorage, createStore } from '../src/app/store.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ listBuddies, listBuddyRequests } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  const calls = [];
  const api = {
    async listBuddies() {
      calls.push('listBuddies');
      if (listBuddies) return listBuddies();
      return [];
    },
    async listBuddyRequests() {
      calls.push('listBuddyRequests');
      if (listBuddyRequests) return listBuddyRequests();
      return [];
    },
  };
  return { store, api, calls, sync: createSocialSync({ api, store }) };
}

test('sync()：两张表都拉回来并灌进 store（打开即准）', async () => {
  const buddies = [{ peerId: 'siu-fung', label: 'siu-fung', since: '2026-09-29T08:00:00.000Z' }];
  const requests = [{ requestId: 'req-1', peerId: 'ka-ho', direction: 'incoming', status: 'pending' }];
  const { store, calls, sync } = setup({ listBuddies: () => buddies, listBuddyRequests: () => requests });

  assert.ok(await sync.sync(), '应当成功');
  assert.deepEqual(calls, ['listBuddies', 'listBuddyRequests'], '两张表都要拉');
  assert.deepEqual(store.getState().social.buddies, buddies);
  assert.deepEqual(store.getState().social.buddyRequests, requests);
});

test('sync()：失败静默（未登录 / 后端没起都不能拦住启动）', async () => {
  const { store, sync } = setup({
    listBuddies: () => {
      const error = new Error('missing bearer token');
      error.code = 'not_authorized';
      throw error;
    },
  });
  const before = store.getState().social;

  assert.equal(await sync.sync(), false, '失败返回 false，不抛错');
  assert.deepEqual(store.getState().social, before, '失败时不动本地镜像');
});

test('attach()：只在身份变化时再拉一次（同身份的其它状态变化不触发）', async () => {
  const { store, calls, sync } = setup();
  const unsubscribe = sync.attach();
  assert.deepEqual(calls, [], '订阅本身不触发请求');

  store.saveSettings({ anonymous: false });
  store.setLocale('en');
  await flush();
  assert.deepEqual(calls, [], '同身份的其它更新不拉着两张表');

  store.setRole('buddy');
  await flush();
  assert.deepEqual(calls, ['listBuddies', 'listBuddyRequests'], '换身份＝换令牌，重新对齐一次');

  store.setRole('learner');
  await flush();
  assert.equal(calls.length, 4, '再切回去还会拉一次');

  unsubscribe();
  store.setRole('buddy');
  await flush();
  assert.equal(calls.length, 4, '退订之后不再触发');
});

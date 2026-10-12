/** 骨架自检：健康检查 + 五张表都在（Phase 0 的验收点）。 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROLES } from '../src/data/vocabularies.js';
import { createSeed } from '../src/store/seed.js';
import { startTestServer } from './helpers/server.mjs';

test('GET /api/health：服务活着，五张表的计数能读到', async () => {
  const ui = await startTestServer();
  try {
    const res = await ui.request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.status, 'ok');
    assert.ok(res.json.data.version);
    assert.equal(typeof res.json.data.uptimeSec, 'number');
    // users / profiles / queue / rooms / relations 五张表都在
    assert.deepEqual(Object.keys(res.json.data.tables).sort(), ['profiles', 'queue', 'relations', 'rooms', 'users']);

    const tables = res.json.data.tables;
    // 期望计数从出厂种子取：种子改了这里跟着走，而不是把数字抄死在用例里
    const seed = createSeed();
    assert.equal(tables.users, seed.users.length);
    assert.equal(tables.profiles, seed.profiles.length);
    assert.equal(tables.relations, seed.relations.length);
    assert.equal(tables.queue, seed.queue.length);
    assert.equal(tables.rooms, seed.rooms.length);

    // **出厂全空**：没有账号、没有资料、没有队列——列表里不会出现编出来的人
    assert.equal(tables.users, 0);
    assert.equal(tables.profiles, 0);
    assert.equal(tables.queue, 0);
  } finally {
    await ui.close();
  }
});

test('GET /api/health：注册之后计数跟着涨（一个账号两份资料）', async () => {
  const ui = await startTestServer();
  try {
    await ui.signIn('learner', { deviceId: 'device-a' });
    await ui.signIn('learner', { deviceId: 'device-b' });
    const res = await ui.request('GET', '/api/health');
    const tables = res.json.data.tables;
    assert.equal(tables.users, 2, '两台设备两个账号');
    assert.equal(tables.profiles, 2 * ROLES.length, '一个账号两份资料');
  } finally {
    await ui.close();
  }
});

test('GET /api/health 之外：未知路径给 404 信封，不是 HTML 也不是崩溃', async () => {
  const ui = await startTestServer();
  try {
    const res = await ui.request('GET', '/api/health/extra');
    assert.equal(res.status, 404);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error.code, 'not_found');
  } finally {
    await ui.close();
  }
});

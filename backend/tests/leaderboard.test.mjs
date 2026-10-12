/**
 * 排行榜：**从真实账号的进度算**，没有任何预置行。
 *
 * 这份用例以前钉的是「后端 LEADERBOARD 与前端 fixtures 逐字段相等」——
 * 那份假榜单已经整份删掉了（榜单上不该出现不存在的账号）。现在钉的是真实行为：
 *   - 出厂空：一个账号都没有时，四张榜都是空数组（前端据此渲染空态）；
 *   - 累计对话时长超过五分钟才上榜；
 *   - 按 xp 降序、名次连续、`isMe` 只标自己；
 *   - 匿名 / 关掉榜单可见性 → 这一行显示成「匿名用户」，连 userId 都不下发。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANONYMOUS_LABEL,
  LEADERBOARD_LIMIT,
  LEADERBOARD_PERIODS,
} from '../src/data/leaderboard.js';
import { startTestServer } from './helpers/server.mjs';

test('五分钟边界与三十人上限：先筛资格，再按积分取前三十名', async () => {
  const ui = await startTestServer();
  try {
    const mine = await ui.signInAs('learner', { deviceId: 'limit-mine' });
    for (const minutes of [0, 5, 6]) {
      ui.db.updateProgress(mine.userId, { totalMinutes: minutes });
      for (const period of LEADERBOARD_PERIODS) for (const role of ['learner', 'buddy']) {
        const res = await ui.request('GET', `/api/leaderboard?period=${period}&role=${role}`, { token: mine.token });
        assert.equal(res.json.data.entries.length, minutes > 5 ? 1 : 0);
      }
    }
    ui.db.updateProgress(mine.userId, { xp: 1 });
    for (let i = 0; i < 32; i++) {
      const account = await ui.signInAs('learner', { deviceId: `limit-${i}` });
      ui.db.updateProgress(account.userId, { xp: 100 + i, totalMinutes: 6 });
    }
    const short = await ui.signInAs('learner', { deviceId: 'short-high-xp' });
    ui.db.updateProgress(short.userId, { xp: 9999, totalMinutes: 5 });
    for (const period of LEADERBOARD_PERIODS) for (const role of ['learner', 'buddy']) {
      const res = await ui.request('GET', `/api/leaderboard?period=${period}&role=${role}`, { token: mine.token });
      const rows = res.json.data.entries;
      assert.equal(rows.length, 30);
      assert.deepEqual(rows.map(row => row.rank), Array.from({ length: 30 }, (_, i) => i + 1));
      assert.equal(rows[0].xp, 131);
      assert.equal(rows.at(-1).xp, 102);
      assert.ok(rows.every(row => !row.isMe), '榜外本人不额外加入列表');
    }
  } finally { await ui.close(); }
});

test('榜单常量：周期取值固定，行数有上限，匿名占位与契约一致', () => {
  assert.deepEqual(LEADERBOARD_PERIODS, ['weekly', 'monthly']);
  assert.equal(ANONYMOUS_LABEL, '匿名用户');
  assert.equal(LEADERBOARD_LIMIT, 30);
});

test('榜上没有编出来的人：只有真实注册过的账号', async () => {
  const ui = await startTestServer();
  try {
    const { token } = await ui.signInAs('learner', { deviceId: 'device-a' });
    // 四张榜都只有自己一行——以前这里会混进 mingzhu / ka-ho 这些 fixtures 里的人
    for (const period of LEADERBOARD_PERIODS) {
      for (const role of ['learner', 'buddy']) {
        const res = await ui.request('GET', `/api/leaderboard?period=${period}&role=${role}`, { token });
        assert.equal(res.status, 200);
        const entries = res.json.data.entries;
        assert.equal(entries.length, 0, `${period}/${role} 新账号不上榜`);
      }
    }
  } finally {
    await ui.close();
  }
});

test('两台设备两个账号：都上榜，按 xp 降序，isMe 只标自己', async () => {
  const ui = await startTestServer();
  try {
    const a = await ui.signInAs('learner', { deviceId: 'device-a' });
    const b = await ui.signInAs('learner', { deviceId: 'device-b' });
    assert.notEqual(a.userId, b.userId, '两台设备必须是两个账号');

    ui.db.updateProgress(a.userId, { xp: 20, totalMinutes: 6, practiceMinutesThisWeek: 0 });
    // 给 B 一点进度：B 应当排在 A 前面
    ui.db.updateProgress(b.userId, { xp: 120, totalMinutes: 30, practiceMinutesThisWeek: 30 });

    const fromA = await ui.request('GET', '/api/leaderboard?role=learner', { token: a.token });
    const entries = fromA.json.data.entries;
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((row) => [row.rank, row.xp, row.isMe]),
      [
        [1, 120, false],
        [2, 20, true],
      ],
      '按 xp 降序，名次连续，只有自己那一行 isMe',
    );

    // 周榜看 practiceMinutesThisWeek，月榜看 totalMinutes
    const weekly = await ui.request('GET', '/api/leaderboard?period=weekly&role=learner', { token: a.token });
    assert.equal(weekly.json.data.entries[0].minutes, 30);
    const monthly = await ui.request('GET', '/api/leaderboard?period=monthly&role=learner', { token: a.token });
    assert.equal(monthly.json.data.entries[0].minutes, 30);
  } finally {
    await ui.close();
  }
});

test('匿名 / 关掉榜单可见性 → 显示「匿名用户」，不下发真实名字', async () => {
  const ui = await startTestServer();
  try {
    const mine = await ui.signInAs('learner', { deviceId: 'device-a' });
    const other = await ui.signInAs('learner', { deviceId: 'device-b' });
    ui.db.updateProgress(mine.userId, { totalMinutes: 6 });
    ui.db.updateProgress(other.userId, { totalMinutes: 6 });
    ui.db.updateSettings(other.userId, { anonymous: true });

    const res = await ui.request('GET', '/api/leaderboard?role=learner', { token: mine.token });
    const rows = res.json.data.entries;
    const anon = rows.find((row) => !row.isMe);
    assert.equal(anon.userId, ANONYMOUS_LABEL, '匿名行连 userId 都换成占位');
    assert.equal(anon.anonymous, true);

    // 关掉 leaderboardVisible 是另一条进匿名榜的路（契约 4.7）
    ui.db.updateSettings(mine.userId, { leaderboardVisible: false });
    const after = await ui.request('GET', '/api/leaderboard?role=learner', { token: mine.token });
    const meRow = after.json.data.entries.find((row) => row.isMe);
    assert.equal(meRow.userId, ANONYMOUS_LABEL);
    assert.equal(meRow.anonymous, true);
  } finally {
    await ui.close();
  }
});

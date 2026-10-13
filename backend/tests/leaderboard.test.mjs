import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEADERBOARD_LIMIT, LEADERBOARD_PERIODS, ANONYMOUS_LABEL } from '../src/data/leaderboard.js';
import { startTestServer } from './helpers/server.mjs';
function record(ui, account, role, seconds, cards = 0) {
  ui.db.appendHistory(account.userId, { sessionId: Math.random().toString(), role, durationSec: seconds, cardsUsed: cards, startedAt: new Date().toISOString() });
}
test('29 秒不上榜，30 秒和 31 秒上榜；教授者与学习者独立计分', async () => {
  const ui = await startTestServer(); try {
    const account = await ui.signInAs('learner');
    record(ui, account, 'learner', 29); record(ui, account, 'buddy', 30);
    const board = async role => (await ui.request('GET', '/api/leaderboard?role=' + role, { token: account.token })).json.data.entries;
    assert.equal((await board('learner')).length, 0);
    assert.equal((await board('buddy')).length, 1);
    record(ui, account, 'learner', 1);
    assert.equal((await board('learner'))[0].minutes, .5);
    record(ui, account, 'learner', 1);
    assert.equal((await board('buddy'))[0].xp, 3);
  } finally { await ui.close(); }
});
test('榜单周期、匿名标签与三十名上限常量保持一致', () => {
  assert.deepEqual(LEADERBOARD_PERIODS, ['weekly','monthly']); assert.equal(LEADERBOARD_LIMIT, 30); assert.equal(ANONYMOUS_LABEL, '匿名用户');
});
test('新注册账号的四张榜都是空的', async () => {
  const ui = await startTestServer(); try {
    const a = await ui.signInAs('learner');
    for (const period of LEADERBOARD_PERIODS) for (const role of ['learner','buddy']) assert.equal((await ui.request('GET', `/api/leaderboard?period=${period}&role=${role}`, { token: a.token })).json.data.entries.length, 0);
  } finally { await ui.close(); }
});
test('两台设备独立排名，账号总积分不会混入角色通话积分', async () => {
  const ui = await startTestServer(); try {
    const a = await ui.signInAs('learner', { deviceId: 'a' }); const b = await ui.signInAs('learner', { deviceId: 'b' });
    record(ui, a, 'learner', 30); record(ui, b, 'learner', 60, 1); record(ui, a, 'buddy', 600);
    ui.db.updateProgress(a.userId, { xp: 9999 });
    const rows = (await ui.request('GET', '/api/leaderboard?role=learner', { token: a.token })).json.data.entries;
    assert.deepEqual(rows.map(row => [row.rank,row.xp,row.isMe]), [[1,11,false],[2,3,true]]);
  } finally { await ui.close(); }
});
test('超过三十人只展示前三十名，匿名不泄露用户名', async () => {
  const ui = await startTestServer(); try {
    const a = await ui.signInAs('learner', { deviceId: 'mine' }); record(ui, a, 'learner', 30);
    for (let i=0;i<32;i++) { const user = await ui.signInAs('learner', { deviceId: 'other-'+i }); record(ui, user, 'learner', 60+i*10); ui.db.updateSettings(user.userId, { anonymous: true }); }
    const rows = (await ui.request('GET', '/api/leaderboard?role=learner', { token: a.token })).json.data.entries;
    assert.equal(rows.length,30); assert.deepEqual(rows.map(row=>row.rank), Array.from({length:30},(_,i)=>i+1));
    assert.ok(rows.every(row=>row.anonymous && row.userId===ANONYMOUS_LABEL && !row.isMe));
    ui.db.updateSettings(a.userId, { leaderboardVisible: false });
    record(ui,a,'learner',6000);
    const mine = (await ui.request('GET','/api/leaderboard?role=learner',{token:a.token})).json.data.entries[0];
    assert.equal(mine.isMe,true);assert.equal(mine.userId,ANONYMOUS_LABEL);
  } finally { await ui.close(); }
});

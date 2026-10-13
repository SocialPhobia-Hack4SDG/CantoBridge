import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaderboardStats as backend } from '../backend/src/lib/leaderboard.js';
import { leaderboardStats as frontend } from '../frontend/src/lib/leaderboard.js';
import { startTestServer } from '../backend/tests/helpers/server.mjs';
const now = Date.parse('2026-10-13T04:00:00Z');
test('香港周一与月初边界准确，角色切换不混用秒数与积分', () => {
  const entries = [
    { role:'learner',startedAt:'2026-10-11T15:59:59Z',durationSec:60,cardsUsed:0 },
    { role:'learner',startedAt:'2026-10-11T16:00:00Z',durationSec:30,cardsUsed:0 },
    { role:'buddy',startedAt:'2026-10-12T00:00:00Z',durationSec:90,cardsUsed:1 },
    { role:'learner',startedAt:'2026-09-30T15:59:59Z',durationSec:999,cardsUsed:0 },
    { role:'learner',startedAt:'2026-10-14T00:00:00Z',durationSec:999,cardsUsed:0 },
  ];
  for (const compute of [backend,frontend]) {
    assert.deepEqual(compute(entries,'learner','weekly',now),{seconds:30,minutes:.5,xp:3});
    assert.deepEqual(compute(entries,'learner','monthly',now),{seconds:90,minutes:1.5,xp:9});
    assert.deepEqual(compute(entries,'buddy','weekly',now),{seconds:90,minutes:1.5,xp:14});
  }
});
test('真实通话结算30秒后双方各自上榜，重放结算不会重复计分', async () => {
  const ui = await startTestServer({ now:()=>now });
  try {
    const a=await ui.signInAs('learner',{deviceId:'l'});const b=await ui.signInAs('buddy',{deviceId:'b'});
    ui.db.createRoom({roomId:'rank-call',status:'active',initiatorAccountId:a.userId,peerAccountId:b.userId,peerRole:'buddy',startedAt:new Date(now-30000).toISOString()});
    const ended=await ui.request('POST','/api/rooms/rank-call/end',{token:a.token,body:{durationSec:30,cardsUsed:0}});
    assert.equal(ended.status,200);
    await ui.request('POST','/api/rooms/rank-call/end',{token:b.token,body:{durationSec:30,cardsUsed:0}});
    for(const [role,token] of [['learner',a.token],['buddy',b.token]]) {
      const rows=(await ui.request('GET','/api/leaderboard?role='+role,{token})).json.data.entries;
      assert.equal(rows.length,1);assert.equal(rows[0].isMe,true);assert.equal(rows[0].xp,3);assert.equal(rows[0].minutes,.5);
    }
  } finally {await ui.close();}
});

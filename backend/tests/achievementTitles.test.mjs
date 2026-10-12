import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';
import { peerViewOf } from '../src/domain/peerView.js';
import { createDb } from '../src/store/db.js';
import { achievementStatistics } from '../src/lib/achievementTitles.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

test('已佩戴称号在服务重启后保留，老账号未设置时返回空称号',async()=>{
 const file=join(tmpdir(),`cantobridge-title-${randomUUID()}.json`);
 const ui=await startTestServer({dataFile:file});
 try {
  const me=await ui.signInAs('learner');
  assert.equal(peerViewOf(ui.db,me.userId,'learner').equippedTitleId,null);
  ui.db.updateProgress(me.userId,{conversations:5});
  await ui.request('PUT','/api/me/settings',{token:me.token,body:{equippedTitleId:'conversation_starter'}});
  const restarted=createDb({filePath:file});
  assert.equal(peerViewOf(restarted,me.userId,'learner').equippedTitleId,'conversation_starter');
 } finally {await ui.close();rmSync(file,{force:true});}
});

test('称号需解锁、一次一项、可卸下，排队和两种身份展示同步', async () => {
 const ui=await startTestServer();
 try {
  const me=await ui.signInAs('learner');
  for(const id of ['first_conversation','fake-title',42,['first_conversation']]) {
   const rejected=await ui.request('PUT','/api/me/settings',{token:me.token,body:{equippedTitleId:id}});
   assert.equal(rejected.status,400);
  }
  ui.db.updateProgress(me.userId,{conversations:10,totalMinutes:40});
  await ui.request('POST','/api/match/queue',{token:me.token,body:{}});
  const viewer=await ui.signInAs('buddy',{deviceId:'title-viewer'});
  for(const id of ['first_conversation','conversation_regular']) {
   const saved=await ui.request('PUT','/api/me/settings',{token:me.token,body:{equippedTitleId:id}});
   assert.equal(saved.status,200);
   assert.equal(saved.json.data.settings.equippedTitleId,id);
   assert.equal(peerViewOf(ui.db,me.userId,'learner').equippedTitleId,id);
   assert.equal(peerViewOf(ui.db,me.userId,'buddy').equippedTitleId,id);
   const candidates=await ui.request('GET','/api/match/queue',{token:viewer.token});
   assert.equal(candidates.status,200);
   assert.ok(JSON.stringify(candidates.json.data).includes(id), '匹配候选接口展示实时佩戴称号');
   const progress=await ui.request('GET','/api/me/progress',{token:me.token});
   assert.equal(progress.json.data.equippedTitleId,id);
  }
  await ui.request('PUT','/api/me/settings',{token:me.token,body:{equippedTitleId:null}});
  assert.equal(peerViewOf(ui.db,me.userId,'learner').equippedTitleId,null);
 } finally {await ui.close();}
});

test('获得人数按真实账号去重，比例按全部注册用户计算且最低0.01%',async()=>{
 assert.equal(achievementStatistics(createDb()).first_conversation.count,0);
 assert.equal(achievementStatistics(createDb()).first_conversation.percentage,0.01);
 const ui=await startTestServer();
 try {
  const a=await ui.signInAs('learner',{deviceId:'a'});
  await ui.signInAs('buddy',{deviceId:'a'});
  await ui.signInAs('learner',{deviceId:'b'});
  ui.db.updateProgress(a.userId,{conversations:5});
  const response=await ui.request('GET','/api/me/progress',{token:a.token});
  const stats=response.json.data.achievementStats;
  assert.deepEqual(stats.conversation_starter,{count:1,totalUsers:2,percentage:50});
  assert.deepEqual(stats.conversation_regular,{count:0,totalUsers:2,percentage:0.01});
 } finally {await ui.close();}
});

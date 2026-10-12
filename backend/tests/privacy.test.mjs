import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers/server.mjs';
import { peerViewOf } from '../src/domain/peerView.js';
test('隐藏标签保留头像，匿名切换裁剪姓名并同步已有队列、两份身份和榜单', async () => {
  const ui = await startTestServer();
  try {
    const { userId, token } = await ui.signInAs('learner');
    await ui.request('PUT', '/api/me/profile/learner', { token, body: { displayName: '不能泄露姓名', avatarId: 'female', nativeLanguage: 'english', cantoneseLevel: 'beginner', identity: 'university_student', interests: ['food'] } });
    const peerId = ui.db.getProfile(userId, 'learner').userId;
    const visibility = { nativeLanguage: false, level: false, identity: false, interests: false };
    assert.equal((await ui.request('PUT', '/api/me/settings', { token, body: { visibility } })).status, 200);
    const hidden = peerViewOf(ui.db, userId, 'learner');
    assert.equal(hidden.avatarId, 'female'); assert.equal(hidden.displayName, '不能泄露姓名');
    assert.deepEqual(hidden.interests, []); assert.equal(hidden.cantoneseLevel, null); assert.equal(hidden.nativeLanguage, null); assert.equal(hidden.identity, null);
    ui.db.upsertQueueRow({ ...ui.db.getProfile(userId, 'learner'), userId: peerId, ownerAccountId: userId, anonymous: false, visibility: {} });
    assert.equal((await ui.request('PUT', '/api/me/settings', { token, body: { anonymous: true, visibility } })).status, 200);
    const queued = peerViewOf(ui.db, peerId, 'learner');
    assert.equal(queued.anonymous, true); assert.equal(queued.displayName, null); assert.deepEqual(queued.interests, []);
    const me = (await ui.request('GET', '/api/me', { token })).json.data;
    assert.equal(me.settings.anonymous, true); assert.equal(me.learnerProfile.displayName, '不能泄露姓名');
    const buddy = peerViewOf(ui.db, userId, 'buddy'); assert.equal(buddy.anonymous, true); assert.equal(buddy.displayName, null);
    ui.db.updateProgress(userId, { totalMinutes: 6 });
    const leaderboard = await ui.request('GET', '/api/leaderboard?period=weekly&role=learner', { token });
    assert.ok(JSON.stringify(leaderboard.json.data).includes('匿名用户')); assert.ok(!JSON.stringify(leaderboard.json.data).includes('不能泄露姓名'));
    await ui.request('PUT', '/api/me/settings', { token, body: { anonymous: false } });
    assert.equal(peerViewOf(ui.db, peerId, 'learner').displayName, '不能泄露姓名');
  } finally { await ui.close(); }
});

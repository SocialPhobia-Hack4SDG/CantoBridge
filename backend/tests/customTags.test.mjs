import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers/server.mjs';
import { peerViewOf } from '../src/domain/peerView.js';

test('两种身份的自定义兴趣：保存读回、去重、Unicode边界和非法输入校验', async () => {
  const ui = await startTestServer();
  try {
    for (const role of ['learner', 'buddy']) {
      const token = await ui.signIn(role);
      if (role === 'learner') {
        for (const language of [' 日语 ', '😀'.repeat(10), 'english', 'other', null]) {
          const saved = await ui.request('PUT', '/api/me/profile/learner', { token, body: { nativeLanguage: language } });
          assert.equal(saved.status, 200);
          const read = await ui.request('GET', '/api/me', { token });
          assert.equal(read.json.data.learnerProfile.nativeLanguage, language?.trim() ?? null);
        }
        for (const language of ['', '  ', '😀'.repeat(11), 123, ['日语'], 'a\nb']) {
          const rejected = await ui.request('PUT', '/api/me/profile/learner', { token, body: { nativeLanguage: language } });
          assert.equal(rejected.status, 400);
        }
      }
      const path = '/api/me/profile/' + role;
      const owner = ui.db.findUserByDeviceId('device-default').userId;
      const peerId = ui.db.getProfile(owner, role).userId;
      ui.db.upsertQueueRow({ userId: peerId, ownerAccountId: owner, role, anonymous: false });
      const nameResponse = await ui.request('PUT', path, { token, body: { displayName: ' 港语同学 ' } });
      assert.equal(nameResponse.status, 200);
      const named = await ui.request('GET', '/api/me', { token });
      assert.equal(named.json.data.learnerProfile.displayName, '港语同学');
      assert.equal(named.json.data.buddyProfile.displayName, '港语同学');
      assert.equal(ui.db.getUser(named.json.data.userId).displayName, '港语同学');
      assert.equal(peerViewOf(ui.db, peerId, role).displayName, '港语同学', '正在排队的公开名称同步更新');
      ui.db.upsertQueueRow({ userId: peerId, anonymous: true });
      assert.equal(peerViewOf(ui.db, peerId, role).displayName, null, '匿名状态不泄露新名字');
      for (const displayName of ['a', ' '.repeat(3), '😀'.repeat(17), 'a\nb', null, 123]) {
        const invalidName = await ui.request('PUT', path, { token, body: { displayName } });
        assert.equal(invalidName.status, 400);
      }
      const boundary = await ui.request('PUT', path, { token, body: { displayName: '😀'.repeat(16) } });
      assert.equal(boundary.status, 200);
      const interests = ['food', 'hong_kong_culture', '😀'.repeat(10), '陶艺'];
      const saved = await ui.request('PUT', path, { token, body: { interests: [...interests, ' 陶艺 '] } });
      assert.equal(saved.status, 200);
      const me = await ui.request('GET', '/api/me', { token });
      assert.deepEqual(me.json.data[role + 'Profile'].interests, interests);
      for (const invalid of [['😀'.repeat(11)], ['   '], [42], ['a\nb'], ['a','b','c','d','e','f'], '陶艺']) {
        const response = await ui.request('PUT', path, { token, body: { interests: invalid } });
        assert.equal(response.status, 400, JSON.stringify(invalid));
        assert.equal(response.json.error.code, 'bad_request');
      }
      const after = await ui.request('GET', '/api/me', { token });
      assert.deepEqual(after.json.data[role + 'Profile'].interests, interests, '失败更新不覆盖原资料');
    }
  } finally { await ui.close(); }
});

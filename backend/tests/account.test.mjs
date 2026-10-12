/**
 * Phase 1 用例：注册 / 拿账号 / 写两份资料 / 写设置 / 重置。
 *
 * 这里盯住两件事：
 *   1. **双身份模型**（契约 2.3 / 2.4）：账号只有一份，资料有两份（learner / buddy），
 *      两行分开存、分开改，谁都不覆盖谁；
 *   2. **一台设备一个账号**：`deviceId` 是账号的钥匙。同一台设备刷新 / 换身份还是
 *      同一个人，两台设备则是两个账号——「有谁注册了就看见谁」的前提。
 *
 * 期望值尽量从 seed.js 的工厂函数取，而不是把字段名和初值抄一遍——
 * 出厂数据改了，这里跟着走，不会假装通过。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_BUDDY_TOPICS, MAX_INTERESTS, NATIVE_LANGUAGES, ROLES } from '../src/data/vocabularies.js';
import { DEVICE_ID_MAX, createProgress, createSettings, profileIdFor } from '../src/store/seed.js';
import { startTestServer } from './helpers/server.mjs';

/** 资料的公开字段：`accountId` / `role` 是服务端内部字段，不下发（契约 2.3 / 2.4）。 */
const INTERNAL_PROFILE_KEYS = ['accountId', 'role'];

test('POST /api/auth/session：按 deviceId 建账号，返回令牌与身份', async () => {
  const ui = await startTestServer();
  try {
    const res = await ui.request('POST', '/api/auth/session', { body: { role: 'learner', deviceId: 'device-a' } });
    assert.equal(res.status, 201, '一键进入是「新建了会话」，按契约回 201');
    assert.equal(res.json.ok, true);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['expiresAt', 'role', 'token', 'userId']);
    const { token, expiresAt, userId, role } = res.json.data;
    assert.ok(token.length > 0, '要不透明令牌');
    assert.ok(userId.length > 0, '要真的建出一个账号 id');
    assert.equal(role, 'learner');
    assert.ok(Date.parse(expiresAt) > Date.now(), 'expiresAt 要在将来');

    // 选身份 ≠ 完成注册：两份资料都还是出厂全空（和前端 createDefaultState 的约定一致）
    for (const roleName of ROLES) {
      const profile = ui.db.getProfile(userId, roleName);
      assert.equal(profile.onboarded, false, `${roleName} 资料不该因为选身份就算填过`);
      assert.deepEqual(profile.interests, [], `${roleName} 资料仍然出厂全空`);
    }

    // 换成母语者身份：换一个令牌，但**还是同一个账号**、两份资料依旧各归各的
    const buddy = await ui.request('POST', '/api/auth/session', { body: { role: 'buddy', deviceId: 'device-a' } });
    assert.equal(buddy.status, 201);
    assert.equal(buddy.json.data.role, 'buddy');
    assert.notEqual(buddy.json.data.token, token, '换身份＝换一个令牌');
    assert.equal(buddy.json.data.userId, userId, '同一台设备换身份不该换人');
    assert.equal(ui.db.getProfile(userId, 'learner').onboarded, false);
  } finally {
    await ui.close();
  }
});

test('POST /api/auth/session：两台设备两个账号——「有谁注册了就看见谁」的前提', async () => {
  const ui = await startTestServer();
  try {
    const a = await ui.signInAs('learner', { deviceId: 'device-a' });
    const b = await ui.signInAs('buddy', { deviceId: 'device-b' });
    assert.notEqual(a.userId, b.userId, '两台设备必须是两个账号');

    // 刷新（同一个 deviceId 再来一次）不会换人，只会换令牌
    const again = await ui.signInAs('learner', { deviceId: 'device-a' });
    assert.equal(again.userId, a.userId, '同一台设备刷新要落回同一个人');
    assert.notEqual(again.token, a.token, '但令牌是新的');

    // 两台设备的资料 id 也是各自的：learner-<账号A> / buddy-<账号B>
    assert.equal(ui.db.getProfile(a.userId, 'learner').userId, profileIdFor(a.userId, 'learner'));
    assert.equal(ui.db.getProfile(b.userId, 'buddy').userId, profileIdFor(b.userId, 'buddy'));
    assert.equal(ui.db.count('users'), 2, '只建了两个账号');
    assert.equal(ui.db.count('profiles'), 4, '一个账号两份资料');
  } finally {
    await ui.close();
  }
});

test('POST /api/auth/session：缺 role / 缺 deviceId / 取值越界 / 多余字段都报 400', async () => {
  const ui = await startTestServer();
  try {
    const missing = await ui.request('POST', '/api/auth/session', { body: { deviceId: 'device-a' } });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, 'bad_request');
    assert.match(missing.json.error.message, /role/);

    // null 与缺失同义：契约里 role 必填
    const nullRole = await ui.request('POST', '/api/auth/session', { body: { role: null, deviceId: 'device-a' } });
    assert.equal(nullRole.status, 400);
    assert.match(nullRole.json.error.message, /role/);

    const bad = await ui.request('POST', '/api/auth/session', { body: { role: 'teacher', deviceId: 'device-a' } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error.message, /role/);

    // deviceId 也是必填：没有它服务端分不清这是哪台设备，只能所有人共用一个账号
    const noDevice = await ui.request('POST', '/api/auth/session', { body: { role: 'learner' } });
    assert.equal(noDevice.status, 400);
    assert.match(noDevice.json.error.message, /deviceId/);

    const emptyDevice = await ui.request('POST', '/api/auth/session', { body: { role: 'learner', deviceId: '' } });
    assert.equal(emptyDevice.status, 400);
    assert.match(emptyDevice.json.error.message, /deviceId/);

    const longDevice = await ui.request('POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: 'x'.repeat(DEVICE_ID_MAX + 1) },
    });
    assert.equal(longDevice.status, 400);
    assert.match(longDevice.json.error.message, /deviceId/);

    const extra = await ui.request('POST', '/api/auth/session', {
      body: { role: 'buddy', deviceId: 'device-a', speakerType: 'native' },
    });
    assert.equal(extra.status, 400, '旧模型的 speakerType 不该被静默接受');
    assert.match(extra.json.error.message, /unknown field/);

    // 校验失败不该建出半个账号
    assert.equal(ui.db.count('users'), 0);
  } finally {
    await ui.close();
  }
});

test('POST /api/auth/logout：作废当前这条令牌，账号与另一条会话照旧', async () => {
  const ui = await startTestServer();
  try {
    // 同一台设备上先拿两个身份各一条令牌：退出只该作废「这一条」
    const learner = await ui.signInAs('learner');
    const buddy = await ui.signInAs('buddy');
    assert.equal(learner.userId, buddy.userId, '同一台设备＝同一个账号，先确认前提');
    const sessionsBefore = ui.db.count('sessions');

    const res = await ui.request('POST', '/api/auth/logout', { token: learner.token, body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data), ['ok']);
    assert.equal(res.json.data.ok, true);

    // 令牌表少一条；被作废的令牌立刻失效
    assert.equal(ui.db.count('sessions'), sessionsBefore - 1, '只删掉这一条会话');
    const stale = await ui.request('GET', '/api/me', { token: learner.token });
    assert.equal(stale.status, 401);
    assert.equal(stale.json.error.code, 'not_authorized');

    // 同账号的另一条令牌（换了身份的 buddy）不受影响：退出≠注销账号
    const stillValid = await ui.request('GET', '/api/me', { token: buddy.token });
    assert.equal(stillValid.status, 200, '同账号的其它会话不该被牵连');
    assert.equal(stillValid.json.data.userId, learner.userId, '账号本身还在，退出只是这条会话的事');

    // 重复退出：令牌已经没了，回 401 而不是 500（前端拿到 401 也会把本地令牌清干净）
    const again = await ui.request('POST', '/api/auth/logout', { token: learner.token, body: {} });
    assert.equal(again.status, 401);
    assert.equal(again.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

test('POST /api/auth/logout：缺令牌 / 坏令牌 401，多余字段 400', async () => {
  const ui = await startTestServer();
  try {
    const missing = await ui.request('POST', '/api/auth/logout', { body: {} });
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error.code, 'not_authorized');

    const bad = await ui.request('POST', '/api/auth/logout', { token: 'not-a-real-token', body: {} });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error.code, 'not_authorized');

    // 字段契约：这个口子不吃任何业务字段（`requestId` 由幂等层忽略）
    const token = await ui.signIn('learner');
    const extra = await ui.request('POST', '/api/auth/logout', { token, body: { deviceId: 'device-default' } });
    assert.equal(extra.status, 400);
    assert.match(extra.json.error.message, /unknown field/);
    // 校验失败不该顺手把人退出去
    const me = await ui.request('GET', '/api/me', { token });
    assert.equal(me.status, 200, '400 之后令牌仍然有效');
  } finally {
    await ui.close();
  }
});

test('GET /api/me：一次回两份资料 + 设置 + 进度', async () => {
  const ui = await startTestServer();
  try {
    const session = await ui.signInAs('learner');
    const token = session.token;
    const accountId = session.userId;
    const res = await ui.request('GET', '/api/me', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), [
      'buddyProfile',
      'learnerProfile',
      'progress',
      'settings',
      'userId',
    ]);
    const { userId, learnerProfile, buddyProfile, settings, progress } = res.json.data;

    assert.equal(userId, accountId);
    // 两份资料一次给全，各自的 userId 不同（前端 learnerProfile / buddyProfile 的 id 就是它们）
    assert.equal(learnerProfile.userId, profileIdFor(accountId, 'learner'));
    assert.equal(buddyProfile.userId, profileIdFor(accountId, 'buddy'));
    assert.notEqual(learnerProfile.userId, buddyProfile.userId);

    for (const [name, profile] of [['learnerProfile', learnerProfile], ['buddyProfile', buddyProfile]]) {
      for (const key of INTERNAL_PROFILE_KEYS) {
        assert.equal(key in profile, false, `${name} 不该下发内部字段 ${key}`);
      }
    }

    // 学习者资料：出厂全空（有母语 / 水平 / 目标 / 身份 / 兴趣五个字段）
    assert.deepEqual(
      {
        nativeLanguage: learnerProfile.nativeLanguage,
        cantoneseLevel: learnerProfile.cantoneseLevel,
        learningGoal: learnerProfile.learningGoal,
        identity: learnerProfile.identity,
        interests: learnerProfile.interests,
        onboarded: learnerProfile.onboarded,
      },
      { nativeLanguage: null, cantoneseLevel: null, learningGoal: null, identity: null, interests: [], onboarded: false },
    );
    // 母语者资料：另一套字段，同样是空的
    assert.deepEqual(buddyProfile, {
      userId: profileIdFor(accountId, 'buddy'),
      avatarId: 'neutral', frameId: 'none',
      languagesSpoken: [],
      identity: null,
      interests: [],
      preferredTopics: [],
      wantToLearn: [],
      onboarded: false,
    });

    // 设置与进度逐字段等于出厂值：顺带证明内部字段 accountId 没有泄漏出去
    assert.deepEqual(settings, createSettings());
    assert.deepEqual(progress, { ...createProgress(), wallet: { balance: 0, ownedThemes: ['mint', 'warm'], transactions: [], ownedAvatars: ['neutral', 'male', 'female'], ownedFrames: ['none'] } });
    assert.equal('feedbackCount' in progress, false, '进度的字段以契约 2.7 为准，没有 feedbackCount');
  } finally {
    await ui.close();
  }
});

test('PUT /api/me/profile/learner：部分更新回整份资料，写完即完成注册', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');

    const first = await ui.request('PUT', '/api/me/profile/learner', {
      token,
      body: { interests: ['anime', 'food'] },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(Object.keys(first.json.data), ['learnerProfile'], '响应字段就是契约里写的那一个');
    assert.deepEqual(first.json.data.learnerProfile.interests, ['anime', 'food']);
    assert.equal(first.json.data.learnerProfile.onboarded, true, '写成功即完成注册');
    assert.equal(first.json.data.learnerProfile.cantoneseLevel, null, '没传的字段保持原值');
    assert.equal('accountId' in first.json.data.learnerProfile, false);

    const second = await ui.request('PUT', '/api/me/profile/learner', {
      token,
      body: { cantoneseLevel: 'elementary', learningGoal: 'make_local_friends', identity: 'exchange_student' },
    });
    assert.equal(second.json.data.learnerProfile.cantoneseLevel, 'elementary');
    assert.deepEqual(second.json.data.learnerProfile.interests, ['anime', 'food'], '部分更新不覆盖别的字段');

    // 刷新一次拿到的还是这份资料
    const me = await ui.request('GET', '/api/me', { token });
    assert.deepEqual(me.json.data.learnerProfile, second.json.data.learnerProfile);
  } finally {
    await ui.close();
  }
});

test('两份资料互不覆盖：写 learner 不动 buddy，写 buddy 不动 learner', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const accountId = ui.accountIdOf();
    const buddyBefore = createBuddyExpected(accountId);

    await ui.request('PUT', '/api/me/profile/learner', {
      token,
      body: { nativeLanguage: 'english', cantoneseLevel: 'beginner', interests: ['anime', 'food'] },
    });

    // ① 写学习者资料：母语者那一行原样不动（连 onboarded 都不该被顺带打开）
    const afterLearner = ui.db.getProfile(accountId, 'buddy');
    assert.deepEqual(stripInternal(afterLearner), buddyBefore, '写一份资料不许碰另一份');

    // ② 写母语者资料：学习者那一行同样原样
    const learnerAfterFirstWrite = stripInternal(ui.db.getProfile(accountId, 'learner'));
    await ui.request('PUT', '/api/me/profile/buddy', {
      token,
      body: { languagesSpoken: ['yue', 'english'], identity: 'working_professional', interests: ['movies'] },
    });
    assert.deepEqual(
      stripInternal(ui.db.getProfile(accountId, 'learner')),
      learnerAfterFirstWrite,
      '写另一份资料不许碰学习者那一行',
    );

    // ③ 一次请求同时看到两份：各自都是自己写进去的内容
    const me = await ui.request('GET', '/api/me', { token });
    assert.deepEqual(me.json.data.learnerProfile.interests, ['anime', 'food']);
    assert.deepEqual(me.json.data.buddyProfile.interests, ['movies']);
    assert.deepEqual(me.json.data.buddyProfile.languagesSpoken, ['yue', 'english']);
    assert.equal(me.json.data.learnerProfile.onboarded, true);
    assert.equal(me.json.data.buddyProfile.onboarded, true, '两份资料各自记自己的 onboarded');
  } finally {
    await ui.close();
  }
});

test('PUT /api/me/profile/buddy：另一套字段（会说语言 / 想聊话题 / 回礼）', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('buddy');
    const res = await ui.request('PUT', '/api/me/profile/buddy', {
      token,
      body: {
        languagesSpoken: ['yue', 'mandarin'],
        identity: 'university_student',
        interests: ['movies', 'gaming'],
        preferredTopics: ['hong_kong_food', 'university_life'],
        wantToLearn: ['mandarin'],
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data), ['buddyProfile']);
    const profile = res.json.data.buddyProfile;
    assert.equal(profile.userId, profileIdFor(ui.accountIdOf(), 'buddy'));
    assert.deepEqual(profile.languagesSpoken, ['yue', 'mandarin']);
    assert.deepEqual(profile.preferredTopics, ['hong_kong_food', 'university_life']);
    assert.deepEqual(profile.wantToLearn, ['mandarin'], '回礼：母语词表去掉 yue 之后的值');
    assert.equal(profile.onboarded, true);
    assert.equal(profile.nativeLanguage, undefined, '母语者资料里没有学习者那套字段');

    // 「没传的字段保持原值」在这里同样成立
    const second = await ui.request('PUT', '/api/me/profile/buddy', { token, body: { identity: 'new_to_hong_kong' } });
    assert.deepEqual(second.json.data.buddyProfile.interests, ['movies', 'gaming']);
    assert.deepEqual(second.json.data.buddyProfile.languagesSpoken, ['yue', 'mandarin']);
  } finally {
    await ui.close();
  }
});

test('PUT /api/me/profile/learner：越界值一律 400，并且说清是哪个字段', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');

    const tooMany = await ui.request('PUT', '/api/me/profile/learner', {
      token,
      body: { interests: ['movies', 'anime', 'gaming', 'music', 'food', 'travel'] },
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.json.error.code, 'bad_request');
    assert.match(tooMany.json.error.message, new RegExp(`interests allows at most ${MAX_INTERESTS}`));

    const unknownValue = await ui.request('PUT', '/api/me/profile/learner', {
      token,
      body: { cantoneseLevel: 'native' },
    });
    assert.equal(unknownValue.status, 400);
    assert.match(unknownValue.json.error.message, /cantoneseLevel/);

    // 母语支持自定义字符串，但仍然是单选，不接受数组。
    const invalidNative = await ui.request('PUT', '/api/me/profile/learner', { token, body: { nativeLanguage: ['日语', '法语'] } });
    assert.equal(invalidNative.status, 400);
    assert.match(invalidNative.json.error.message, /nativeLanguage/);

    const unknownField = await ui.request('PUT', '/api/me/profile/learner', { token, body: { nickname: '小明' } });
    assert.equal(unknownField.status, 400);
    assert.match(unknownField.json.error.message, /unknown field/);

    // 母语者那套字段不能从这个口子写进来（两份资料的字段集合是分开的）
    const buddyField = await ui.request('PUT', '/api/me/profile/learner', {
      token,
      body: { preferredTopics: ['sports'] },
    });
    assert.equal(buddyField.status, 400);
    assert.match(buddyField.json.error.message, /unknown field/);

    const notArray = await ui.request('PUT', '/api/me/profile/learner', { token, body: { interests: 'anime' } });
    assert.equal(notArray.status, 400);
    assert.match(notArray.json.error.message, /interests/);

    // 校验失败不该写坏数据，也不该顺带把人标成「已填过」
    const me = await ui.request('GET', '/api/me', { token });
    assert.deepEqual(me.json.data.learnerProfile.interests, []);
    assert.equal(me.json.data.learnerProfile.onboarded, false);
  } finally {
    await ui.close();
  }
});

test('PUT /api/me/profile/buddy：wantToLearn 不许出现 yue，interests 超 5 个 400', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('buddy');

    // 回礼不能是粤语，否则「语言交换」就退化成单向教学（契约 2.4 / 3.6）
    for (const value of ['yue']) {
      const res = await ui.request('PUT', '/api/me/profile/buddy', { token, body: { wantToLearn: [value] } });
      assert.equal(res.status, 400, `wantToLearn 里的 ${value} 必须被拒`);
      assert.match(res.json.error.message, /wantToLearn/);
    }
    // 母语词表里的其它取值照常可用
    for (const value of NATIVE_LANGUAGES) {
      const res = await ui.request('PUT', '/api/me/profile/buddy', { token, body: { wantToLearn: [value] } });
      assert.equal(res.status, 200, `wantToLearn 应当接受 ${value}`);
    }

    const tooManyInterests = await ui.request('PUT', '/api/me/profile/buddy', {
      token,
      body: { interests: ['movies', 'anime', 'gaming', 'music', 'food', 'travel'] },
    });
    assert.equal(tooManyInterests.status, 400);
    assert.match(tooManyInterests.json.error.message, new RegExp(`interests allows at most ${MAX_INTERESTS}`));

    const tooManyTopics = await ui.request('PUT', '/api/me/profile/buddy', {
      token,
      body: { preferredTopics: ['hong_kong_food', 'movies', 'gaming', 'travel'] },
    });
    assert.equal(tooManyTopics.status, 400);
    assert.match(tooManyTopics.json.error.message, new RegExp(`preferredTopics allows at most ${MAX_BUDDY_TOPICS}`));

    // 不认识的会说语言取值同样 400
    const badLanguage = await ui.request('PUT', '/api/me/profile/buddy', {
      token,
      body: { languagesSpoken: ['cantonese'] },
    });
    assert.equal(badLanguage.status, 400);
    assert.match(badLanguage.json.error.message, /languagesSpoken/);
  } finally {
    await ui.close();
  }
});

test('PUT /api/me/settings：界面语言 / 匿名 / 可见范围 / 榜单可见性', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');

    const res = await ui.request('PUT', '/api/me/settings', {
      token,
      body: { interfaceLanguage: 'en', anonymous: false, visibility: { level: false }, leaderboardVisible: false },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data), ['settings']);
    assert.equal(res.json.data.settings.interfaceLanguage, 'en');
    assert.equal(res.json.data.settings.anonymous, false);
    assert.equal(res.json.data.settings.leaderboardVisible, false);
    assert.deepEqual(res.json.data.settings.visibility, { interests: true, level: false, identity: true }, '只改传进来的开关');
    assert.equal('accountId' in res.json.data.settings, false, '内部字段不下发');

    const badLocale = await ui.request('PUT', '/api/me/settings', { token, body: { interfaceLanguage: 'fr' } });
    assert.equal(badLocale.status, 400);
    assert.match(badLocale.json.error.message, /interfaceLanguage/);

    const badToggle = await ui.request('PUT', '/api/me/settings', { token, body: { anonymous: 'yes' } });
    assert.equal(badToggle.status, 400);
    assert.match(badToggle.json.error.message, /anonymous/);

    const badVisibility = await ui.request('PUT', '/api/me/settings', { token, body: { visibility: { nickname: true } } });
    assert.equal(badVisibility.status, 400);
    assert.match(badVisibility.json.error.message, /visibility/);

    // 设置是账号级的：同一台设备换一个身份的令牌，读到的还是同一份设置
    const buddyToken = await ui.signIn('buddy');
    const buddyMe = await ui.request('GET', '/api/me', { token: buddyToken });
    assert.deepEqual(buddyMe.json.data.settings, res.json.data.settings);
  } finally {
    await ui.close();
  }
});

test('POST /api/dev/reset：一键重置，连账号一起回到出厂（空的）', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('learner');
    const accountId = ui.accountIdOf();
    await ui.request('PUT', '/api/me/profile/learner', { token, body: { interests: ['food'] } });
    await ui.request('PUT', '/api/me/profile/buddy', { token, body: { interests: ['movies'] } });
    assert.deepEqual(ui.db.getProfile(accountId, 'learner').interests, ['food']);
    assert.deepEqual(ui.db.getProfile(accountId, 'buddy').interests, ['movies']);

    const reset = await ui.request('POST', '/api/dev/reset', { body: {} });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.data.reset, true);

    // 出厂是**空的**：账号、资料、进度全没了（不再是「回到某个演示账号」）
    assert.equal(ui.db.count('users'), 0);
    assert.equal(ui.db.count('profiles'), 0);
    assert.equal(ui.db.getProfile(accountId, 'learner'), null);
    // 令牌表也一起清了：旧令牌立刻失效（演示「一键回到出厂」时不会拖着旧会话）
    const stale = await ui.request('GET', '/api/me', { token });
    assert.equal(stale.status, 401);
  } finally {
    await ui.close();
  }
});

/** 母语者资料的出厂期望值（从 seed 的工厂函数取，别把字段清单抄死在用例里）。 */
function createBuddyExpected(accountId) {
  return {
    userId: profileIdFor(accountId, 'buddy'),
    avatarId: 'neutral', frameId: 'none',
    languagesSpoken: [],
    identity: null,
    interests: [],
    preferredTopics: [],
    wantToLearn: [],
    onboarded: false,
  };
}

/** 去掉服务端的内部字段，用来比对「另一份资料有没有被动过」。 */
function stripInternal(row) {
  const { accountId, role, ...rest } = row;
  return rest;
}

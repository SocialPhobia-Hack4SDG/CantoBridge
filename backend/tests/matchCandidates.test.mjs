/**
 * Phase 2 · 匹配条件 / 候选人预览 / 首页推荐（契约 4.4 节）。
 *
 * 三块各自的关键点：
 *   - `PUT /api/match/criteria`：`null` 与 `[]` 都是「清掉自定义」，不是「一个都不匹配」；
 *   - 候选人预览：**被摘走的人仍然能预览**（`roomAvailable: false`）——
 *     「人已经被聊走了」与「人不存在」是两件事，前端要能分别处理；
 *   - 首页推荐：只回母语者，且互补问的是**反方向**（母语者的回礼 ∩ 学习者的母语）。
 *
 * 候选人不是种子池，而是**真的注册出来的设备**：一台设备一个 deviceId，
 * 注册 → 填资料 → 入队。取值都走词表校验（`interests` 取 INTERESTS，
 * `preferredTopics` 取 BUDDY_TOPICS），所以这里写错一个值会当场 400。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { complementLanguage, matchRank, matchScore } from '../../frontend/src/lib/logic.js';
import { BUDDY_SPECS, registerWithProfile, seedWaitingBuddies } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

/** 一位正在等的学习者（供母语者视角的列表用）。 */
const LEARNER_SPEC = {
  key: 'learner-one',
  nativeLanguage: 'english',
  cantoneseLevel: 'beginner',
  identity: 'exchange_student',
  interests: ['anime', 'food'],
  goal: 'daily_conversation',
};

test('PUT /api/match/criteria：写入 / null 清掉 / 空数组清掉 / 越界与多余字段 400', async () => {
  const ui = await startTestServer();
  try {
    const token = await ui.signIn('buddy');
    const accountId = ui.accountIdOf();

    const set = await ui.request('PUT', '/api/match/criteria', { token, body: { topics: ['anime', 'food'] } });
    assert.equal(set.status, 200);
    assert.deepEqual(set.json.data, { ok: true, criteria: ['anime', 'food'] });
    assert.deepEqual(ui.db.getSettings(accountId).matchCriteria, ['anime', 'food']);

    // 「随便聊」不是新语义：勾满就是一份普通条件，清掉就是回到资料
    const cleared = await ui.request('PUT', '/api/match/criteria', { token, body: { topics: null } });
    assert.deepEqual(cleared.json.data.criteria, null, 'null = 清掉自定义');
    assert.equal(ui.db.getSettings(accountId).matchCriteria, null);

    await ui.request('PUT', '/api/match/criteria', { token, body: { topics: ['anime'] } });
    const empty = await ui.request('PUT', '/api/match/criteria', { token, body: { topics: [] } });
    assert.deepEqual(empty.json.data.criteria, null, '空数组同样等于清掉：不发明「谁都不匹配」这种状态');

    const unknownValue = await ui.request('PUT', '/api/match/criteria', { token, body: { topics: ['nope'] } });
    assert.equal(unknownValue.status, 400);
    assert.equal(unknownValue.json.error.code, 'bad_request');

    const unknownKey = await ui.request('PUT', '/api/match/criteria', { token, body: { topic: ['anime'] } });
    assert.equal(unknownKey.status, 400, '字段名写错要当场发现，不能静默忽略');
  } finally {
    await ui.close();
  }
});

test('匹配条件真的参与打分：设置后用条件取代资料里的兴趣', async () => {
  const ui = await startTestServer();
  try {
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', {
      nativeLanguage: LEARNER_SPEC.nativeLanguage,
      cantoneseLevel: LEARNER_SPEC.cantoneseLevel,
      identity: LEARNER_SPEC.identity,
      interests: LEARNER_SPEC.interests,
      learningGoal: LEARNER_SPEC.goal,
    });
    await ui.request('POST', '/api/match/queue', { token: learner.token, body: {} });

    const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy', {
      interests: ['movies'],
      preferredTopics: ['university_life'],
    });

    const byProfile = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    const entryByProfile = byProfile.json.data.entries.find((entry) => entry.peerId === learner.peerId);
    const row = ui.db.findQueueRow(learner.peerId);
    assert.equal(
      entryByProfile.matchScore,
      matchScore(['movies', 'university_life'], [...row.interests, row.goal]),
      '没自定义条件时用资料（兴趣 + 想聊话题）',
    );

    await ui.request('PUT', '/api/match/criteria', { token: buddy.token, body: { topics: ['anime'] } });
    const byCriteria = await ui.request('GET', '/api/match/queue', { token: buddy.token });
    for (const entry of byCriteria.json.data.entries) {
      const queueRow = ui.db.findQueueRow(entry.peerId);
      assert.equal(entry.matchScore, matchScore(['anime'], [...queueRow.interests, queueRow.goal]), `${entry.peerId} 应当按自定义条件算`);
    }
  } finally {
    await ui.close();
  }
});

test('候选人预览：五个键齐全，分数与共同标签与列表同源', async () => {
  const ui = await startTestServer();
  try {
    const buddies = await seedWaitingBuddies(ui);
    const lucas = buddies.find((item) => item.key === 'ka-ho');
    const buddy = await registerWithProfile(ui, 'buddy', 'device-viewer', {
      interests: ['movies', 'gaming'],
      preferredTopics: [],
    });

    const res = await ui.request('GET', `/api/match/candidates/${lucas.peerId}`, { token: buddy.token });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['candidate', 'matchScore', 'matchedTags', 'reasons', 'roomAvailable']);
    assert.equal(res.json.data.roomAvailable, true);

    const peerTags = lucas.interests;
    assert.equal(res.json.data.matchScore, matchScore(['movies', 'gaming'], peerTags));
    assert.deepEqual(res.json.data.matchedTags, ['movies', 'gaming'].filter((tag) => peerTags.includes(tag)));
    assert.deepEqual(res.json.data.reasons, res.json.data.matchedTags, 'v1 定名 reasons，与 matchedTags 同源');
    assert.equal(res.json.data.candidate.peerId, lucas.peerId);
    assert.equal(res.json.data.candidate.intent, 'teach', '母语者 = 教粤语');
  } finally {
    await ui.close();
  }
});

test('候选人预览：不存在 404；被摘走后仍然 200 且 roomAvailable=false', async () => {
  const ui = await startTestServer();
  try {
    const buddies = await seedWaitingBuddies(ui);
    const target = buddies[0];
    const viewer = await registerWithProfile(ui, 'buddy', 'device-viewer', { interests: ['movies'] });

    const missing = await ui.request('GET', '/api/match/candidates/u-nobody', { token: viewer.token });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not_found');

    const room = await ui.request('POST', '/api/rooms', { token: viewer.token, body: { learnerId: target.peerId } });
    assert.equal(room.status, 201);

    const taken = await ui.request('GET', `/api/match/candidates/${target.peerId}`, { token: viewer.token });
    assert.equal(taken.status, 200, '被聊走了也要能打开预览页，只是不能开聊');
    assert.equal(taken.json.data.roomAvailable, false);
    assert.equal(taken.json.data.candidate.peerId, target.peerId, '资料照给：前端换成「这位伙伴已经开始聊天了」');
  } finally {
    await ui.close();
  }
});

test('可见范围由服务端裁剪：关掉 identity / interests / level 之后列表里就真的没有', async () => {
  const ui = await startTestServer();
  try {
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', {
      nativeLanguage: LEARNER_SPEC.nativeLanguage,
      cantoneseLevel: LEARNER_SPEC.cantoneseLevel,
      identity: LEARNER_SPEC.identity,
      interests: LEARNER_SPEC.interests,
      learningGoal: LEARNER_SPEC.goal,
    });
    const hidden = { interests: false, level: false, identity: false };
    const saved = await ui.request('PUT', '/api/me/settings', {
      token: learner.token,
      body: { anonymous: false, visibility: hidden },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.data.settings.visibility, hidden);
    await ui.request('POST', '/api/match/queue', { token: learner.token, body: {} });

    // 另一位没改过设置的人（出厂三项全开），用来对照
    const visible = await registerWithProfile(ui, 'learner', 'device-learner-2', {
      nativeLanguage: 'mandarin',
      cantoneseLevel: 'elementary',
      identity: 'university_student',
      interests: ['food', 'travel'],
      learningGoal: 'make_local_friends',
    });
    await ui.request('POST', '/api/match/queue', { token: visible.token, body: {} });

    const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy', { interests: ['movies'] });
    const list = await ui.request('GET', '/api/match/queue', { token: buddy.token });

    const me = list.json.data.entries.find((entry) => entry.peerId === learner.peerId);
    assert.equal(me.anonymous, false);
    assert.equal(me.displayName, ui.db.getUser(learner.accountId).displayName, '不匿名就要给得出称呼');
    assert.deepEqual(me.interests, [], '关掉兴趣 → 下发空数组，而不是让前端自己藏');
    assert.equal(me.identity, null);
    assert.equal(me.cantoneseLevel, null);
    assert.equal(me.intent, 'learn', '教 / 学标签不随可见范围裁剪：藏了对面就不知道这位站哪一边');

    const other = list.json.data.entries.find((entry) => entry.peerId === visible.peerId);
    assert.equal(other.identity, 'university_student', '出厂默认三项全开：没改过设置的人照样看得见');
    assert.ok(other.interests.length > 0);
  } finally {
    await ui.close();
  }
});

test('GET /api/match/recommendations：只回母语者，按分数降序，互补问反方向', async () => {
  const ui = await startTestServer();
  try {
    const buddies = await seedWaitingBuddies(ui);
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', {
      nativeLanguage: 'english',
      interests: ['travel', 'movies'],
    });

    const res = await ui.request('GET', '/api/match/recommendations', { token: learner.token });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data), ['entries']);

    const entries = res.json.data.entries;
    assert.deepEqual(entries.map((entry) => entry.peerId).sort(), buddies.map((item) => item.peerId).sort());
    assert.ok(entries.every((entry) => entry.role === 'buddy'), '推荐里只该有母语者');
    assert.ok(entries.every((entry) => entry.intent === 'teach'), '母语者 = 教粤语');

    const expected = buddies.map((item) => ({
      peerId: item.peerId,
      matchScore: matchScore(['travel', 'movies'], item.interests),
    }));
    assert.deepEqual(
      Object.fromEntries(entries.map((entry) => [entry.peerId, entry.matchScore])),
      Object.fromEntries(expected.map((entry) => [entry.peerId, entry.matchScore])),
      '分数按学习者的兴趣算',
    );
    assert.deepEqual(
      entries.map((entry) => entry.peerId),
      [...expected].sort((a, b) => b.matchScore - a.matchScore).map((entry) => entry.peerId),
      '每位粤语母语者拿到的互补加成一样，所以顺序＝匹配度降序',
    );

    // 互补问的是反方向：母语者的「想练什么」∩ 学习者的母语
    const byId = Object.fromEntries(entries.map((entry) => [entry.peerId, entry]));
    const kaHo = buddies.find((item) => item.key === 'ka-ho');
    const waiLing = buddies.find((item) => item.key === 'wai-ling');
    const siuFung = buddies.find((item) => item.key === 'siu-fung');
    assert.equal(byId[kaHo.peerId].complement, true, 'ka-ho 想练 English，这位学习者的母语正是 english');
    assert.equal(byId[kaHo.peerId].complementLanguage, 'english');
    assert.equal(byId[waiLing.peerId].complement, false, 'wai-ling 想练普通话，反方向不命中');
    assert.equal(byId[siuFung.peerId].complement, false, '没填回礼 = 没有互补');
    for (const entry of entries) {
      const spec = buddies.find((item) => item.peerId === entry.peerId);
      assert.equal(
        entry.complementLanguage,
        complementLanguage(spec.wantToLearn, ['english']),
        `${entry.peerId} 的互补语言与前端算法一致`,
      );
      assert.equal(typeof matchRank(entry, { wantToLearn: ['yue'] }), 'number');
    }
  } finally {
    await ui.close();
  }
});

test('GET /api/match/recommendations：limit 生效；人可以被摘走后从推荐里消失', async () => {
  const ui = await startTestServer();
  try {
    await seedWaitingBuddies(ui);
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', { interests: ['movies'] });

    const all = await ui.request('GET', '/api/match/recommendations', { token: learner.token });
    const limited = await ui.request('GET', '/api/match/recommendations?limit=1', { token: learner.token });
    assert.equal(limited.json.data.entries.length, 1);
    assert.equal(limited.json.data.entries[0].peerId, all.json.data.entries[0].peerId);

    const target = all.json.data.entries[0].peerId;
    const room = await ui.request('POST', '/api/rooms', { token: learner.token, body: { buddyId: target } });
    assert.equal(room.status, 201, '学习者在首页点「直接聊」：传 buddyId');

    const after = await ui.request('GET', '/api/match/recommendations', { token: learner.token });
    assert.equal(after.json.data.entries.some((entry) => entry.peerId === target), false);
    assert.equal(after.json.data.entries.length, all.json.data.entries.length - 1);
  } finally {
    await ui.close();
  }
});

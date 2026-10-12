/**
 * `GET /api/rooms/:roomId/cards` —— 三语话题卡（契约 4.5 节）。
 *
 * 这个文件盯住六件事：
 *   1. **level 缺省取学习者的水平**：对方是学习者就用他队列行上的水平；
 *      发起人自己是学习者（对方是母语者）就用发起人的 learner 资料；
 *   2. **缺省兴趣取双方交集**（2026-10-11 用户明确否掉并集）：每一侧按**自己在房里
 *      扮演的身份**取资料（一个账号两份人格，取错了就是空数组）。交集为空时只用
 *      **通用主题**兜底 —— 绝不退回并集，单方面的兴趣一张都不许出现；
 *   3. 下发的卡**优先落在该档位的难度窗口内**；兴趣主题凑不满一叠时，
 *      先在兴趣主题里放宽难度（也不掺无关主题），最后才拿通用主题兜底；
 *   4. `?level=` / `?interests=` / `?count=` 生效，且 count 被夹在 1 ~ 32；
 *   5. `?round=` 换一叠、`?exclude=` 把看过的卡排除掉 —— 同一间房同一个 round
 *      两侧必须拿到**同一叠**（「双方看同一张」的前提）；
 *   6. 房间不存在是 404 `room_gone`（前端据此回匹配大厅，而不是白屏）。
 *
 * 候选人由 `helpers/scenario.mjs` 现场造出来（注册 → 填资料 → 入队）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENERAL_TOPICS, TOPIC_LABELS } from '../src/data/topicDatabase.js';
import { pickCards, difficultyWindow, seedFrom } from '../src/lib/topics.js';
import { registerWithProfile, seedWaitingBuddies, seedWaitingLearners } from './helpers/scenario.mjs';
import { startTestServer } from './helpers/server.mjs';

/** 三位不同水平的学习者：水平是取卡唯一的依据，所以每种都要有一位。 */
const LEVELED_LEARNERS = [
  { key: 'beginner-one', cantoneseLevel: 'beginner', nativeLanguage: 'english', interests: ['anime'] },
  { key: 'elementary-one', cantoneseLevel: 'elementary', nativeLanguage: 'mandarin', interests: ['food'] },
  { key: 'intermediate-one', cantoneseLevel: 'intermediate', nativeLanguage: 'english', interests: ['movies', 'technology', 'gaming'] },
];

/** 造好三位不同水平的学习者并让它们入队。 */
async function seedLeveledLearners(ui) {
  const out = [];
  for (const [index, spec] of LEVELED_LEARNERS.entries()) {
    const person = await registerWithProfile(ui, 'learner', `device-${spec.key}-${index}`, {
      nativeLanguage: spec.nativeLanguage,
      cantoneseLevel: spec.cantoneseLevel,
      interests: spec.interests,
    });
    const joined = await ui.request('POST', '/api/match/queue', { token: person.token, body: {} });
    assert.equal(joined.status, 200, `准备数据：${spec.key} 入队`);
    out.push({ ...spec, ...person });
  }
  return out;
}

/**
 * 母语者挑人：房间的对方（peer）是学习者。
 * 发起人（母语者）的兴趣决定**交集**，所以要按用例给：缺省 `['movies']`。
 */
async function roomAsBuddy(ui, learnerId, deviceId = 'device-buddy', interests = ['movies']) {
  const buddy = await registerWithProfile(ui, 'buddy', deviceId, { interests });
  const created = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId } });
  assert.equal(created.status, 201, '成房是前置条件');
  return { token: buddy.token, roomId: created.json.data.roomId };
}

/** 学习者开聊：房间的对方（peer）是母语者。 */
async function roomAsLearner(ui, buddyId, deviceId = 'device-learner') {
  const learner = await registerWithProfile(ui, 'learner', deviceId, {});
  const created = await ui.request('POST', '/api/rooms', { token: learner.token, body: { buddyId } });
  assert.equal(created.status, 201, '成房是前置条件');
  return { token: learner.token, roomId: created.json.data.roomId, learner };
}

test('cards：对方是学习者时，level 取他的粤语水平（intermediate）', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const target = learners.find((item) => item.key === 'intermediate-one');
    const { token, roomId } = await roomAsBuddy(ui, target.peerId);
    const res = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token });

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['cards', 'level', 'roomId', 'round']);
    assert.equal(res.json.data.roomId, roomId);
    assert.equal(res.json.data.round, 0, '开场那一叠是第 0 叠');
    assert.equal(res.json.data.level, 'intermediate', '缺省用学习者的水平，不用发起人的');
    assert.equal(res.json.data.cards.length, 8, 'count 缺省是 8（一次预取一叠）');
    assert.ok(res.json.data.cards.every(card => /[a-z]+[1-6]/.test(card.jyutping)), '真实接口每张卡都下发粤拼');

    const window = difficultyWindow('intermediate');
    for (const card of res.json.data.cards) {
      assert.ok(window.includes(card.difficulty), `${card.id} 的难度不在 ${JSON.stringify(window)} 里`);
    }
  } finally {
    await ui.close();
  }
});

test('cards：换一位初学者，窗口跟着收窄到只给 beginner', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const target = learners.find((item) => item.key === 'beginner-one');
    const { token, roomId } = await roomAsBuddy(ui, target.peerId);
    const res = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token });
    assert.equal(res.json.data.level, 'beginner');
    for (const card of res.json.data.cards) {
      assert.equal(card.difficulty, 'beginner', '初学者不该拿到更高难度的卡');
    }
  } finally {
    await ui.close();
  }
});

test('cards：对方是母语者时，level 取发起人（学习者）自己的水平', async () => {
  const ui = await startTestServer();
  try {
    const buddies = await seedWaitingBuddies(ui);
    // 出厂资料全空 → 没有水平可依据，兜底 beginner
    const first = await roomAsLearner(ui, buddies[0].peerId);
    const firstCards = await ui.request('GET', `/api/rooms/${first.roomId}/cards`, { token: first.token });
    assert.equal(firstCards.json.data.level, 'beginner', '资料没填时兜底 beginner，而不是报错');

    // 填上 advanced 之后，新房间按新水平给卡
    await ui.request('PUT', '/api/me/profile/learner', {
      token: first.token,
      body: { nativeLanguage: 'english', cantoneseLevel: 'advanced' },
    });
    const second = await roomAsLearner(ui, buddies[1].peerId, 'device-learner');
    const secondCards = await ui.request('GET', `/api/rooms/${second.roomId}/cards`, { token: second.token });
    assert.equal(secondCards.json.data.level, 'advanced');
    const window = difficultyWindow('advanced');
    for (const card of secondCards.json.data.cards) {
      assert.ok(window.includes(card.difficulty), `${card.id} 不在 advanced 的窗口里`);
    }
  } finally {
    await ui.close();
  }
});

test('cards：?level= 覆盖缺省值，且依然只给窗口内的卡', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const { token, roomId } = await roomAsBuddy(ui, learners[0].peerId);
    for (const level of ['beginner', 'elementary', 'intermediate', 'advanced']) {
      const res = await ui.request('GET', `/api/rooms/${roomId}/cards?level=${level}`, { token });
      assert.equal(res.json.data.level, level);
      const window = difficultyWindow(level);
      for (const card of res.json.data.cards) {
        assert.ok(window.includes(card.difficulty), `level=${level} 时不该出现 ${card.id}`);
      }
    }
  } finally {
    await ui.close();
  }
});

test('cards：?count= 生效并被夹在 1 ~ 32', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const { token, roomId } = await roomAsBuddy(ui, learners[0].peerId);

    const three = await ui.request('GET', `/api/rooms/${roomId}/cards?count=3`, { token });
    assert.equal(three.json.data.cards.length, 3);

    const many = await ui.request('GET', `/api/rooms/${roomId}/cards?level=beginner&count=99`, { token });
    assert.equal(many.json.data.cards.length, 32, '上限 32，不能要多少给多少');

    for (const raw of ['0', '-5', 'abc', '']) {
      const res = await ui.request('GET', `/api/rooms/${roomId}/cards?count=${raw}`, { token });
      assert.equal(res.json.data.cards.length, 8, `count=${raw} 时回落到默认 8`);
    }

    const decimal = await ui.request('GET', `/api/rooms/${roomId}/cards?count=3.7`, { token });
    assert.equal(decimal.json.data.cards.length, 3, '小数向下取整');
  } finally {
    await ui.close();
  }
});

test('cards：缺省的兴趣 = 双方资料里的兴趣交集（每一侧按自己在房里的身份取）', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    // 对方是学习者（interests: movies / technology / gaming）
    const target = learners.find((item) => item.key === 'intermediate-one');
    // 发起人用母语者身份挑人 → 取的是他的 **buddy 资料**（interests: ['movies']）
    const { token, roomId } = await roomAsBuddy(ui, target.peerId);

    const res = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token });
    // 交集：只有 movies 是两边都点过的（technology / gaming 只有学习者点了）
    assert.deepEqual(
      res.json.data.cards,
      pickCards({ level: 'intermediate', interests: ['movies'], count: 8, seed: seedFrom(roomId + ':0') }),
      '缺省兴趣取双方交集，顺序与选卡函数一致（洗牌种子 = 房间号 + 第几叠）',
    );
    assert.deepEqual(
      [...new Set(res.json.data.cards.map((card) => card.topic))],
      ['movies'],
      '单方面点过的主题（technology / gaming）一张都不许出现',
    );
  } finally {
    await ui.close();
  }
});

test('cards：交集为空时只用通用主题兜底，单方面的兴趣一张都不许出现（「不要并集」的回归）', async () => {
  const ui = await startTestServer();
  try {
    // 学习者只点 anime，母语者只点 photography —— 交集为空
    const learners = await seedWaitingLearners(ui, [
      { key: 'anime-learner', cantoneseLevel: 'beginner', nativeLanguage: 'english', interests: ['anime'] },
    ]);
    const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy-photo', { interests: ['photography'] });
    const created = await ui.request('POST', '/api/rooms', {
      token: buddy.token,
      body: { learnerId: learners[0].peerId },
    });
    assert.equal(created.status, 201);
    const roomId = created.json.data.roomId;

    const res = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token: buddy.token });
    const topics = [...new Set(res.json.data.cards.map((card) => card.topic))];
    assert.equal(res.json.data.cards.length, 8);
    assert.ok(
      topics.every((topic) => GENERAL_TOPICS.includes(topic)),
      '交集为空时只该出通用主题，实际：' + topics.join(', '),
    );
    assert.ok(!topics.includes('anime') && !topics.includes('photography'), '单方面兴趣一张都不许出现');
  } finally {
    await ui.close();
  }
});

test('cards：母语者那一侧的兴趣也要取到（一个账号两份人格，别只看 learner 资料）', async () => {
  const ui = await startTestServer();
  try {
    // 学习者 anime + photography，母语者 photography → 交集只有 photography。
    // 若只读了发起人的 learner 资料（空的），交集就是空 → 只剩通用主题，
    // 所以「只出 photography」这一条同时钉住了「母语者那一侧真的被读到了」。
    const learners = await seedWaitingLearners(ui, [
      {
        key: 'anime-learner',
        cantoneseLevel: 'beginner',
        nativeLanguage: 'english',
        interests: ['anime', 'photography'],
      },
    ]);
    const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy-photo', { interests: ['photography'] });
    const created = await ui.request('POST', '/api/rooms', {
      token: buddy.token,
      body: { learnerId: learners[0].peerId },
    });
    assert.equal(created.status, 201);
    const roomId = created.json.data.roomId;

    const res = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token: buddy.token });
    const topics = [...new Set(res.json.data.cards.map((card) => card.topic))];
    assert.deepEqual(topics, ['photography'], '交集 = 两边都点过的 photography');
    assert.ok(!topics.includes('anime'), '只有学习者点过的 anime 不该出现');
    // 母语者自己那一份 learner 资料是空的，兴趣只可能来自 buddy 资料
    assert.equal(ui.db.getProfile(buddy.accountId, 'learner').onboarded, false, '前提：没填过 learner 资料');
  } finally {
    await ui.close();
  }
});

test('cards：?round= 换一叠、?exclude= 排除看过的卡，且同房同 round 两侧同一叠', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const target = learners.find((item) => item.key === 'beginner-one');
    // 母语者也点 anime → 交集 ['anime']；anime 在 beginner 窗口里正好 8 张，
    // 所以「再来八张」必须放宽到 elementary 才凑得出全新的一叠。
    const { token, roomId } = await roomAsBuddy(ui, target.peerId, 'device-buddy', ['anime']);

    const first = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token });
    const firstIds = first.json.data.cards.map((card) => card.id);

    // 「双方看同一张」的前提：同一个房间、同一个 round，谁问都是同一叠
    const again = await ui.request('GET', `/api/rooms/${roomId}/cards`, { token });
    assert.deepEqual(again.json.data.cards, first.json.data.cards, '同房同 round 必须可复现');

    // 换一叠：round + 1 换种子，exclude 把看过的那一叠排除掉
    const second = await ui.request(
      'GET',
      `/api/rooms/${roomId}/cards?round=1&exclude=${encodeURIComponent(firstIds.join(','))}`,
      { token },
    );
    assert.equal(second.json.data.round, 1);
    assert.equal(second.json.data.cards.length, 8);
    assert.deepEqual(
      second.json.data.cards.map((card) => card.id).filter((id) => firstIds.includes(id)),
      [],
      '「再来八张」要真的换一叠，而不是把看过的 8 张再洗一遍',
    );

    // 换了房间（种子变了）也该换一叠
    const other = await ui.request('POST', '/api/match/queue', { token: target.token, body: {} });
    assert.equal(other.status, 200, '学习者回大厅重新排队');
    const otherRoom = await ui.request('POST', '/api/rooms', { token, body: { learnerId: target.peerId } });
    assert.equal(otherRoom.status, 201);
    const otherCards = await ui.request('GET', `/api/rooms/${otherRoom.json.data.roomId}/cards`, { token });
    assert.notDeepEqual(
      otherCards.json.data.cards.map((card) => card.id),
      firstIds,
      '换一个房间就该换一叠卡（不要每次聊的东西都一样）',
    );

    // round 缺省 / 非数字 / 负数一律当第 0 叠；上限 64（手改 URL 也刷不出无穷无尽的叠）
    for (const raw of ['', 'abc', '-3']) {
      const res = await ui.request('GET', `/api/rooms/${roomId}/cards?round=${raw}`, { token });
      assert.equal(res.json.data.round, 0, `round=${raw} 时回落到第 0 叠`);
      assert.deepEqual(res.json.data.cards, first.json.data.cards);
    }
    const huge = await ui.request('GET', `/api/rooms/${roomId}/cards?round=999`, { token });
    assert.equal(huge.json.data.round, 64, 'round 夹在 0 ~ 64');
  } finally {
    await ui.close();
  }
});

test('cards：?interests= 覆盖缺省交集，且卡只从这些主题里出', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const target = learners.find((item) => item.key === 'intermediate-one');
    const { token, roomId } = await roomAsBuddy(ui, target.peerId);

    const res = await ui.request('GET', `/api/rooms/${roomId}/cards?interests=anime`, { token });
    assert.deepEqual(
      [...new Set(res.json.data.cards.map((card) => card.topic))],
      ['anime'],
      '覆盖兴趣之后只出这些主题',
    );
    assert.equal(res.json.data.cards.length, 8);
    assert.ok(
      res.json.data.cards.every((card) => difficultyWindow('intermediate').includes(card.difficulty)),
      '窗口里有 16 张 anime 卡（8 张 elementary + 8 张 intermediate），难度不该越窗口',
    );

    // 传一个卡池里不存在的主题：不报错，退回**通用主题**兜底（不是铺开全部 20 个主题）
    const unknown = await ui.request('GET', `/api/rooms/${roomId}/cards?interests=nonexistent`, { token });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.json.data.cards.length, 8);
    const unknownTopics = [...new Set(unknown.json.data.cards.map((card) => card.topic))];
    assert.ok(
      unknownTopics.every((topic) => GENERAL_TOPICS.includes(topic)),
      '兜底只能是通用主题，实际：' + unknownTopics.join(', '),
    );
    assert.ok(unknownTopics.length > 1, '通用主题也是铺开的');
  } finally {
    await ui.close();
  }
});

test('cards：上一轮聊过的主题会往后挪（取学习者账号里的 topicsSeen）', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const target = learners.find((item) => item.key === 'intermediate-one');
    // 交集要**至少两个**主题，才看得出「聊过的那个往后挪」——
    // 只剩一个共享主题的话，那一叠里全是它，无从比较先后。
    const buddy = await registerWithProfile(ui, 'buddy', 'device-buddy-again', {
      interests: ['movies', 'technology'],
    });

    const first = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: target.peerId } });
    assert.equal(first.status, 201, '成房是前置条件');
    const firstRoom = first.json.data.roomId;
    const before = await ui.request('GET', `/api/rooms/${firstRoom}/cards`, { token: buddy.token });
    const topicsBefore = before.json.data.cards.map((card) => card.topic);
    assert.equal(topicsBefore.length, 8);
    const usedTopic = topicsBefore[0];
    assert.ok(target.interests.includes(usedTopic), '前提：第一张来自学习者的兴趣：' + usedTopic);

    // 真结算一轮，把 usedTopic 记进**学习者**的 topicsSeen（卡池那一侧读的就是这份）
    const ended = await ui.request('POST', `/api/rooms/${firstRoom}/end`, {
      token: target.token,
      body: { durationSec: 300, cardsUsed: 2, topics: [usedTopic] },
    });
    assert.equal(ended.status, 200);
    assert.deepEqual(ui.db.getProgress(target.accountId)?.topicsSeen, [usedTopic], '前提：话题记到了账号上');

    // 学习者回大厅重新排队（真实流程就是这样），再开一间
    const requeued = await ui.request('POST', '/api/match/queue', { token: target.token, body: {} });
    assert.equal(requeued.status, 200);
    const second = await ui.request('POST', '/api/rooms', { token: buddy.token, body: { learnerId: target.peerId } });
    assert.equal(second.status, 201, '第二间房要能开出来');
    const after = await ui.request('GET', `/api/rooms/${second.json.data.roomId}/cards`, { token: buddy.token });
    const topicsAfter = after.json.data.cards.map((card) => card.topic);

    assert.equal(topicsAfter.length, 8, '还是一叠 8 张');
    assert.ok(
      topicsAfter.every((topic) => target.interests.includes(topic)),
      '聊过之后也只在双方兴趣的主题里出卡：' + JSON.stringify(topicsAfter),
    );
    assert.notEqual(topicsAfter[0], usedTopic, `聊过的主题（${usedTopic}）不该再排第一`);
  } finally {
    await ui.close();
  }
});

test('cards：房间不存在 404 room_gone，没令牌 401', async () => {
  const ui = await startTestServer();
  try {
    const learner = await registerWithProfile(ui, 'learner', 'device-learner', {});
    const gone = await ui.request('GET', '/api/rooms/r-nope-12345/cards', { token: learner.token });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, 'room_gone');

    const anonymous = await ui.request('GET', '/api/rooms/r-nope-12345/cards');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, 'not_authorized');
  } finally {
    await ui.close();
  }
});

test('cards：卡上的字段够前端直接渲染（id / 主题 / 难度 / 三语 / 句型）', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedLeveledLearners(ui);
    const { token, roomId } = await roomAsBuddy(ui, learners[0].peerId);
    const res = await ui.request('GET', `/api/rooms/${roomId}/cards?count=1`, { token });
    const [card] = res.json.data.cards;
    for (const key of ['id', 'topic', 'difficulty', 'cantonese', 'mandarin', 'english', 'expressions']) {
      assert.ok(key in card, `卡上缺字段 ${key}`);
    }
    assert.ok(Array.isArray(card.expressions) && card.expressions.length >= 1);
    // 主题文案表与卡池同源（逐值一致性由 topicDatabase.test.mjs 盯）
    assert.ok(TOPIC_LABELS[card.topic], `主题 ${card.topic} 在 TOPIC_LABELS 里没有文案`);
  } finally {
    await ui.close();
  }
});

test('cards：一个账号两种身份，取卡只受资料影响、不受身份影响', async () => {
  const ui = await startTestServer();
  try {
    const learners = await seedWaitingLearners(ui, [
      { key: 'elementary-one', cantoneseLevel: 'elementary', nativeLanguage: 'mandarin', interests: ['food'] },
    ]);
    const target = learners[0];
    // 同一台设备既是母语者又是学习者：用母语者身份去挑人
    const me = await registerWithProfile(ui, 'buddy', 'device-me', { interests: ['movies'] });
    const created = await ui.request('POST', '/api/rooms', { token: me.token, body: { learnerId: target.peerId } });
    const res = await ui.request('GET', `/api/rooms/${created.json.data.roomId}/cards`, { token: me.token });
    assert.equal(res.json.data.level, 'elementary', '取的是对方的水平');
    assert.equal(ui.db.getProfile(me.accountId, 'learner').onboarded, false, '换身份不碰另一份资料');
  } finally {
    await ui.close();
  }
});

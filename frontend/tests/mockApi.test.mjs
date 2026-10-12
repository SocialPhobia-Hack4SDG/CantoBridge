import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStore, createMemoryStorage } from '../src/app/store.js';
import { createApi } from '../src/services/index.js';
import { ApiError, EMPTY_CANDIDATES, createMockApi } from '../src/services/mockApi.js';
import { DEMO_POOL } from './helpers/demoPool.mjs';

// 测试里默认把人为延迟换成空实现，避免 20 次调用等 10 秒；延迟本身单独用一个用例验证。
// 候选池是**注入**的：产品默认池子为空（真后端才是默认档位），测试要「有人的世界」
// 就从 helpers/demoPool.mjs 拿一份塞进去。
function setup({ role = 'buddy', sleep = () => Promise.resolve(), candidates = DEMO_POOL } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  if (role) store.setRole(role);
  const api = createMockApi({ store, sleep, candidates });
  return { store, api };
}

test('createApi：useMock 决定实现；两个实现的方法名集合完全一致', () => {
  const store = createStore({ storage: createMemoryStorage() });
  assert.equal(typeof createApi({ store, useMock: true }).listWaitingLearners, 'function');

  // useMock:false 不再抛错：返回的是 httpApi，方法名与 mock 逐个对应（页面无感切换）
  const http = createApi({ store, useMock: false, baseUrl: 'https://api.example.com' });
  assert.deepEqual(
    Object.keys(http).sort(),
    Object.keys(createMockApi({ store })).sort(),
    '两个实现的方法名必须一致，否则页面会在某个方法上拿到 undefined',
  );
});

test('mock 默认候选池是空的：没有后端时就是「谁都还没注册」', async () => {
  const { api } = setup({ candidates: EMPTY_CANDIDATES });
  assert.deepEqual(await api.listWaitingLearners(), []);
  assert.deepEqual(await api.listRecommendedBuddies(), []);
  await assert.rejects(
    () => api.requestMatch(),
    (error) => error instanceof ApiError && error.code === 'no_candidate',
    '池子空的时候要报 no_candidate，绝不能临时编一个人出来',
  );
  const board = await api.getLeaderboard('weekly', 'learner');
  assert.equal(board.length, 0, '未达到累计时长门槛不上榜');
});

test('学习者：加入 / 取消排队', async () => {
  const { store, api } = setup({ role: 'learner' });
  const joined = await api.joinQueue();
  assert.ok(joined.queueEntryId.startsWith('q-'));
  assert.ok(store.getState().runtime.queue !== null);
  await api.leaveQueue();
  assert.equal(store.getState().runtime.queue, null);
});

test('匹配条件：updateMatchCriteria 去重后写进设置，传 null 清掉自定义', async () => {
  const { store, api } = setup({ role: 'learner' });
  assert.equal(store.getState().settings.matchCriteria, null, '一开始没有自定义条件');

  const saved = await api.updateMatchCriteria(['anime', 'anime', 'food']);
  assert.equal(saved.ok, true);
  assert.deepEqual(store.getState().settings.matchCriteria, ['anime', 'food'], '重复项要去掉');

  await api.updateMatchCriteria(null);
  assert.equal(store.getState().settings.matchCriteria, null, '传 null 回到「按资料里的兴趣找」');

  // 「随便聊」= 把全部主题都送上去，服务层原样存下（判定交给 coversAllOptions）
  const all = await api.updateMatchCriteria(['anime', 'food', 'travel']);
  assert.deepEqual(all.criteria, ['anime', 'food', 'travel']);
});

test('母语者浏览：按匹配度倒序、匿名被打码、匹配度在 40~95', async () => {
  const { api } = setup();
  const rows = await api.listWaitingLearners();
  assert.ok(rows.length >= 4);
  const scores = rows.map((row) => row.matchScore);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), '按匹配度倒序');
  assert.ok(scores.every((score) => score >= 40 && score <= 95));
  const anonymous = rows.find((row) => row.anonymous);
  assert.equal(anonymous.displayName, '匿名用户');
  assert.equal(anonymous.peerId.startsWith('learner-demo'), true);
  for (const row of rows) {
    assert.ok(row.matchedTags.every((tag) => row.interests.includes(tag) || row.goal === tag));
  }
});

test('母语者预览：可选到具体一个人，找不到时抛 ApiError', async () => {
  const { api } = setup();
  const candidate = await api.getCandidate('learner-demo-01');
  assert.equal(candidate.displayName, '匿名用户');
  assert.equal(candidate.cantoneseLevel, 'beginner');
  assert.equal(candidate.roomAvailable, true);
  await assert.rejects(() => api.getCandidate('nobody'), (error) => error instanceof ApiError && error.code === 'not_found');
});

test('成房：房间从公共列表摘掉，同一个学习者不会被两个人挑走', async () => {
  const { store, api } = setup();
  const before = await api.listWaitingLearners();
  const first = await api.createRoom('learner-demo-01');
  assert.ok(first.roomId.startsWith('r-'));
  assert.equal(store.getState().runtime.room.roomId, first.roomId);
  assert.equal(store.getState().runtime.room.role, 'buddy');

  const after = await api.listWaitingLearners();
  assert.equal(after.length, before.length - 1);
  assert.equal(after.some((row) => row.peerId === 'learner-demo-01'), false);

  await assert.rejects(() => api.createRoom('learner-demo-01'), (error) => error.code === 'room_taken');
});

test('房间：拿得到、拿错 id 会报 room_gone', async () => {
  const { api } = setup();
  const { roomId } = await api.createRoom('learner-demo-01');
  const room = await api.getRoom(roomId);
  assert.equal(room.room.roomId, roomId);
  await assert.rejects(() => api.getRoom('r-nope'), (error) => error.code === 'room_gone');
});

test('话题卡：按水平给难度窗口，也可以被 Demo 控制台覆盖', async () => {
  const { store, api } = setup();
  const { roomId } = await api.createRoom('learner-demo-01');
  const beginner = await api.getCards(roomId, { level: 'beginner', interests: ['anime', 'food'] });
  assert.equal(beginner.cards.length, 8);
  assert.equal(beginner.level, 'beginner');
  assert.equal(beginner.round, 0, '开场那一叠是第 0 叠');
  assert.ok(beginner.cards.every((card) => card.difficulty === 'beginner'));
  // 卡牌「根据双方兴趣产生」：只出命中兴趣的主题，顺序由「房间号 + 第几叠」的种子洗牌决定
  assert.deepEqual(
    [...new Set(beginner.cards.map((card) => card.topic))].sort(),
    ['anime', 'food'],
    '只出双方兴趣的主题',
  );
  assert.ok(beginner.cards[0].cantonese && beginner.cards[0].mandarin && beginner.cards[0].english);

  // 同一间房、同一叠 → 两次取到的是同一批卡（「双方看同一张」的前提）
  const again = await api.getCards(roomId, { level: 'beginner', interests: ['anime', 'food'] });
  assert.deepEqual(again.cards.map((card) => card.id), beginner.cards.map((card) => card.id));

  // 「再来八张」：换一叠 + 把看过的那 8 张传下去，新一叠与它零交集
  const next = await api.getCards(roomId, {
    level: 'beginner',
    interests: ['anime', 'food'],
    round: 1,
    exclude: beginner.cards.map((card) => card.id),
  });
  assert.equal(next.round, 1);
  assert.equal(next.cards.length, 8);
  assert.deepEqual(
    next.cards.map((card) => card.id).filter((id) => beginner.cards.some((card) => card.id === id)),
    [],
    '新一叠要真的全新',
  );

  await api.saveSettings({ cardLevelOverride: 'advanced' });
  const advanced = await api.getCards(roomId, { level: 'beginner' });
  assert.equal(advanced.level, 'advanced');
  assert.ok(advanced.cards.every((card) => ['intermediate', 'advanced'].includes(card.difficulty)));
  assert.equal(store.getState().settings.cardLevelOverride, 'advanced');
});

test('结算：endRoom 写积分、历史与成就', async () => {
  const { store, api } = setup();
  const { roomId } = await api.createRoom('learner-demo-01');
  const result = await api.endRoom(roomId, { durationSec: 600, cardsUsed: 3, topics: ['anime'], peerId: 'learner-demo-01', peerLabel: '匿名用户' });
  assert.equal(result.xpEarned, 60 + 15);
  assert.equal(store.getState().runtime.room.status, 'ended');
  assert.equal(store.getState().social.history.length, 1);
  assert.equal(store.getState().social.history[0].peerLabel, '匿名用户');
  assert.equal(store.getState().progress.peopleHelped, 1);
});

test('演示匹配：学习者只拿到一条「待接受」请求，母语者一键挑走第一位等待者', async () => {
  const learner = setup({ role: 'learner' });
  const request = await learner.api.requestMatch();
  assert.equal(request.status, 'pending');
  assert.equal(learner.store.getState().runtime.matchRequest.roomId, request.roomId);
  assert.equal(learner.store.getState().runtime.room, null, '还没点接受就不该成房');
  assert.equal(request.peer.native, true);
  assert.equal(request.acceptSeconds, 10, '倒计时上限默认 10 秒');
  assert.ok(request.expiresAt > learner.store.now());
  // 本机出厂谁都不认识，所以挑到池子里的第一位
  assert.equal(request.peer.displayName, 'ka-ho');

  const buddy = setup({ role: 'buddy' });
  const claimed = await buddy.api.requestMatch();
  assert.ok(claimed.roomId);
  const rows = await buddy.api.listWaitingLearners();
  assert.equal(rows.some((row) => row.peerId === 'learner-demo-01'), false);
});

test('匹配请求：重复触发幂等、接受成房、不接受回到队列', async () => {
  const { store, api } = setup({ role: 'learner' });
  store.saveSettings({ matchAcceptSeconds: 15 });
  await api.joinQueue();

  const first = await api.requestMatch();
  assert.equal(first.acceptSeconds, 15, '倒计时上限跟着设置走');
  const second = await api.requestMatch();
  assert.equal(second.status, 'pending');
  assert.equal(second.roomId, first.roomId, '已有待接受请求时不会造出第二个房间号');

  const declined = await api.declineMatchRequest();
  assert.equal(declined.status, 'declined');
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.ok(store.getState().runtime.queue, '不接受之后仍然在排队');

  const expired = await api.declineMatchRequest({ expired: true });
  assert.equal(expired.status, 'none', '没有待接受请求时是无操作');

  const again = await api.requestMatch();
  const accepted = await api.acceptMatchRequest();
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.roomId, again.roomId);
  assert.equal(store.getState().runtime.room.roomId, again.roomId);
  assert.equal(store.getState().runtime.room.role, 'learner');
  assert.equal(store.getState().runtime.queue, null, '进房之后排队状态清掉');
});

test('排行榜：没有假人，榜上只有本机这一行；开了匿名立刻打码', async () => {
  const { store, api } = setup({ role: 'learner' });
  for (const minutes of [0, 5]) {
    store.getState().progress.totalMinutes = minutes;
    assert.deepEqual(await api.getLeaderboard('weekly', 'learner'), []);
  }
  store.getState().progress.totalMinutes = 6;
  const weekly = await api.getLeaderboard('weekly', 'learner');
  assert.equal(weekly.length, 1, '本机只认识自己一个账号，榜上就不该有别人');
  assert.deepEqual(weekly.map((row) => row.rank), [1]);
  assert.equal(weekly[0].isMe, true);
  assert.equal(weekly[0].anonymous, false);
  assert.equal(weekly[0].userId, store.getState().learnerProfile.userId, '实名时下发的是本机资料 id');
  assert.equal(weekly[0].xp, 0, '新设备没练过就是 0 分');
  assert.equal(weekly[0].minutes, 6);

  store.saveSettings({ anonymous: true });
  const hidden = await api.getLeaderboard('weekly', 'learner');
  assert.equal(hidden[0].userId, '匿名用户');
  assert.equal(hidden[0].anonymous, true);
  assert.equal(hidden.length, 1, '换窗口 / 换身份也是同一行：mock 没有第二个人可排');
});

test('个人进度与资料：按身份返回，写入后读得到', async () => {
  const { store, api } = setup({ role: 'learner' });
  const progress = await api.getProgress();
  assert.equal(progress.xp, 0, '新设备出厂进度全零——榜上那些数字不能是编的');
  assert.equal(progress.buddyLevel, 'newcomer');
  assert.equal(progress.practiceMinutesThisWeek, 0);
  assert.deepEqual(progress.achievements, []);

  await api.saveLearnerProfile({ interests: ['anime'], cantoneseLevel: 'elementary' });
  assert.deepEqual(store.getState().learnerProfile.interests, ['anime']);
  assert.equal(store.getState().learnerProfile.onboarded, true);

  await api.saveBuddyProfile({ preferredTopics: ['hong_kong_food'] });
  assert.deepEqual(store.getState().buddyProfile.preferredTopics, ['hong_kong_food']);
  assert.deepEqual(store.getState().learnerProfile.interests, ['anime'], '两种身份的资料互不影响');

  const me = await api.getMe();
  assert.equal(me.learnerProfile.cantoneseLevel, 'elementary');
  assert.ok(me.buddyProfile.userId);
  assert.equal(me.settings.anonymous, false, 'mock 新用户默认不匿名');
});

test('社交与反馈：收藏句型、发给对方反馈都不会报错', async () => {
  const { store, api } = setup();
  await api.savePhrase({ cantonese: '唔該', mandarin: '谢谢' });
  assert.equal(store.getState().social.savedPhrases.length, 1, '出厂没有预置的收藏');
  const feedback = await api.sendFeedback('r-1', { tags: ['friendly'] });
  assert.equal(feedback.ok, true);
});

test('伙伴申请：发出 → 撤回 → 再发出 → 对方接受，全程不直接进伙伴表', async () => {
  const { store, api } = setup({ role: 'learner' });

  // 出厂没有任何关系：一台新设备谁都不认识（以前这里预置了 ka-ho / wai-ling 两个假人）
  assert.deepEqual(await api.listBuddies(), []);
  assert.deepEqual(await api.listBuddyRequests(), []);

  // ① 发出申请：只落一条 outgoing pending
  assert.deepEqual(await api.sendBuddyRequest('fred', 'fred', { roomId: 'r-1' }), { status: 'pending' });
  assert.equal(store.getState().social.buddies.some((item) => item.peerId === 'fred'), false, '发申请不等于成为伙伴');
  const outgoing = (await api.listBuddyRequests()).find((item) => item.peerId === 'fred');
  assert.equal(outgoing.direction, 'outgoing');
  assert.equal(outgoing.status, 'pending');
  assert.equal(outgoing.roomId, 'r-1');

  // ② 重复发不会产生第二条
  assert.deepEqual(await api.sendBuddyRequest('fred', 'fred'), { status: 'pending' });
  assert.equal((await api.listBuddyRequests()).filter((item) => item.peerId === 'fred').length, 1);

  // ③ 撤回之后回到没有关系
  assert.deepEqual(await api.cancelBuddyRequest('fred'), { status: 'cancelled' });
  assert.equal((await api.listBuddyRequests()).some((item) => item.peerId === 'fred'), false);

  // ④ 再发一次，由对方接受 → 这次才进伙伴表
  await api.sendBuddyRequest('fred', 'fred');
  assert.deepEqual(await api.acceptBuddyRequest('fred'), { status: 'accepted' });
  assert.equal((await api.listBuddies()).some((item) => item.peerId === 'fred'), true);
  assert.equal((await api.listBuddyRequests()).some((item) => item.peerId === 'fred'), false);

  // ⑤ 已经是伙伴之后再申请是空操作
  assert.deepEqual(await api.sendBuddyRequest('fred', 'fred'), { status: 'buddy' });

  // ⑥ 对方发来的申请可以拒绝（演示辅助造一条「收到的」；现场没有第二个人时用）
  assert.deepEqual(await api.receiveBuddyRequest('wai-ling', 'wai-ling'), { status: 'pending-in' });
  assert.deepEqual(await api.declineBuddyRequest('wai-ling'), { status: 'declined' });
  assert.equal((await api.listBuddyRequests()).length, 0);

  // ⑦ 解除伙伴
  assert.deepEqual(await api.removeBuddy('fred'), { status: 'removed' });
  assert.deepEqual(await api.listBuddies(), []);
});

test('伙伴申请：两个人互相申请 = 双方同意，直接成为伙伴', async () => {
  const { api } = setup({ role: 'learner' });
  // 对方先发来一条申请（演示辅助接口，现场没有第二个人时用）
  assert.deepEqual(await api.receiveBuddyRequest('ming', 'ming'), { status: 'pending-in' });
  // 这时我再发出申请 → 双方都同意
  assert.deepEqual(await api.sendBuddyRequest('ming', 'ming'), { status: 'accepted' });
  assert.equal((await api.listBuddies()).some((item) => item.peerId === 'ming'), true);
  assert.equal((await api.listBuddyRequests()).some((item) => item.peerId === 'ming'), false);
});

test('伙伴申请：返回的是副本，外部改动不影响 store', async () => {
  const { store, api } = setup({ role: 'learner' });
  const buddies = await api.listBuddies();
  buddies.push({ peerId: 'injected' });
  assert.equal(store.getState().social.buddies.some((item) => item.peerId === 'injected'), false);
});

test('历史：返回副本，外部改动不影响 store', async () => {
  const { store, api } = setup();
  const history = await api.getHistory();
  history.push({ sessionId: 'injected' });
  assert.equal(store.getState().social.history.some((entry) => entry.sessionId === 'injected'), false);
});

test('基础设施：STUN 配置与版本策略有固定形状', async () => {
  const { api } = setup();
  const ice = await api.getIceServers();
  assert.ok(Array.isArray(ice.iceServers) && ice.iceServers[0].urls);
  const policy = await api.checkVersionPolicy();
  assert.equal(policy.forceUpgrade, false);
  const tags = await api.getTags();
  assert.deepEqual(Object.keys(tags).sort(), ['buddyTopics', 'goals', 'identities', 'interests', 'levels', 'nativeLanguages']);
});

test('人为延迟：mockDelayMs > 0 时每次调用都会等（演示时才能看到加载态）', async () => {
  const waits = [];
  const { store, api } = setup({ sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
  await api.getTags();
  store.saveSettings({ mockDelayMs: 0 });
  await api.getTags();
  assert.equal(waits.length, 1);
  store.saveSettings({ mockDelayMs: 1500 });
  await api.getTags();
  assert.deepEqual(waits, [400, 1500]);
});

/** 「语言交换 + 供给优先」（B / C）的三条硬约束：只加权不筛选、只在母语者视角生效、成房仍然原子。 */

test('母语者浏览：语言互补只加权不筛选——顺序变了，人一个不少', async () => {
  const { store, api } = setup();
  // 出厂资料不预选任何一项了，这里显式给母语者填兴趣与想聊话题——匹配度排序才有前提
  // （preferredTopics 也参与匹配度：university_life 会跟 aiko 的目标撞上）
  store.saveRoleProfile('buddy', {
    interests: ['movies', 'gaming', 'food'],
    preferredTopics: ['hong_kong_food', 'university_life'],
  });
  const before = await api.listWaitingLearners();
  assert.equal(before[0].peerId, 'lucas', '没填回礼时排第一的是匹配度最高的那位');
  assert.equal(before[before.length - 1].peerId, 'mingzhu', '母语是普通话的这位匹配度最低，垫底');
  assert.ok(before.every((row) => row.complement === false && row.complementLanguage === null), '没填回礼 ⇒ 谁都没有互补徽标');

  store.saveRoleProfile('buddy', { wantToLearn: ['mandarin'] });
  const after = await api.listWaitingLearners();

  assert.equal(after.length, before.length, '只加权不筛选：一个候选都不能少');
  assert.deepEqual(after.map((row) => row.peerId).sort(), before.map((row) => row.peerId).sort(), '成员集合完全一致，只是顺序变了');
  assert.equal(after[0].peerId, 'lucas', '互补是软条件，压不过高 14 分的匹配度');
  assert.equal(after[1].peerId, 'mingzhu', '54 + 8 = 62 > 58：加成能翻转挨得很近的两个人');
  assert.equal(after[1].complement, true);
  assert.equal(after[1].complementLanguage, 'mandarin');
  const aiko = after.find((row) => row.peerId === 'aiko');
  assert.equal(aiko.complement, false, '母语是 other（与 wantToLearn 不相交）也不报错、不过滤');
  assert.equal(aiko.complementLanguage, null);
  assert.ok(after.every((row) => row.nativeLanguages.includes(row.nativeLanguage)), '等待列表顺带把复数母语带出去，推荐与徽标共用一套口径');
});

test('学习者推荐：排序仍是纯匹配度，互补问的是反方向', async () => {
  const { store, api } = setup({ role: 'learner' });
  // 出厂资料不预选任何一项了：显式填上母语（互补命中 ka-ho）与兴趣（决定匹配度排序）
  store.saveRoleProfile('learner', { nativeLanguage: 'english', interests: ['anime', 'food'] });
  const rows = await api.listRecommendedBuddies();
  assert.ok(rows.length >= 3);
  const scores = rows.map((row) => row.matchScore);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), '学习者视角的排序不变（每位粤语母语者拿到的加成一样）');
  assert.deepEqual(rows.map((row) => row.peerId), ['wai-ling', 'ka-ho', 'siu-fung'], '顺序与 fixture 的匹配度一致');

  const kaHo = rows.find((row) => row.peerId === 'ka-ho');
  assert.equal(kaHo.complement, true, 'ka-ho 想练 English，而这位学习者的母语正是 English');
  assert.equal(kaHo.complementLanguage, 'english');
  const waiLing = rows.find((row) => row.peerId === 'wai-ling');
  assert.equal(waiLing.complement, false, 'wai-ling 想练普通话，反方向不命中');
  assert.equal(waiLing.complementLanguage, null);
  const siuFung = rows.find((row) => row.peerId === 'siu-fung');
  assert.equal(siuFung.complement, false, '没填回礼 = 没有互补');
  assert.deepEqual(siuFung.wantToLearn, [], '没填也要照样推出去：互补只是排序权重');
  assert.ok(rows.every((row) => row.nativeLanguages.includes('yue')), '推荐出去的必须是粤语母语者');
});

test('一键成房：原子摘人，第二次 409，房间立刻从推荐里消失', async () => {
  const { store, api } = setup({ role: 'learner' });
  const rows = await api.listRecommendedBuddies();
  const target = rows[0];
  const room = await api.createRoomWithBuddy(target.peerId);
  assert.ok(room.roomId.startsWith('r-'));
  assert.equal(room.peer.peerId, target.peerId);
  assert.equal(store.getState().runtime.room.role, 'learner', '发起人是学习者，但成房规则与母语者挑人完全一致');

  await assert.rejects(() => api.createRoomWithBuddy(target.peerId), (error) => error.code === 'room_taken');
  await assert.rejects(() => api.createRoomWithBuddy('nobody'), (error) => error.code === 'not_found');
  const after = await api.listRecommendedBuddies();
  assert.equal(after.some((row) => row.peerId === target.peerId), false, '被摘走的房间要从推荐块里消失');
  assert.equal(after.length, rows.length - 1);
});

test('候选人预览：母语者视角也带互补字段', async () => {
  const { store, api } = setup();
  store.saveRoleProfile('buddy', { wantToLearn: ['mandarin'] });
  const hit = await api.getCandidate('mingzhu');
  assert.equal(hit.complement, true);
  assert.equal(hit.complementLanguage, 'mandarin');
  const miss = await api.getCandidate('aiko');
  assert.equal(miss.complement, false);
  assert.equal(miss.complementLanguage, null);
});

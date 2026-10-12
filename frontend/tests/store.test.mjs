import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEVICE_KEY,
  STORAGE_KEY,
  STORAGE_VERSION,
  createDefaultState,
  createMemoryStorage,
  createStore,
  profileIdFor,
} from '../src/app/store.js';
import { buddyRelation } from '../src/lib/logic.js';

function newStore(options = {}) {
  return createStore({ storage: createMemoryStorage(), ...options });
}

test('默认状态：两种身份的资料都在、互不覆盖，且**出厂不预选任何一项**', () => {
  const state = createDefaultState();
  assert.equal(state.role, 'learner');
  assert.equal(state.locale, 'zh-Hans');
  assert.ok(state.learnerProfile.userId);
  assert.ok(state.buddyProfile.userId);
  assert.notEqual(state.learnerProfile.userId, state.buddyProfile.userId);
  assert.equal(state.settings.anonymous, false, '新用户默认不匿名');
  assert.equal(state.settings.signalMode, 'sim');
  assert.equal(newStore().getState().runtime.room, null, 'runtime 由 createStore 补上，默认没有房间');

  // 注册问卷一进来每题都应该是空的：学习者与母语者两份资料都不预选
  assert.deepEqual(
    {
      nativeLanguage: state.learnerProfile.nativeLanguage,
      cantoneseLevel: state.learnerProfile.cantoneseLevel,
      learningGoal: state.learnerProfile.learningGoal,
      identity: state.learnerProfile.identity,
      interests: state.learnerProfile.interests,
    },
    { nativeLanguage: null, cantoneseLevel: null, learningGoal: null, identity: null, interests: [] },
    '学习者资料出厂全空',
  );
  assert.deepEqual(
    {
      languagesSpoken: state.buddyProfile.languagesSpoken,
      identity: state.buddyProfile.identity,
      interests: state.buddyProfile.interests,
      preferredTopics: state.buddyProfile.preferredTopics,
      wantToLearn: state.buddyProfile.wantToLearn,
    },
    { languagesSpoken: [], identity: null, interests: [], preferredTopics: [], wantToLearn: [] },
    '母语者资料出厂全空（选「我讲粤语」也不会预选兴趣与身份）',
  );

  // 两份资料都还没注册过：一台新设备要先走完 onboarding，对面才看得到一个完整的人
  assert.equal(state.learnerProfile.onboarded, false, '学习者也要真注册');
  assert.equal(state.buddyProfile.onboarded, false);
});

test('出厂数据：一个假人都没有——伙伴 / 申请 / 收藏 / 记录 / 进度全空', () => {
  const state = createDefaultState();
  assert.deepEqual(state.social.buddies, [], '以前这里预置了 ka-ho，是个没有设备在等的假人');
  assert.deepEqual(state.social.buddyRequests, []);
  assert.deepEqual(state.social.savedPhrases, []);
  assert.deepEqual(state.social.history, []);
  assert.equal(state.progress.xp, 0, '以前出厂带 360 XP，会让没练过的人直接排在榜首');
  assert.equal(state.progress.conversations, 0);
  assert.equal(state.progress.totalMinutes, 0);
  assert.deepEqual(state.progress.topicsSeen, []);
});

test('设备 id：落盘一次终身复用，资料 id 由它派生（与后端 profileIdFor 同规则）', () => {
  const storage = createMemoryStorage();
  const first = createStore({ storage });
  const deviceId = first.deviceId();
  assert.match(deviceId, /^d-[a-z0-9]{8}$/);
  assert.equal(storage.getItem(DEVICE_KEY), deviceId, '设备 id 落在独立键里');

  // 换一个 store 实例（≈ 刷新页面）还是同一个设备、同一个账号
  const second = createStore({ storage });
  assert.equal(second.deviceId(), deviceId, '刷新不能把设备换成另一个人');
  assert.equal(second.getState().learnerProfile.userId, profileIdFor(deviceId, 'learner'));
  assert.equal(second.getState().buddyProfile.userId, profileIdFor(deviceId, 'buddy'));

  // 两台不同的设备 = 两个不同的账号
  const other = createStore({ storage: createMemoryStorage() });
  assert.notEqual(other.deviceId(), deviceId);
  assert.notEqual(other.getState().learnerProfile.userId, first.getState().learnerProfile.userId);

  // 设备 id **不在**带版本闸门的存档里：存档作废不会顺手换掉账号
  second.setLocale('zh-Hant'); // 触发一次落盘（store 只在 set 之后才写）
  const archive = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(archive.deviceId, undefined, '设备 id 只能活在独立键里');
  assert.equal(archive.learnerProfile.userId, profileIdFor(deviceId, 'learner'), '存档里只有派生出来的资料 id');
});

test('存档版本闸门：旧版存档被丢弃，不会把上一版的出厂值塞回来', () => {
  const storage = createMemoryStorage();
  // 上一版（v3）的存档：出厂还带着假人与预置进度，匿名仍是旧默认。
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 3,
      settings: { anonymous: true },
      social: { buddies: [{ peerId: 'ka-ho', label: 'ka-ho' }] },
      progress: { xp: 360, conversations: 2 },
      buddyProfile: { identity: 'university_student', interests: ['movies', 'gaming', 'food'], onboarded: false },
    }),
  );
  const store = createStore({ storage });
  assert.deepEqual(store.getState().buddyProfile.interests, [], '旧存档必须整份作废');
  assert.equal(store.getState().buddyProfile.identity, null);
  assert.deepEqual(store.getState().social.buddies, [], 'v3 里那几个假人不能带进 v4');
  assert.equal(store.getState().progress.xp, 0, 'v3 的预置进度也不能带进来');
  assert.equal(store.getState().settings.anonymous, false, 'v3 的旧匿名默认不能带进 v4');

  // 没有版本号的裸存档同样不认
  storage.setItem(STORAGE_KEY, JSON.stringify({ buddyProfile: { interests: ['movies'] } }));
  assert.deepEqual(createStore({ storage }).getState().buddyProfile.interests, []);

  // 同版本存档照常合并
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, buddyProfile: { interests: ['movies'] } }));
  assert.deepEqual(createStore({ storage }).getState().buddyProfile.interests, ['movies']);
});

test('hydrateSocial：只替换传入的那张表，保留另一张与服务端无关的本地数据', () => {
  const store = newStore();
  // 本地先有一条「收到的申请」（演示辅助接口造的），用来验证镜像不会顺手清掉它
  store.receiveBuddyRequest('siu-fung', 'siu-fung');
  store.hydrateSocial({ buddies: [{ peerId: 'lucas', label: 'lucas', since: '2026-09-29T10:00:00+08:00' }] });
  assert.deepEqual(store.getState().social.buddies.map((row) => row.peerId), ['lucas']);
  assert.deepEqual(
    store.getState().social.buddyRequests.map((row) => row.peerId),
    ['siu-fung'],
    '没传 buddyRequests 就不动它',
  );

  store.hydrateSocial({ buddyRequests: [] });
  assert.deepEqual(store.getState().social.buddyRequests, []);
  assert.deepEqual(store.getState().social.buddies.map((row) => row.peerId), ['lucas'], '伙伴表不受影响');
  assert.ok(Array.isArray(store.getState().social.history), 'history / savedPhrases 这些本地数据不动');
});

test('匹配条件：默认不自定义，保存后持久化，旧存档自动补上默认值', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });
  assert.equal(store.getState().settings.matchCriteria, null, '默认没有自定义条件，按资料里的兴趣找');

  store.saveSettings({ matchCriteria: ['anime', 'food'] });
  assert.deepEqual(store.getState().settings.matchCriteria, ['anime', 'food']);
  assert.equal(store.getState().settings.anonymous, false, '保存条件不该动其它设置');

  // 刷新（重新读存档）：自定义条件还在
  const reloaded = createStore({ storage });
  assert.deepEqual(reloaded.getState().settings.matchCriteria, ['anime', 'food']);

  // 旧存档里根本没有这个字段 → 合并默认值，不能是 undefined
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, settings: { anonymous: false } }));
  const old = createStore({ storage });
  assert.equal(old.getState().settings.matchCriteria, null);
  assert.equal(old.getState().settings.anonymous, false, '旧存档的其它字段照旧生效');
});

test('切换身份只改 role，两份资料原样保留', () => {
  const store = newStore();
  store.saveRoleProfile('learner', { interests: ['anime'] });
  store.saveRoleProfile('buddy', { interests: ['movies'] });
  store.setRole('buddy');
  assert.equal(store.getState().role, 'buddy');
  assert.deepEqual(store.getState().learnerProfile.interests, ['anime']);
  assert.deepEqual(store.getState().buddyProfile.interests, ['movies']);
  store.setRole('learner');
  assert.deepEqual(store.getState().learnerProfile.interests, ['anime']);
  assert.equal(store.setRole('teacher').role, 'learner', '非法身份不生效');
});

test('持久化：换一个 store 实例仍能读到同一份数据', () => {
  const storage = createMemoryStorage();
  const first = createStore({ storage });
  first.setLocale('en');
  first.setRole('buddy');
  first.saveRoleProfile('buddy', { interests: ['gaming'] });
  first.saveSettings({ anonymous: false, visibility: { level: false } });

  const second = createStore({ storage });
  assert.equal(second.getState().locale, 'en');
  assert.equal(second.getState().role, 'buddy');
  assert.deepEqual(second.getState().buddyProfile.interests, ['gaming']);
  assert.equal(second.getState().settings.anonymous, false);
  assert.equal(second.getState().settings.visibility.level, false);
  assert.equal(second.getState().settings.visibility.interests, true, '未写的开关保持默认');
  assert.ok(storage.getItem(STORAGE_KEY).includes('gaming'));
});

test('持久化：损坏的 JSON 不影响启动', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, '{ 这不是 JSON');
  const store = createStore({ storage });
  assert.equal(store.getState().role, 'learner');
  assert.ok(store.getState().social.history.length >= 0);
});

test('订阅：set 之后会收到通知，退订后不再收到', () => {
  const store = newStore();
  let count = 0;
  const unsubscribe = store.subscribe(() => {
    count += 1;
  });
  store.setLocale('en');
  assert.equal(count, 1);
  unsubscribe();
  store.setLocale('zh-Hant');
  assert.equal(count, 1);
});

test('排队与房间：startQueue / cancelQueue / startRoom / endRoom', () => {
  const store = newStore({ now: () => 1000 });
  store.startQueue({ anonymous: true });
  assert.equal(store.getState().runtime.queue.joinedAt, 1000);
  store.cancelQueue();
  assert.equal(store.getState().runtime.queue, null);

  store.startRoom({ roomId: 'r-1', peer: { displayName: 'ka-ho' }, role: 'buddy' });
  const room = store.getState().runtime.room;
  assert.equal(room.roomId, 'r-1');
  assert.equal(room.status, 'connecting');
  assert.equal(room.role, 'buddy');
  assert.equal(store.getState().runtime.reward, null);
  store.setRoomStatus('live');
  assert.equal(store.getState().runtime.room.status, 'live');
  store.endRoom();
  assert.equal(store.getState().runtime.room.status, 'ended');
});

test('结算：积分、历史、成就一起到位', () => {
  const store = newStore({ now: () => 1_700_000_000_000 });
  const result = store.recordSession({ peerId: 'ka-ho', peerLabel: 'ka-ho', durationSec: 720, cardsUsed: 4, topics: ['anime', 'food'] });
  assert.equal(result.xpEarned, 72 + 20);
  assert.deepEqual(result.unlocked, ['first_conversation'], '第一场对话解锁「完成第一次对话」');
  const state = store.getState();
  assert.equal(state.progress.conversations, 1);
  assert.equal(state.progress.totalMinutes, 12);
  assert.equal(state.progress.xp, 92);
  assert.equal(state.social.history.length, 1);
  assert.equal(state.social.history[0].role, 'learner');
  assert.equal(state.progress.peopleHelped, 0, '学习者不加帮助人数');

  const buddy = newStore();
  buddy.setRole('buddy');
  buddy.recordSession({ peerId: 'x', peerLabel: 'x', durationSec: 600, cardsUsed: 2 });
  assert.equal(buddy.getState().progress.peopleHelped, 1);
});

test('结算：母语者按自己的身份累计', () => {
  const store = newStore();
  store.setRole('buddy');
  const result = store.recordSession({ peerId: 'l1', peerLabel: '学习者', durationSec: 1800, cardsUsed: 5, topics: ['food'] });
  assert.equal(store.getState().progress.peopleHelped, 1);
  // 第一场搭档对话解锁 first_buddy_session；30 分钟陪伴还够不到「累计满 60 分钟」的文化大使
  assert.deepEqual(result.unlocked, ['first_buddy_session']);
  assert.equal(store.stats().conversations, 1);
});

test('社交：伙伴申请是双向的，走完 发出 → 撤回 → 接受 → 解除', () => {
  const store = newStore();

  // 出厂没有任何关系（以前这里预置了 ka-ho 与 wai-ling 两个假人）
  assert.deepEqual(store.getState().social.buddies, []);
  assert.deepEqual(store.getState().social.buddyRequests, []);

  // ① 发出申请：只落一条 outgoing pending，绝不进伙伴表
  assert.deepEqual(store.sendBuddyRequest('newbie', 'newbie', { roomId: 'r-1' }), { status: 'pending' });
  assert.equal(buddyRelation('newbie', store.getState().social).state, 'pending-out');
  assert.equal(store.getState().social.buddies.some((item) => item.peerId === 'newbie'), false);
  const request = store.getState().social.buddyRequests.find((item) => item.peerId === 'newbie');
  assert.equal(request.direction, 'outgoing');
  assert.equal(request.roomId, 'r-1');

  // ② 重复发不产生第二条
  assert.deepEqual(store.sendBuddyRequest('newbie', 'newbie'), { status: 'pending' });
  assert.equal(store.getState().social.buddyRequests.filter((item) => item.peerId === 'newbie').length, 1);

  // ③ 撤回
  assert.deepEqual(store.cancelBuddyRequest('newbie'), { status: 'cancelled' });
  assert.equal(buddyRelation('newbie', store.getState().social).state, 'none');

  // ④ 再发一次，由对方接受 → 这次才成为伙伴
  store.sendBuddyRequest('newbie', 'newbie');
  assert.deepEqual(store.acceptBuddyRequest('newbie'), { status: 'accepted' });
  assert.equal(buddyRelation('newbie', store.getState().social).state, 'buddy');
  assert.equal(store.getState().social.buddyRequests.some((item) => item.peerId === 'newbie'), false);

  // ⑤ 已经是伙伴之后再申请是空操作
  assert.deepEqual(store.sendBuddyRequest('newbie', 'newbie'), { status: 'buddy' });

  // ⑥ 收到的申请只有「拒绝」有效（演示辅助造一条「对方发来的」）
  store.receiveBuddyRequest('wai-ling', 'wai-ling');
  assert.deepEqual(store.cancelBuddyRequest('wai-ling'), { status: 'pending-in' }, '不能撤回别人发来的申请');
  assert.deepEqual(store.declineBuddyRequest('wai-ling'), { status: 'declined' });
  assert.equal(buddyRelation('wai-ling', store.getState().social).state, 'none');

  // ⑦ 解除伙伴
  assert.deepEqual(store.removeBuddy('newbie'), { status: 'removed' });
  assert.equal(store.getState().social.buddies.some((item) => item.peerId === 'newbie'), false);
});

test('社交：互相申请 = 双方同意，直接成为伙伴；通话记录不再自带 saved 布尔值', () => {
  const store = newStore();
  assert.deepEqual(store.receiveBuddyRequest('ming', 'ming'), { status: 'pending-in' });
  assert.deepEqual(store.sendBuddyRequest('ming', 'ming'), { status: 'accepted' });
  assert.equal(buddyRelation('ming', store.getState().social).state, 'buddy');

  store.recordSession({ peerId: 'ming', peerLabel: 'ming', durationSec: 600, cardsUsed: 2 });
  assert.equal('saved' in store.getState().social.history[0], false, '伙伴状态一律从 buddies + buddyRequests 推导');
});

test('社交：收藏句型去重', () => {
  const store = newStore();
  store.savePhrase({ cantonese: '你好', mandarin: '你好' });
  store.savePhrase({ cantonese: '你好', mandarin: '你好' });
  assert.equal(store.getState().social.savedPhrases.filter((item) => item.cantonese === '你好').length, 1);
});

test('重置演示数据：回到出厂状态并落盘，但**设备 id 不变**', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });
  const deviceId = store.deviceId();
  store.setRole('buddy');
  store.recordSession({ peerId: 'x', peerLabel: 'x', durationSec: 600, cardsUsed: 2 });
  store.resetDemoData();
  assert.equal(store.getState().role, 'learner');
  assert.equal(store.getState().social.history.length, 0);
  assert.equal(store.getState().progress.xp, 0);
  assert.equal(store.getState().runtime.room, null);
  assert.equal(store.deviceId(), deviceId, '清空本机数据不该顺手把账号换成另一个人');
  assert.equal(storage.getItem(DEVICE_KEY), deviceId);
  assert.ok(storage.getItem(STORAGE_KEY).includes('"xp":0'), '清空之后落盘的是全零进度');
});

test('退出并换人：清存档并**换一把新设备 id**（下一个人才能注册成另一个账号）', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });
  const deviceId = store.deviceId();
  store.setRole('buddy');
  store.saveRoleProfile('learner', { interests: ['food'] });
  assert.equal(store.getState().learnerProfile.onboarded, true, '先造一个「注册过、有资料」的状态');
  // 账号数据 + 设备偏好各设一个，看退出时谁留下、谁归零
  store.setLocale('en');
  store.saveSettings({ anonymous: true, signalMode: 'remote', theme: 'warm' });

  store.resetAccount();

  assert.equal(store.getState().role, 'learner');
  assert.deepEqual(store.getState().learnerProfile.interests, [], '回到出厂全空');
  assert.equal(store.getState().learnerProfile.onboarded, false, '本机回到「没注册过」');
  assert.notEqual(store.deviceId(), deviceId, '设备 id 就是账号本身，不换掉就等于没退出');
  assert.equal(storage.getItem(DEVICE_KEY), store.deviceId(), '新钥匙要落盘，刷新之后还是新账号');
  // 资料 id 是按设备 id 派生的：换了钥匙，本机算出来的资料 id 也要跟着换，
  // 否则本地镜像会指向服务端那个旧账号
  assert.equal(store.getState().learnerProfile.userId, 'learner-' + store.deviceId());
  assert.equal(store.getState().buddyProfile.userId, 'buddy-' + store.deviceId());

  // 设备偏好跟着这台手机走：界面语言 / 配色 / 通话档位不是账号数据，不该被换掉。
  // 尤其 signalMode——退回 sim 会让两台设备都只看得到假波形，而且当场看不出来。
  assert.equal(store.getState().locale, 'en');
  assert.equal(store.getState().settings.theme, 'warm');
  assert.equal(store.getState().settings.signalMode, 'remote');
  // 账号数据（服务端同步的设置）随账号回到出厂
  assert.equal(store.getState().settings.anonymous, false);
});

test('stats：distinctTopics 取「去重话题数」与记录话题数的较大值', () => {
  const store = newStore();
  assert.equal(store.stats().distinctTopics, 0, '新设备没聊过任何话题');
  store.recordSession({ peerId: 'x', peerLabel: 'x', durationSec: 60, cardsUsed: 1, topics: ['anime', 'anime'] });
  assert.equal(store.stats().distinctTopics, 1, '重复话题只算一个');
});
test('默认设置：后台匹配默认开，接受弹窗倒计时默认 10 秒', () => {
  const settings = newStore().getState().settings;
  assert.equal(settings.backgroundMatch, true, '后台匹配默认打开');
  assert.equal(settings.matchAcceptSeconds, 10, '接受弹窗默认 10 秒，可在 /dev/mock 调');
});

test('now()：对外暴露注入的时钟，让 app 层与 mock 层共用同一个时间源', () => {
  const store = newStore({ now: () => 777 });
  assert.equal(store.now(), 777);
});

test('排队状态活在 store 里：页面来来去去不会重置等待计时', () => {
  let clock = 5_000;
  const store = newStore({ now: () => clock });
  store.startQueue({ anonymous: true });
  const joinedAt = store.getState().runtime.queue.joinedAt;
  assert.equal(joinedAt, 5_000);

  // 模拟「离开匹配页又回来」：中间过了 15 秒，但没有任何东西碰过排队状态。
  // 页面只读 store，因此等待计时不可能被重置（这正是要修的手感问题）。
  clock = 20_000;
  assert.equal(store.getState().runtime.queue.joinedAt, joinedAt, '排队时间不应被重置');
  assert.equal(store.getState().runtime.matchRequest, null);
});

test('匹配请求：待接受 → 接受成房 / 不接受回到队列 / 重复请求幂等', () => {
  let clock = 1_000;
  const store = newStore({ now: () => clock });
  store.startQueue({ anonymous: true });

  const received = store.receiveMatchRequest({ roomId: 'r-9', peer: { displayName: 'siu-fung' }, expiresAt: 60_000 });
  assert.equal(received.status, 'pending');
  assert.equal(store.getState().runtime.matchRequest.roomId, 'r-9');
  assert.equal(store.getState().runtime.matchRequest.reason, 'background');
  assert.equal(store.getState().runtime.room, null, '还没接受就不该成房');

  // 幂等：后台定时器重复触发时不能覆盖已有请求（否则弹窗会被反复重建）
  assert.equal(store.receiveMatchRequest({ roomId: 'r-10', peer: { displayName: 'ka-ho' } }).status, 'pending');
  assert.equal(store.getState().runtime.matchRequest.roomId, 'r-9');

  // 不接受：人留在队列里，等待计时也不清零（拒绝 ≠ 退出匹配，更不该假装回到起点）
  clock = 40_000;
  assert.equal(store.declineMatchRequest().status, 'declined');
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.equal(store.getState().runtime.queue.joinedAt, 1_000, '等待计时不该被拒绝清零');
  assert.equal(store.declineMatchRequest().status, 'none', '没有请求时应当是无操作');

  // 接受：直接成房，排队状态一并清掉
  store.receiveMatchRequest({ roomId: 'r-11', peer: { displayName: 'siu-fung' } });
  const accepted = store.acceptMatchRequest();
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.roomId, 'r-11');
  assert.equal(store.getState().runtime.room.roomId, 'r-11');
  assert.equal(store.getState().runtime.room.status, 'connecting');
  assert.equal(store.getState().runtime.queue, null);
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.equal(store.acceptMatchRequest().status, 'none');
});

test('匹配请求：超时按「不接受」处理，取消排队会连带清掉待接受请求', () => {
  const store = newStore({ now: () => 1_000 });
  store.startQueue();
  store.receiveMatchRequest({ roomId: 'r-1', peer: { displayName: 'ka-ho' }, expiresAt: 2_000 });
  assert.equal(store.declineMatchRequest({ expired: true }).status, 'expired');
  assert.ok(store.getState().runtime.queue, '超时之后人还在队列里，可以继续等');

  store.receiveMatchRequest({ roomId: 'r-2', peer: { displayName: 'ka-ho' } });
  store.cancelQueue();
  assert.equal(store.getState().runtime.matchRequest, null, '取消等待要把待接受请求一起清掉');
  assert.equal(store.getState().runtime.queue, null);
});

test('匹配请求：已经在房间里时不会被新的匹配请求打断', () => {
  const store = newStore();
  store.startRoom({ roomId: 'r-x', peer: { displayName: 'ka-ho' } });
  assert.equal(store.receiveMatchRequest({ roomId: 'r-y', peer: { displayName: 'siu-fung' } }).status, 'busy');
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.equal(store.getState().runtime.room.roomId, 'r-x');
});

test('匹配请求：缺参数时明确拒绝，不留下半个请求', () => {
  const store = newStore();
  assert.equal(store.receiveMatchRequest({}).status, 'invalid');
  assert.equal(store.receiveMatchRequest({ roomId: 'r-1' }).status, 'invalid');
  assert.equal(store.getState().runtime.matchRequest, null);
});

test('匹配频道推送：hydrateMatchPeers 整份覆盖，dropMatchPeer 摘掉一位', () => {
  const store = newStore();
  // 出厂是 null = 「还没收到过推送」，页面据此回落到自己从 REST 拉的那份
  assert.equal(store.getState().runtime.matchPeers, null);

  store.hydrateMatchPeers([{ peerId: 'a' }, { peerId: 'b' }, { peerId: 'c' }]);
  assert.deepEqual(
    store.getState().runtime.matchPeers.map((row) => row.peerId),
    ['a', 'b', 'c'],
  );

  assert.equal(store.dropMatchPeer('b').status, 'dropped');
  assert.deepEqual(
    store.getState().runtime.matchPeers.map((row) => row.peerId),
    ['a', 'c'],
  );

  // 已经不在列表里（重复推送 / 别人的动作）：无操作，列表不动
  assert.equal(store.dropMatchPeer('b').status, 'none');
  assert.deepEqual(
    store.getState().runtime.matchPeers.map((row) => row.peerId),
    ['a', 'c'],
  );

  // 有人新入队 → 整份替换，不是追加
  store.hydrateMatchPeers([{ peerId: 'z' }]);
  assert.deepEqual(
    store.getState().runtime.matchPeers.map((row) => row.peerId),
    ['z'],
  );
});

test('匹配频道推送：没收到过推送时 dropMatchPeer 不凭空造出一份空列表', () => {
  const store = newStore();
  assert.equal(store.dropMatchPeer('a').status, 'none');
  // 关键：仍是 null（而不是 []）—— 否则界面会从「REST 拉到的那些人」闪成「没有人在等」
  assert.equal(store.getState().runtime.matchPeers, null);
});

test('匹配频道推送：hydrateMatchPeers 收到非数组一律归成空列表，且不落盘', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });

  store.hydrateMatchPeers(undefined);
  assert.deepEqual(store.getState().runtime.matchPeers, []);
  store.hydrateMatchPeers('nope');
  assert.deepEqual(store.getState().runtime.matchPeers, []);

  // runtime 是临时状态，不进存档（否则刷新后会拿上一轮的候选人列表）
  store.hydrateMatchPeers([{ peerId: 'a' }]);
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal('runtime' in saved, false, '存档里不该出现 runtime');
});

test('onboarding 还原点：退出整段还原，走完作废，重置演示数据也清掉', () => {
  const store = newStore();
  const beforeBuddy = JSON.parse(JSON.stringify(store.getState().buddyProfile));
  const beforeLearner = JSON.parse(JSON.stringify(store.getState().learnerProfile));

  // 进入 onboarding → 切到母语者 → 资料页点「暂时跳过」（这一步会真的落库）
  store.beginOnboarding();
  store.setRole('buddy');
  store.saveRoleProfile('buddy', { preferredTopics: ['hong_kong_food'] });
  assert.equal(store.getState().buddyProfile.onboarded, true, '资料页点「暂时跳过」确实落库');

  // 三页之间来回走会重复调 beginOnboarding，但还原点不能被中间状态覆盖
  store.beginOnboarding();
  store.cancelOnboarding();
  assert.equal(store.getState().role, 'learner', '角色还原到进入之前');
  assert.deepEqual(store.getState().buddyProfile, beforeBuddy, '两份资料一起还原（含刚保存的那一笔）');
  assert.deepEqual(store.getState().learnerProfile, beforeLearner);
  assert.equal(store.getState().runtime.onboarding, null, '还原点用完即清');
  assert.equal(store.cancelOnboarding(), store.getState(), '没有还原点时退出是空操作');

  // 走完 onboarding（隐私页「完成设置」）→ 还原点作废，改动保留
  store.beginOnboarding();
  store.setRole('buddy');
  store.saveRoleProfile('buddy', { preferredTopics: ['local_culture'] });
  store.commitOnboarding();
  assert.equal(store.getState().runtime.onboarding, null);
  store.cancelOnboarding();
  assert.equal(store.getState().role, 'buddy', '提交之后退出不再回退');
  assert.deepEqual(store.getState().buddyProfile.preferredTopics, ['local_culture']);

  // 重置演示数据也要清掉还原点，否则下一次「退出」会还原到上一局的账号
  store.beginOnboarding();
  store.resetDemoData();
  assert.equal(store.getState().runtime.onboarding, null);
});

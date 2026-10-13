import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installDom, StubElement } from './helpers/dom-stub.mjs';

installDom();

const { createStore, createMemoryStorage } = await import('../src/app/store.js');
const { createMockApi } = await import('../src/services/mockApi.js');
const { createTranslator } = await import('../src/i18n/i18n.js');
const { labelOf } = await import('../src/data/labels.js');
const { ACHIEVEMENT_CATALOG } = await import('../src/data/achievements.js');
import { flush } from './helpers/app-harness.mjs';

const { ROUTES } = await import('../src/app/routes.js');
const { INTERESTS, NATIVE_LANGUAGES } = await import('../src/data/tags.js');
const { DEMO_POOL } = await import('./helpers/demoPool.mjs');

function fakeCtx({ role = 'learner', data = null, local = {} } = {}) {
  const store = createStore({ storage: createMemoryStorage() });
  if (role) store.setRole(role);
  const t = createTranslator('zh-Hans');
  const view = { data, error: null, loading: false, local };
  const el = new StubElement('div');
  const ctx = {
    el,
    view,
    t,
    label: (group, value) => labelOf(group, value, 'zh-Hans'),
    locale: 'zh-Hans',
    store,
    // 候选池是注入的（产品默认是空的）：页面要测「有人可推 / 可挑」的那几条分支，
    // 就得给它一个有人的世界。演示数据只活在 tests/ 里。
    api: createMockApi({ store, sleep: () => Promise.resolve(), candidates: DEMO_POOL }),
    params: {},
    query: {},
    path: '/',
    win: { history: { length: 2 }, location: { hash: '#/' }, __CANTOBRIDGE_DEV__: true, requestAnimationFrame: () => 0 },
    getState: () => store.getState(),
    navigate: () => {},
    paint: () => {},
    reload: () => {},
    watch: () => () => {},
    onCleanup: () => {},
    setBanner: () => {},
    clearBanner: () => {},
  };
  return ctx;
}

/** 包一层 api，记录某个方法的调用参数（用来钉住「页面真的发了请求」）。 */
function spyApi(ctx, method, calls) {
  const base = ctx.api;
  ctx.api = {
    ...base,
    [method]: async (...args) => {
      calls.push(args);
      return base[method](...args);
    },
  };
  return ctx;
}

const BARE_KEY = /(?:^|[\s（(])([a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9.]*)/;

/**
 * 按可见文字找按钮：比 class 选择器更接近「用户看到的」。
 * 用 includes 而不是全等——按钮里除了主标签还可能有说明小字（例如「随便聊」下面那句）。
 */
function findButton(node, label) {
  return node.walk().find((item) => item.tagName === 'BUTTON' && item.textContent.includes(label)) ?? null;
}

function renderPage(pageName, options) {
  const route = ROUTES.find((item) => item.page.name === pageName);
  assert.ok(route, '找不到页面 ' + pageName);
  const ctx = fakeCtx(options);
  const node = route.page.render(ctx, ctx.view);
  assert.ok(node, pageName + ' 没有渲染出任何东西');
  assert.equal(node.tagName !== undefined, true, pageName + ' 返回的不是 DOM 节点');
  return { node, ctx, text: node.textContent };
}

test('正式结算：评价和伙伴申请防重复，失败保留选择并可重试，成功显示状态', async () => {
  const route = ROUTES.find(item => item.page.name === 'SessionSummaryPage');
  for (const kind of ['feedback', 'request']) {
    const ctx = fakeCtx({ data: { reward: { roomId: 'r-1', peer: { peerId: 'p-1', displayName: '小晴' }, durationSec: 120 }, role: 'learner' }, local: { feedback: ['friendly'], request: 'none' } });
    let calls = 0, rejectPending;
    const method = kind === 'feedback' ? 'sendFeedback' : 'sendBuddyRequest';
    ctx.api[method] = () => { calls++; return new Promise((resolve, reject) => { rejectPending = reject; }); };
    const label = ctx.t(kind === 'feedback' ? 'summary.saveFeedback' : 'summary.sendRequest');
    const button = findButton(route.page.render(ctx, ctx.view), label);
    button.click(); button.click();
    assert.equal(calls, 1);
    const pending = route.page.render(ctx, ctx.view);
    assert.equal(findButton(pending, ctx.t(kind === 'feedback' ? 'summary.savingFeedback' : 'summary.sendingRequest')).disabled, true);
    rejectPending(new Error('offline')); await flush();
    assert.ok(route.page.render(ctx, ctx.view).textContent.includes(ctx.t(kind === 'feedback' ? 'summary.feedbackFailed' : 'summary.requestFailed')));
    assert.deepEqual(ctx.view.local.feedback, ['friendly']);
    ctx.api[method] = async () => { calls++; return { status: 'pending' }; };
    findButton(route.page.render(ctx, ctx.view), label).click(); await flush();
    const saved = route.page.render(ctx, ctx.view);
    assert.ok(saved.textContent.includes(ctx.t(kind === 'feedback' ? 'summary.feedbackSaved' : 'summary.requested')));
    assert.equal(calls, 2);
    if (kind === 'feedback') assert.equal(findButton(saved, ctx.t('summary.feedbackSaved')).disabled, true);
    else assert.equal(findButton(saved, ctx.t('summary.sendRequest')), null);
  }
});

const PAGES = [
  { name: 'LandingPage', data: null },
  { name: 'NotFoundPage', data: null },
  { name: 'RoleSelectPage', data: null },
  { name: 'PrivacySetupPage', data: null },
  { name: 'MockConsolePage', data: { disabled: false, waiting: 4 } },
  { name: 'HomePage', data: { progress: { xp: 360, conversations: 2, streakDays: 3, totalMinutes: 46, peopleHelped: 0, practiceMinutesThisWeek: 46 }, history: [], waitingCount: 0 } },
  { name: 'ProfilePage', data: { progress: { conversations: 2, totalMinutes: 46, streakDays: 3 }, history: [], me: {}, buddies: [{ peerId: 'ka-ho', label: 'ka-ho' }], requests: [{ peerId: 'wai-ling', label: '匿名伙伴', direction: 'incoming', status: 'pending' }] } },
  { name: 'LeaderboardPage', data: { weekly: { learner: [{ rank: 1, userId: 'mingzhu', anonymous: false, minutes: 96, xp: 620, isMe: false }], buddy: [] }, monthly: { learner: [], buddy: [] } } },
  { name: 'ShopPage', data: { shop: { balance: 0, ownedThemes: ['mint', 'warm'], catalog: [], transactions: [] } } },
  { name: 'HistoryPage', data: { history: [{ sessionId: 's-1', peerId: 'ka-ho', peerLabel: 'ka-ho', startedAt: '2026-09-21T21:10:00+08:00', durationSec: 1080, cardsUsed: 4, topics: ['anime'] }, { sessionId: 's-2', peerId: 'wai-ling', peerLabel: '匿名伙伴', startedAt: '2026-09-19T20:30:00+08:00', durationSec: 720, cardsUsed: 3, topics: ['travel'] }], buddies: [{ peerId: 'ka-ho', label: 'ka-ho' }], requests: [{ peerId: 'wai-ling', label: '匿名伙伴', direction: 'incoming', status: 'pending' }] } },
  { name: 'MatchPage', data: { candidates: [] } },
  {
    name: 'PeerPreviewPage',
    data: {
      candidate: { peerId: 'learner-demo-01', displayName: '匿名伙伴', anonymous: true, nativeLanguage: 'english', cantoneseLevel: 'beginner', identity: 'exchange_student', interests: ['anime', 'food'], matchedTags: ['anime'], matchScore: 86, roomAvailable: true },
      cards: [{ id: 'anime-beginner-01', topic: 'anime', difficulty: 'beginner', cantonese: '你最近睇緊咩動漫？', mandarin: '你最近在看什么动漫？', english: 'What anime have you been watching lately?', expressions: [] }],
    },
  },
  {
    name: 'SessionSummaryPage',
    data: { reward: { roomId: 'r-1', durationSec: 720, cardsUsed: 4, xpEarned: 92, unlocked: ['first_conversation'], peer: { peerId: 'ka-ho', displayName: 'ka-ho' }, role: 'learner' }, role: 'learner' },
  },
];

test('排行榜空榜说明三语可读，四张榜保持规则，并最多渲染三十人', () => {
  const data = { weekly: { learner: [], buddy: [] }, monthly: { learner: [], buddy: [] } };
  for (const period of ['weekly', 'monthly']) for (const role of ['learner', 'buddy']) {
    const { node, text } = renderPage('LeaderboardPage', { data, local: { period, role } });
    assert.ok(node.querySelector('.leaderboard-empty-rule'));
    assert.match(text, /30 秒/);
    assert.match(text, /30/);
  }
  for (const locale of ['zh-Hans', 'zh-Hant', 'en']) {
    const label = createTranslator(locale)('leaderboard.empty');
    assert.match(label, /30/);
  }
  data.weekly.learner = Array.from({ length: 35 }, (_, i) => ({ rank: i + 1, userId: `test-${i}`, minutes: 6, xp: 35 - i }));
  const { node } = renderPage('LeaderboardPage', { data, local: { period: 'weekly', role: 'learner' } });
  assert.equal(node.querySelectorAll('.leaderboard-row').length, 30);
});

test('成就墙四项预览，全屏十项，佩戴单称号可替换并卸下，未解锁不能点击', async () => {
  const route = ROUTES.find(item => item.page.name === 'ProfilePage');
  const ctx = fakeCtx({ data: { progress: { conversations: 10, totalMinutes: 40, streakDays: 3 }, history: [], me: {}, buddies: [], requests: [] } });
  Object.assign(ctx.store.getState().progress, ctx.view.data.progress);
  ctx.view.data.progress = await ctx.api.getProgress();
  let node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelectorAll('.badge').length, 4);
  assert.ok(node.textContent.includes('0.01%'));
  node.querySelector('.achievement-expand').click();
  node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelectorAll('.badge').length, 10);
  assert.equal(node.getAttribute('role'), 'dialog');
  assert.equal(node.querySelector('.is-locked').disabled, true);
  findButton(node, '第一次对话').click();
  await flush();
  assert.equal(ctx.store.getState().settings.equippedTitleId, 'first_conversation');
  node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelectorAll('.is-equipped').length, 1);
  findButton(node, '交流达人').click(); await flush();
  assert.equal(ctx.store.getState().settings.equippedTitleId, 'conversation_regular');
  node = route.page.render(ctx, ctx.view);
  findButton(node, '交流达人').click(); await flush();
  assert.equal(ctx.store.getState().settings.equippedTitleId, null);
  node = route.page.render(ctx, ctx.view);
  node.querySelector('.achievement-close').click();
  assert.equal(ctx.view.local.achievementsExpanded, false);
  const buddyCtx = fakeCtx({ role: 'buddy', data: { progress: {}, buddies: [], requests: [] }, local: { achievementsExpanded: true } });
  const buddyNode = route.page.render(buddyCtx, buddyCtx.view);
  assert.equal(buddyNode.querySelectorAll('.badge').length, 10);
});

test('个人页伙伴列表放在滚动窗口里，每个伙伴是带自己操作按钮的独立条目', () => {
  const { node } = renderPage('ProfilePage', {
    data: {
      progress: { conversations: 2, totalMinutes: 46, streakDays: 3 }, history: [], me: {},
      buddies: [{ peerId: 'ka-ho', label: 'ka-ho' }, { peerId: 'ming-chu', label: '明珠' }],
      requests: [{ peerId: 'wai-ling', label: '匿名伙伴', direction: 'incoming', status: 'pending' }],
    },
  });
  assert.ok(node.querySelector('.buddy-scroll'), '伙伴列表要包在滚动窗口里');
  assert.ok(node.querySelector('.buddy-scroll .buddy-slot'), '滚动窗口里放的应该是伙伴列表');
  const rows = node.querySelectorAll('.buddy-scroll .buddy-row');
  assert.equal(rows.length, 3, '两个已连接的伙伴加一条收到的申请');
  for (const row of rows) {
    assert.ok(row.querySelectorAll('button').length >= 1, '每个伙伴条目都要带自己的操作按钮');
  }
});

test('伙伴列表为空时，占位说明同样留在滚动窗口内', () => {
  const { node } = renderPage('ProfilePage', { data: { progress: {}, history: [], me: {}, buddies: [], requests: [] } });
  assert.ok(node.querySelector('.buddy-scroll .buddy-slot.is-empty'), '空状态不该跑到窗口外面');
  assert.equal(node.querySelectorAll('.buddy-scroll .buddy-row').length, 0);
});

for (const entry of PAGES) {
  test(entry.name + '：能渲染出内容，且不出现裸 key', () => {
    const role = entry.name === 'PeerPreviewPage' || entry.name === 'MatchPage' ? 'buddy' : 'learner';
    const { text } = renderPage(entry.name, { role, data: entry.data, local: { tab: role === 'buddy' ? 'browse' : 'waiting', buddyOnly: false, expanded: null, index: 0, saved: [], previewIndex: null, feedback: [], request: 'none' } });
    assert.ok(text.length > 0, '渲染结果是空的');
    const match = BARE_KEY.exec(text);
    assert.equal(match, null, '页面上出现了没有翻译的 key：' + (match ? match[1] : ''));
  });
}

test('ChatRoomPage：语音舞台 + 话题卡 + 控制条都能渲染', () => {
  const route = ROUTES.find((item) => item.page.name === 'ChatRoomPage');
  const ctx = fakeCtx({ role: 'learner' });
  ctx.view.local = { index: 0, saved: [], usedTopics: [], speakerOn: true, peerLeft: false, settling: false, animating: true, ticking: true };
  ctx.view.roomId = 'r-1';
  ctx.getState = () => ({ ...ctx.store.getState(), runtime: { ...ctx.store.getState().runtime, room: { roomId: 'r-1', role: 'learner', peer: { displayName: 'ka-ho', anonymous: false, interests: ['anime'] }, startedAt: Date.now() - 65000, status: 'live' } } });
  ctx.view.call = { snapshot: () => ({ mode: 'sim', status: 'live', muted: false, hasMic: true, peerLeft: false }), levels: () => ({ self: 0.5, peer: 0.4 }), toggleMute: () => {}, hangup: async () => {}, fallbackToSim: async () => {} };
  const node = route.page.render(ctx, {
    ...ctx.view,
    data: { deck: [{ id: 'anime-beginner-01', topic: 'anime', difficulty: 'beginner', cantonese: '你最近睇緊咩動漫？', mandarin: '你最近在看什么动漫？', english: 'What anime have you been watching lately?', expressions: [{ cantonese: '我最近睇緊……', mandarin: '我最近在看……', english: 'Lately I have been watching…' }] }], room: { roomId: 'r-1', role: 'learner', peer: { displayName: 'ka-ho', anonymous: false }, startedAt: Date.now() - 65000 } },
  });
  assert.match(node.textContent, /你最近睇緊咩動漫？/);
  assert.match(node.textContent, /我最近睇緊……/);
  assert.equal(node.querySelectorAll('.control-btn').length, 3);
  assert.ok(node.querySelector('.waveform'));
  assert.equal(node.querySelectorAll('.topic-card').length, 1);
});

/** 房间页要的那一套上下文：一叠三张卡、一个能用的 call、一个可注入的 rooms 表。 */
const ROOM_DECK = [
  { id: 'anime-beginner-01', topic: 'anime', difficulty: 'beginner', cantonese: '第一张', mandarin: '第一张', english: 'First', expressions: [] },
  { id: 'food-beginner-01', topic: 'food', difficulty: 'beginner', cantonese: '第二张', mandarin: '第二张', english: 'Second', expressions: [] },
  { id: 'music-beginner-01', topic: 'music', difficulty: 'beginner', cantonese: '第三张', mandarin: '第三张', english: 'Third', expressions: [] },
];

/**
 * 房间页的本地状态。字段要与 `pages/room.js` 的 `makeLocal()` 对齐：
 * `visited` 管**这一叠**的进度，「再来八张」会把它归零；
 * `sessionVisited` / `sessionTopics` 是**跨叠累计**，结算读的是这一份。
 */
function roomLocal(overrides = {}) {
  return {
    index: 0,
    visited: [],
    sessionVisited: [],
    sessionTopics: [],
    saved: [],
    speakerOn: true,
    peerLeft: false,
    settling: false,
    round: 0,
    followedFromPeer: false,
    ...overrides,
  };
}

/**
 * 房间页的上下文。`ctx.view.data` 必须**就地**写进去：翻牌/结算的回调读的是 `ctx.view`，
 * 传一份 `{...ctx.view}` 副本给 render 只会让「渲染」看得见、点按钮时读不到。
 */
function roomCtx(local) {
  const route = ROUTES.find((item) => item.page.name === 'ChatRoomPage');
  const ctx = fakeCtx({ role: 'learner' });
  ctx.rooms = new Map();
  ctx.view.local = local;
  ctx.view.roomId = 'r-1';
  ctx.view.call = { snapshot: () => ({ mode: 'sim', status: 'live', muted: false, hasMic: true, peerLeft: false }), levels: () => ({ self: 0.5, peer: 0.4 }), toggleMute: () => {}, hangup: async () => {}, fallbackToSim: async () => {}, subscribe: () => () => {} };
  const room = { roomId: 'r-1', role: 'learner', peer: { displayName: 'ka-ho', anonymous: false, interests: ['anime'] }, startedAt: Date.now() - 65000 };
  ctx.view.data = { deck: ROOM_DECK, room };
  ctx.getState = () => ({ ...ctx.store.getState(), runtime: { ...ctx.store.getState().runtime, room } });
  const render = () => route.page.render(ctx, ctx.view);
  return { route, ctx, room, render };
}

test('房间头像旁显示对方 ID 和公开兴趣；匿名隐藏身份，关闭公开兴趣时不泄露标签', () => {
  const { ctx, room, render } = roomCtx(roomLocal());
  room.peer.peerId = 'learner-user-123'; room.peer.interests = ['anime', '美食探索'];
  let node = render();
  assert.equal(node.querySelector('.call-status').textContent, 'learner-user-123');
  assert.deepEqual(node.querySelectorAll('.call-interests .pill').map(x => x.textContent), [ctx.label('interests', 'anime'), '美食探索']);
  room.peer.visibility = { interests: false };
  node = render(); assert.equal(node.querySelector('.call-interests'), null);
  assert.equal(node.querySelector('.call-interests-empty').textContent, ctx.t('room.noPublicInterests'));
  room.peer.interests = []; delete room.peer.visibility; room.peer.anonymous = true;
  node = render(); assert.equal(node.querySelector('.call-status').textContent, '匿名用户');
  assert.ok(!node.querySelector('.room-header').textContent.includes('ka-ho'));
  assert.ok(!node.textContent.includes('learner-user-123'));
});

test('ChatRoomPage：开场提示可关闭，已聊话题和卡片设置默认收起', () => {
  const { ctx, render } = roomCtx(roomLocal({ sessionTopics: ['anime'] }));
  const node = render();
  assert.ok(node.querySelector('.room-start-hint'));
  assert.equal(node.querySelector('.room-card-settings').getAttribute('open'), null);
  assert.equal(node.querySelector('.covered-block').getAttribute('open'), null);
  node.querySelector('.room-start-hint').querySelector('button').click();
  assert.equal(render().querySelector('.room-start-hint'), null);
  ctx.view.local.index = 1;
  ctx.view.local.index = 0;
  assert.equal(render().querySelector('.room-start-hint'), null);
});

test('ChatRoomPage：牌堆进度 + 「聊过了」标记；第一张时「‹」置灰', () => {
  const { ctx, render } = roomCtx(roomLocal({ visited: [ROOM_DECK[0].id], sessionVisited: [ROOM_DECK[0].id], sessionTopics: ['anime'] }));
  const node = render();

  const fill = node.querySelector('.deck-meter-fill');
  assert.ok(fill, '要有进度条');
  assert.equal(fill.style.props.width, '33%', '3 张里看过 1 张');
  assert.match(node.textContent, /看过 1 \/ 3 张/);

  const [prev, next] = node.querySelectorAll('.stack-nav .btn');
  assert.equal(prev.disabled, true, '第一张时「‹」要置灰');
  assert.ok(!next.disabled, '还能往后翻');

  assert.match(node.textContent, /聊过了/, '看过的卡要有标记');
  assert.match(node.textContent, /聊过的主题/);
  assert.match(node.textContent, /动漫/, '聊过的主题要用中文文案，不能露 key');
});

test('ChatRoomPage：到最后一张时给两条出路（再上八张 / 去结算），结算按「跨叠看过的张数」', async () => {
  const { ctx, render } = roomCtx(roomLocal({
    index: 2,
    visited: ROOM_DECK.map((card) => card.id),
    sessionVisited: ROOM_DECK.map((card) => card.id),
    sessionTopics: ['anime', 'food', 'music'],
  }));
  const calls = [];
  spyApi(ctx, 'endRoom', calls);
  const navigated = [];
  ctx.navigate = (to) => navigated.push(to);

  const node = render();
  const [prev, next] = node.querySelectorAll('.stack-nav .btn');
  assert.equal(next.disabled, true, '最后一张时「›」要置灰');
  assert.ok(!prev.disabled);
  assert.match(node.textContent, /已经是这一叠的最后一张了/);

  assert.ok(findButton(node, '再来八张'), '到头了要能再要一叠');
  const finish = findButton(node, '聊完，去结算');
  assert.ok(finish, '到头了要有明确出路，不能让「›」按下去没反应');
  finish.click();
  await flush();

  assert.equal(calls.length, 1, '结算要真的发出去');
  assert.equal(calls[0][0], 'r-1');
  assert.equal(calls[0][1].cardsUsed, 3, '看过的卡数是 3');
  assert.deepEqual(calls[0][1].topics, ['anime', 'food', 'music'], '主题按牌堆顺序、去重');
  assert.equal(navigated[0], '/room/r-1/summary');
});

test('ChatRoomPage：「再来八张」换一整叠新的：进度归零、旧一叠作废、跨叠累计不清零', async () => {
  const firstDeck = ROOM_DECK;
  const secondDeck = [
    { id: 'travel-beginner-01', topic: 'travel', difficulty: 'beginner', cantonese: '新一', mandarin: '新一', english: 'New one', expressions: [] },
    { id: 'gaming-beginner-01', topic: 'gaming', difficulty: 'beginner', cantonese: '新二', mandarin: '新二', english: 'New two', expressions: [] },
  ];
  const local = roomLocal({
    index: 2,
    visited: firstDeck.map((card) => card.id),
    sessionVisited: firstDeck.map((card) => card.id),
    sessionTopics: ['anime', 'food', 'music'],
  });
  const { ctx, render } = roomCtx(local);
  const asked = [];
  ctx.api.getCards = async (roomId, options) => {
    asked.push({ roomId, ...options });
    return { roomId, level: options.level, round: options.round, cards: secondDeck };
  };
  const sent = [];
  ctx.view.call.sendCard = (payload) => sent.push(payload);

  const node = render();
  findButton(node, '再来八张').click();
  await flush();

  assert.equal(asked.length, 1, '「再来八张」要真的去取一叠新的');
  assert.equal(asked[0].roomId, 'r-1');
  assert.equal(asked[0].round, 1, '第几叠加一 —— 服务端靠它换种子');
  assert.deepEqual(asked[0].exclude, firstDeck.map((card) => card.id), '把这一叠看过的卡传下去，新一叠才不会又是同一批');

  assert.deepEqual(ctx.view.data.deck, secondDeck, '整叠换掉，不是追加');
  assert.equal(local.round, 1);
  assert.equal(local.index, 0, '进度归零：从新一叠的第一张重新开始');
  assert.deepEqual(local.visited, [secondDeck[0].id], '旧一叠的 visited 作废');
  assert.deepEqual(
    local.sessionVisited,
    firstDeck.map((card) => card.id).concat(secondDeck[0].id),
    '跨叠累计不清零（结算的「聊过几张」不能被换叠抹掉）',
  );
  assert.deepEqual(local.sessionTopics, ['anime', 'food', 'music', 'travel'], '跨叠主题也继续累计');
  assert.deepEqual(sent, [{ cardId: secondDeck[0].id, index: 0, round: 1 }], '要告诉对面「我换到第 1 叠了」');
  assert.match(render().textContent, /看过 1 \/ 2 张/, '进度条跟着新一叠走');
});

test('ChatRoomPage：对面换了叠 —— 我跟着取同一叠，再跟到他那张，且绝不回推', async () => {
  const secondDeck = [
    { id: 'travel-beginner-01', topic: 'travel', difficulty: 'beginner', cantonese: '新一', mandarin: '新一', english: 'New one', expressions: [] },
    { id: 'gaming-beginner-01', topic: 'gaming', difficulty: 'beginner', cantonese: '新二', mandarin: '新二', english: 'New two', expressions: [] },
  ];
  const local = roomLocal({ visited: [ROOM_DECK[0].id], sessionVisited: [ROOM_DECK[0].id], sessionTopics: ['anime'] });
  const { ctx } = roomCtx(local);
  const asked = [];
  ctx.api.getCards = async (roomId, options) => {
    asked.push({ roomId, ...options });
    return { roomId, level: options.level, round: options.round, cards: secondDeck };
  };
  const sent = [];
  ctx.view.call.sendCard = (payload) => sent.push(payload);
  let push = null;
  ctx.view.call.onCard = (listener) => {
    push = listener;
    return () => { push = null; };
  };
  // 直接把「订阅」挂上（走的是 load 里同一段逻辑）
  const route = ROUTES.find((item) => item.page.name === 'ChatRoomPage');
  ctx.rooms.set('r-1', ctx.view.call);
  ctx.view.data = await route.page.load(ctx);
  assert.equal(typeof push, 'function', 'load 里必须把「对方翻卡」这条订阅挂上');

  // `load` 会用 `makeLocal()` **换掉** ctx.view.local，所以后面一律读 ctx.view.local
  const state = ctx.view.local;
  assert.equal(state.round, 0, '进房拿的是第 0 叠');

  // 对面换到第 1 叠并翻到第二张
  push({ cardId: secondDeck[1].id, index: 1, round: 1 });
  await flush();

  assert.equal(asked.length, 2, '第一次是进房那一叠，第二次是跟着对面换的那一叠');
  assert.equal(asked[0].round, 0);
  assert.equal(asked.at(-1).round, 1, '跟着对面换到第 1 叠');
  assert.equal(state.round, 1);
  assert.equal(state.index, 1, '取回来之后跟到他那张');
  assert.equal(state.followedFromPeer, true);
  assert.deepEqual(sent, [], '跟着换 / 跟着翻都不回推，否则两边互相触发');
});

test('ChatRoomPage：翻牌记下看过的卡，来回滑不重复计数、到头了也不越界', () => {
  const { ctx, render } = roomCtx(roomLocal({ visited: [ROOM_DECK[0].id], sessionVisited: [ROOM_DECK[0].id], sessionTopics: ['anime'] }));

  render().querySelectorAll('.stack-nav .btn')[1].click();
  assert.equal(ctx.view.local.index, 1);
  assert.deepEqual(ctx.view.local.visited, [ROOM_DECK[0].id, ROOM_DECK[1].id], '翻到第二张就记下第二张');

  // 重新渲染等价于 ctx.paint()：进度条要跟着走
  assert.equal(render().querySelector('.deck-meter-fill').style.props.width, '67%');

  const back = render().querySelectorAll('.stack-nav .btn')[0];
  back.click();
  back.click(); // 已经在第一张，再点应当没反应
  assert.equal(ctx.view.local.index, 0);
  assert.deepEqual(
    ctx.view.local.visited,
    [ROOM_DECK[0].id, ROOM_DECK[1].id],
    '来回滑不该把同一张记两次（否则结算的 cardsUsed 会虚高）',
  );

  // 末张再往后也不越界
  const forward = render().querySelectorAll('.stack-nav .btn')[1];
  forward.click();
  forward.click();
  forward.click();
  assert.equal(ctx.view.local.index, ROOM_DECK.length - 1, '最多停在最后一张');
});

test('ChatRoomPage：双方看同一张——我翻卡要告诉对方，对方翻卡我要跟过去且不回推', async () => {
  const route = ROUTES.find((item) => item.page.name === 'ChatRoomPage');
  const sent = [];
  let push = null;
  // 替身会话：只关心「谁发了什么、收到什么」，不碰真 WebSocket
  const stubCall = {
    snapshot: () => ({ mode: 'remote', status: 'live', muted: false, hasMic: true, peerLeft: false }),
    levels: () => ({ self: 0, peer: 0 }),
    toggleMute: () => {},
    hangup: async () => {},
    fallbackToSim: async () => {},
    subscribe: () => () => {},
    onCard: (listener) => {
      push = listener;
      return () => { push = null; };
    },
    sendCard: (payload) => sent.push(payload),
  };
  const ctx = fakeCtx({ role: 'learner' });
  // `getSession()` 见到 rooms 里已经有这一间就直接复用，于是走真 `load()` 也不会起真通话
  ctx.rooms = new Map([['r-1', stubCall]]);
  ctx.view.roomId = 'r-1';
  const room = { roomId: 'r-1', role: 'learner', peer: { displayName: 'ka-ho', anonymous: false, interests: ['anime'] }, startedAt: Date.now() - 65000 };
  ctx.getState = () => ({ ...ctx.store.getState(), runtime: { ...ctx.store.getState().runtime, room } });

  ctx.view.data = await route.page.load(ctx);
  const deck = ctx.view.data.deck;
  assert.ok(deck.length >= 3, '要有一叠卡才谈得上翻牌');
  assert.deepEqual(ctx.view.local.visited, [deck[0].id], '进房第一张就算看过了');
  assert.equal(typeof push, 'function', 'load 里必须把「对方翻卡」这条订阅挂上');

  const render = () => route.page.render(ctx, ctx.view);

  // 我翻到第二张 → 上行一条 card（带 id、序号与第几叠，对方按 id 也能找回同一张）
  render().querySelectorAll('.stack-nav .btn')[1].click();
  assert.deepEqual(sent, [{ cardId: deck[1].id, index: 1, round: 0 }]);

  // 对方翻到第三张 → 我跟过去
  push({ cardId: deck[2].id, index: 2 });
  assert.equal(ctx.view.local.index, 2, '对方翻到哪张，我就看哪张');
  assert.equal(ctx.view.local.followedFromPeer, true);
  assert.equal(sent.length, 1, '跟着对方翻**绝不能回推**，否则两边来回弹成死循环');
  assert.match(render().textContent, /已跟到对方翻的那一张/);

  // 牌堆漂移：序号越界时按 cardId 找回来
  ctx.view.local.index = 0;
  push({ cardId: deck[2].id, index: 99 });
  assert.equal(ctx.view.local.index, 2, '序号指不到就按 cardId 找');

  // 我自己翻一次 → 提示收掉，并重新上行
  render().querySelectorAll('.stack-nav .btn')[0].click();
  assert.equal(ctx.view.local.followedFromPeer, false);
  assert.equal(sent.length, 2);

  // 越界的载荷直接忽略，不炸
  push({ cardId: 'nope', index: 99 });
  assert.equal(ctx.view.local.index, 1);
});

test('ChatRoomPage：收藏接口失败时本地照样记下（可后置端点的兜底）', async () => {
  const route = ROUTES.find((item) => item.page.name === 'ChatRoomPage');
  const ctx = fakeCtx({ role: 'learner' });
  ctx.view.local = { index: 0, saved: [], usedTopics: [], speakerOn: true, peerLeft: false, settling: false };
  ctx.view.roomId = 'r-1';
  const room = { roomId: 'r-1', role: 'learner', peer: { displayName: 'ka-ho', anonymous: false, interests: ['anime'] }, startedAt: Date.now() - 65000 };
  ctx.getState = () => ({ ...ctx.store.getState(), runtime: { ...ctx.store.getState().runtime, room } });
  ctx.view.call = { snapshot: () => ({ mode: 'sim', status: 'live', muted: false, hasMic: true, peerLeft: false }), levels: () => ({ self: 0.5, peer: 0.4 }), toggleMute: () => {}, hangup: async () => {}, fallbackToSim: async () => {} };
  const phrase = { cantonese: '我最近睇緊……', mandarin: '我最近在看……', english: 'Lately I have been watching…' };
  const deck = [{ id: 'anime-beginner-01', topic: 'anime', difficulty: 'beginner', cantonese: '你最近睇緊咩動漫？', mandarin: '你最近在看什么动漫？', english: 'What anime have you been watching lately?', expressions: [phrase] }];
  let attempts = 0;
  // 后端清单里这个端点是「可后置」的：联调期它多半是 501，前端不能因此点了没反应
  ctx.api.savePhrase = async () => {
    attempts += 1;
    throw new Error('501 not implemented');
  };
  const view = { ...ctx.view, data: { deck, room } };
  const node = route.page.render(ctx, view);
  const star = node.querySelectorAll('.phrase-star')[0];
  assert.ok(star, '收藏按钮没有渲染');
  star.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 1, '接口该调还是要调（后端接了就直接生效）');
  assert.deepEqual(ctx.view.local.saved, [phrase.cantonese], '接口失败时本地也要把这一笔记下');
  // 重新渲染等价于 ctx.paint()：星星必须是点亮状态
  const again = route.page.render(ctx, view);
  assert.equal(again.querySelectorAll('.phrase-chip')[0].classList.contains('is-saved'), true, '接口失败时星星也要点亮');
});
test('每个页面的 titleKey 都能翻译出真实文案', () => {
  const t = createTranslator('zh-Hans');
  for (const route of ROUTES) {
    const title = t(route.titleKey);
    assert.notEqual(title, route.titleKey, route.path + ' 的标题没有翻译：' + route.titleKey);
    assert.ok(title.length > 0);
  }
});

test('匹配大厅：等待面板上的「取消匹配」退出队列，并作废还没接受的匹配请求', async () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({
    role: 'learner',
    data: { candidates: [] },
    local: { tab: 'waiting', criteriaOpen: false, criteriaDraft: null, timeoutShown: false },
  });
  ctx.store.startQueue({ anonymous: false });
  ctx.store.receiveMatchRequest({ roomId: 'r-1', peer: { displayName: 'wai-ling' } });
  const navigated = [];
  ctx.navigate = (to) => navigated.push(to);

  const node = route.page.render(ctx, ctx.view);
  const cancel = node.walk().find((item) => item.tagName === 'BUTTON' && item.textContent === '取消匹配');
  assert.ok(cancel, '等待面板上要有「取消匹配」出口');

  cancel.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ctx.store.getState().runtime.queue, null, '取消匹配要退出队列');
  assert.equal(ctx.store.getState().runtime.matchRequest, null, '取消匹配要作废还没接受的请求');
  assert.equal(ctx.store.getState().runtime.notice.messageKey, 'match.cancelled', '要留下一条「已取消」的提示');
  assert.deepEqual(navigated, ['/home'], '取消之后回首页');
});

test('匹配大厅：兴趣选择器已经退场（没排队和排队中都没有）', async () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({ role: 'learner', data: { candidates: [] }, local: { tab: 'waiting', timeoutShown: false } });

  // 没排队：开始卡片上没有兴趣选择器，也没有「随便聊」
  let node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelector('.criteria-editor'), null, '开始卡片上不该有兴趣选择器');
  assert.equal(node.querySelector('.tag-picker'), null, '开始卡片上不该有任何标签选择器');
  assert.equal(findButton(node, '随便聊'), null, '「随便聊」已经退场');
  assert.equal(findButton(node, '放宽匹配条件'), null, '没排队时也没有「放宽匹配条件」');

  // 排队中：等待面板同样没有任何改条件入口
  ctx.store.startQueue({ anonymous: false });
  node = route.page.render(ctx, ctx.view);
  assert.ok(node.querySelector('.waiting-panel'), '排队后是等待面板');
  assert.equal(node.querySelector('.criteria-editor'), null, '等待面板里不该有条件编辑器');
  assert.equal(findButton(node, '放宽匹配条件'), null, '「放宽匹配条件」已经退场');
  assert.equal(findButton(node, '收起'), null, '没有可收起的东西');

  // 匹配度仍然按资料里的兴趣算：资料有变化时摘要跟着变（但页面不给修改入口）
  ctx.store.saveRoleProfile('learner', { cantoneseLevel: 'beginner', interests: ['anime', 'food'] });
  node = route.page.render(ctx, ctx.view);
  assert.match(node.textContent, /初學者|初学者/, '摘要里仍然带资料里的水平');
  assert.match(node.textContent, /動漫|动漫/, '摘要里仍然带资料里的兴趣');
  assert.equal(node.querySelectorAll('.waiting-panel button').length, 1, '等待面板只剩「取消匹配」一个按钮');
});

test('匹配大厅：学习者只看开始流程，候选浏览只给母语者', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const learner = fakeCtx({ role: 'learner', data: { candidates: [] }, local: { tab: 'waiting', timeoutShown: false } });
  const learnerNode = route.page.render(learner, learner.view);
  assert.equal(learnerNode.querySelector('.segment'), null, '学习者不需要只有一个有效选项的标签切换');
  assert.equal(learnerNode.querySelector('.demo-room-entry'), null, '正式匹配页不混入演示房间入口');

  const buddy = fakeCtx({ role: 'buddy', data: { candidates: [] }, local: { tab: 'waiting', timeoutShown: false } });
  const buddyNode = route.page.render(buddy, buddy.view);
  assert.ok(buddyNode.querySelector('.segment'), '母语者仍可在等待状态和候选列表之间切换');
});

test('匹配大厅：真后端档位不显示演示伙伴救场', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({ role: 'learner', data: { candidates: [] }, local: { tab: 'waiting', timeoutShown: true } });
  ctx.win.__CANTOBRIDGE_DEV__ = false;
  ctx.store.startQueue({ anonymous: false });
  const node = route.page.render(ctx, ctx.view);
  assert.equal(findButton(node, '使用演示伙伴'), null, '真实产品不能把模拟对象伪装成真人匹配结果');
});

test('匹配大厅：没排队时是一张开始卡片（不是等待面板）', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({ role: 'learner', data: { candidates: [] }, local: { tab: 'waiting', timeoutShown: false } });
  const node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelector('.waiting-panel'), null, '还没排队就不该有等待面板');
  assert.ok(node.querySelector('.match-start'), '没排队时应当是开始卡片');
  assert.equal(node.querySelector('.criteria-editor'), null, '匹配前不再选兴趣');
  // 标题取自 i18n 而不是硬编码：改文案不该连带改测试（也钉住「不再提选主题」）
  assert.ok(node.textContent.includes(ctx.t('match.readyTitle')), '开始卡片标题取自 i18n');
  assert.doesNotMatch(node.textContent, /选想聊的主题|选好主题/, '开始卡片不再要求先选主题');
  assert.equal(findButton(node, '收起'), null, '开始卡片只有一个出路，没有「收起」');
  assert.equal(findButton(node, '开始匹配').textContent, '开始匹配');
});

test('匹配大厅：点「开始匹配」直接入队，不再写任何匹配条件', async () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({ role: 'learner', data: { candidates: [] }, local: { tab: 'waiting', timeoutShown: false } });
  const node = route.page.render(ctx, ctx.view);
  assert.equal(ctx.store.getState().runtime.queue, null, '渲染开始卡片本身不该入队');
  findButton(node, '开始匹配').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ctx.store.getState().settings.matchCriteria, null, '不再写匹配条件（兴趣只在资料里维护）');
  assert.ok(ctx.store.getState().runtime.queue, '点一下就直接入队');
  const after = route.page.render(ctx, ctx.view);
  assert.ok(after.querySelector('.waiting-panel'), '入队后原地换成等待面板');
  assert.equal(after.querySelector('.match-start'), null, '入队后不该还挂着开始卡片');
});

test('匹配大厅：母语者也能从等待面板取消匹配', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({ role: 'buddy', data: { candidates: [] }, local: { tab: 'waiting', criteriaOpen: false, criteriaDraft: null, timeoutShown: false } });
  ctx.store.startQueue({ anonymous: false });
  const node = route.page.render(ctx, ctx.view);
  const cancel = node.walk().find((item) => item.tagName === 'BUTTON' && item.textContent === '取消匹配');
  assert.ok(cancel, '母语者的等待面板同样要有出口：两种身份都能退出排队');
});

test('落地页：只有「开始使用」一个入口，没有「我是粤语母语者」身份捷径', () => {
  const { node } = renderPage('LandingPage', { data: null });
  const labels = node.walk().filter((item) => item.tagName === 'BUTTON').map((item) => item.textContent);
  assert.ok(labels.some((label) => label.includes('开始使用')), '主按钮是「开始使用」');
  assert.equal(labels.some((label) => label.includes('演示控制台')), false, '普通用户入口不暴露开发控制台');
  assert.equal(node.querySelectorAll('.btn-primary').length, 1, '落地页保留一个注册入口');
  assert.equal(node.querySelector('.landing-language').querySelectorAll('button').length, 3, '注册前可选择三种语言');
  assert.equal(labels.some((label) => label.includes('粤语母语者')), false, '不该再有身份捷径按钮');
  assert.equal(node.textContent.includes('landing.login'), false, '不该出现已删除文案的裸 key');
});

test('身份选择页：卡上不再有示例标签，且一张都不预选', () => {
  const route = ROUTES.find((item) => item.page.name === 'RoleSelectPage');
  const ctx = fakeCtx({ data: null });
  const node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelectorAll('.role-card').length, 2, '两张身份卡都在');
  assert.equal(node.querySelectorAll('.role-examples').length, 0, '卡上不再列示例标签');
  assert.equal(node.querySelectorAll('.role-card.is-selected').length, 0, '一张都不预选');
  assert.equal(findButton(node, '下一步').disabled, true, '没选身份就不能进入下一步');
});

test('成就目录与页面用到的枚举文案一一对应', async () => {
  const { ENUM_LABELS } = await import('../src/data/labels.js');
  for (const item of ACHIEVEMENT_CATALOG) {
    assert.ok(ENUM_LABELS.achievements[item.id], '成就缺少文案：' + item.id);
  }
});

test('匹配大厅：顶部的教 / 学标签由身份派生，只读不可选', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const learner = fakeCtx({ role: 'learner', data: { candidates: [] }, local: { tab: 'waiting', criteriaOpen: false, criteriaDraft: null, timeoutShown: false } });
  let node = route.page.render(learner, learner.view);

  // 开始卡片上就有：标签在页面顶部，页面上没有任何勾选器
  assert.ok(node.querySelector('.match-start'), '没排队时是开始卡片');
  const row = node.querySelector('.own-intent-row');
  assert.ok(row, '匹配页顶部要有教 / 学标签');
  assert.equal(row.textContent, learner.label('matchIntents', 'learn'), '学习者 = 学粤语');
  assert.equal(row.querySelectorAll('button').length, 0, '只读标签，不是可以点的选项');
  assert.equal(node.querySelector('.intent-pill'), null, '页面上不该有意图勾选器');

  // 换身份 → 标签自己跟着换，页面不做任何选择
  const buddy = fakeCtx({ role: 'buddy', data: { candidates: [] }, local: { tab: 'browse', criteriaOpen: false, criteriaDraft: null, timeoutShown: false } });
  node = route.page.render(buddy, buddy.view);
  const buddyRow = node.querySelector('.own-intent-row');
  assert.equal(buddyRow.textContent, buddy.label('matchIntents', 'teach'), '母语者 = 教粤语');
});

test('匹配大厅：候选人列表优先用匹配频道推来的那份，没收到过推送才回落到 REST 的结果', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const ctx = fakeCtx({
    role: 'buddy',
    data: { candidates: [{ peerId: 'rest-1', displayName: 'REST 里的人' }] },
    local: { tab: 'browse', timeoutShown: false },
  });

  // 还没收到过推送（matchPeers 为 null）→ 回落到进页面时 REST 拉的那份
  assert.equal(ctx.getState().runtime.matchPeers, null);
  let node = route.page.render(ctx, ctx.view);
  assert.match(node.textContent, /REST 里的人/, '没收到过推送时用 REST 的结果');

  // 匹配频道推来新列表 → 立刻改用它（推送的那份更新），REST 的旧结果不再显示
  ctx.store.hydrateMatchPeers([{ peerId: 'push-1', displayName: '推送来的人' }]);
  node = route.page.render(ctx, ctx.view);
  assert.match(node.textContent, /推送来的人/, '有推送时用推送的那份');
  assert.doesNotMatch(node.textContent, /REST 里的人/, '推送优先，不该混进 REST 的旧结果');

  // 被摘走（match:taken）→ 列表就地淡出，不用重新拉接口
  ctx.store.dropMatchPeer('push-1');
  node = route.page.render(ctx, ctx.view);
  assert.doesNotMatch(node.textContent, /推送来的人/, '被摘走的候选人要消失');
  assert.ok(node.textContent.includes(ctx.t('match.empty')), '摘空之后回到空态');
});

test('资料页：一屏一题的问卷，滑动 / 按钮换题，草稿跨题保留', () => {
  const route = ROUTES.find((item) => item.page.name === 'ProfileSetupPage');
  const pagerOf = (tree) => tree.querySelector('.question-pager');

  // 学习者 5 题：母语 / 粤语水平 / 兴趣 / 学习目标 / 身份
  const ctx = fakeCtx({ role: 'learner' });
  const render = () => route.page.render(ctx, ctx.view);
  let node = render();
  assert.ok(pagerOf(node), '资料页应当渲染出分页问卷');
  assert.equal(pagerOf(node).dataset.index, '0');
  assert.equal(pagerOf(node).dataset.total, '6');
  assert.ok(node.textContent.includes('第 1 / 6 项'), '页面上要写清第几题：' + node.textContent.slice(0, 160));
  assert.equal(findButton(node, '上一项').disabled, true, '首项没有上一项');

  // 第 1 题选一个母语，再往后走，回头时选择还在
  findButton(node, labelOf('nativeLanguages', 'mandarin', 'zh-Hans')).click();
  node = render();
  assert.equal(ctx.view.local.form.nativeLanguage, 'mandarin', '选中即写进草稿');
  findButton(node, '下一项').click();
  node = render();
  assert.equal(pagerOf(node).dataset.index, '1', '「下一项」换到第 2 题');
  assert.ok(node.textContent.includes(labelOf('levels', 'beginner', 'zh-Hans')), '第 2 题是粤语水平');

  // 滑动换题：左划前进到第 3 题（兴趣）
  const card = node.querySelector('.question-body');
  card.dispatch('pointerdown', { clientX: 220 });
  card.dispatch('pointerup', { clientX: 140 });
  node = render();
  assert.equal(pagerOf(node).dataset.index, '2', '左划等于「下一项」');
  assert.ok(node.textContent.includes(labelOf('interests', 'anime', 'zh-Hans')), '第 3 题是兴趣标签');
  findButton(node, labelOf('interests', 'travel', 'zh-Hans')).click();
  node = render();
  assert.equal(ctx.view.local.form.interests.includes('travel'), true, '兴趣也写进同一份草稿');
  assert.equal(node.querySelector('.tag-picker-rows'), null, '兴趣仍使用标签布局');

  node.querySelector('.custom-tag-trigger').click();
  const customInput = node.querySelector('.custom-tag-input');
  customInput.value = '陶艺';
  customInput.dispatch('input');
  node.querySelector('.custom-tag-editor .btn-primary').click();
  node = render();
  assert.ok(ctx.view.local.form.interests.includes('陶艺'));
  assert.ok(findButton(node, '陶艺').classList.contains('is-selected'));

  // 右划两次回到第 1 题：母语仍是刚才选的
  node.querySelector('.question-body').dispatch('pointerdown', { clientX: 100 });
  node.querySelector('.question-body').dispatch('pointerup', { clientX: 190 });
  node = render();
  node.querySelector('.question-body').dispatch('pointerdown', { clientX: 100 });
  node.querySelector('.question-body').dispatch('pointerup', { clientX: 190 });
  node = render();
  assert.equal(pagerOf(node).dataset.index, '0', '右划回到第 1 题');
  assert.ok(findButton(node, labelOf('nativeLanguages', 'mandarin', 'zh-Hans')).classList.contains('is-selected'), '回到第 1 题，之前的选择还在');

  // 末项：那颗按钮换成**可点的「下一步」**（不再是禁用的「下一项」），
  // 且「暂时跳过」始终可点——分页不制造新的关卡，但走到头得有出口
  ctx.view.local.step = 3;
  node = render();
  assert.ok(node.querySelector('.tag-picker-rows'), '学习目标每个选项独占一行');
  const goalChoices = node.querySelectorAll('.tag-picker-rows .pill');
  goalChoices[0].click();
  const firstGoal = ctx.view.local.form.learningGoal;
  node = render();
  node.querySelectorAll('.tag-picker-rows .pill')[1].click();
  assert.notEqual(ctx.view.local.form.learningGoal, firstGoal, '单选直接切换');
  node = render();
  assert.equal(node.querySelectorAll('.tag-picker-rows .is-selected').length, 1);
  ctx.view.local.step = 4;
  node = render();
  assert.ok(node.querySelector('.tag-picker-rows'), '身份每个选项独占一行');
  node.querySelector('.tag-picker-rows .pill').click();
  node = render();
  assert.equal(node.querySelectorAll('.tag-picker-rows .is-selected').length, 1);
  assert.equal(pagerOf(node).dataset.index, '4');
  findButton(node, '下一项').click();
  node = render();
  assert.equal(pagerOf(node).dataset.index, '5');
  const finalButton = findButton(node, '下一步');
  assert.ok(finalButton, '末项应当把「下一项」换成「下一步」');
  assert.notEqual(finalButton.disabled, true, '末项的「下一步」必须可点');
  assert.equal(findButton(node, '下一项'), null, '末项不再显示「下一项」');
  assert.ok(findButton(node, '暂时跳过'), '「暂时跳过」任何一题都点得到');

  // 母语者 4 题：兴趣 / 身份 / 可选的「我也想练 X」/ 头像，第 1 题就是兴趣
  // （「愿意聊的话题」已于 2026-10-12 从注册流程移除：字段与词表仍在，只是不再问）
  const buddyCtx = fakeCtx({ role: 'buddy' });
  const buddyNode = route.page.render(buddyCtx, buddyCtx.view);
  assert.equal(pagerOf(buddyNode).dataset.total, '4');
  assert.ok(buddyNode.textContent.includes(labelOf('interests', 'anime', 'zh-Hans')), '母语者第 1 题是兴趣');
});

test('个人页：第一次切到没配过资料的身份 → 直接进资料页并立还原点', () => {
  const route = ROUTES.find((item) => item.page.name === 'ProfilePage');
  const zh = createTranslator('zh-Hans');

  // 母语者资料默认还没配过：切换按钮下面先说清楚「要当场补资料」
  const ctx = fakeCtx({ role: 'learner', data: { progress: { conversations: 2, totalMinutes: 46, streakDays: 3 }, history: [], me: {}, buddies: [], requests: [] } });
  const navigate = [];
  ctx.navigate = (to) => navigate.push(to);
  const node = route.page.render(ctx, ctx.view);
  assert.ok(node.textContent.includes(zh('me.switchNeedsSetup')), '缺少「第一次切换要先填资料」的提示');
  const before = JSON.parse(JSON.stringify(ctx.store.getState().buddyProfile));
  findButton(node, zh('me.switchTo')).click();
  assert.equal(ctx.store.getState().role, 'buddy', '目标身份成为当前身份');
  assert.ok(ctx.store.getState().runtime.onboarding, '立了还原点，退出能整段还原');
  assert.deepEqual(navigate, ['/onboarding/profile'], '直接去资料页（onboarding 第 2 步），不再等用户点「匹配」');
  assert.deepEqual(ctx.store.getState().buddyProfile, before, '还没提交，资料不动');

  // 目标身份已经配过资料：只是原地切换，不跳页面、不留还原点
  const ready = fakeCtx({ role: 'learner', data: { progress: { conversations: 2, totalMinutes: 46, streakDays: 3 }, history: [], me: {}, buddies: [], requests: [] } });
  ready.store.saveRoleProfile('buddy', { identity: 'university_student' });
  const navigate2 = [];
  ready.navigate = (to) => navigate2.push(to);
  const readyNode = route.page.render(ready, ready.view);
  assert.equal(readyNode.textContent.includes(zh('me.switchNeedsSetup')), false, '已配好资料时不显示补资料提示');
  findButton(readyNode, zh('me.switchTo')).click();
  assert.equal(ready.store.getState().role, 'buddy');
  assert.equal(ready.store.getState().runtime.onboarding, null, '不是第一次，不需要还原点');
  assert.deepEqual(navigate2, [], '原地切换，不打断当前页面');
});

/** 2026-09-29「语言交换 + 供给优先」：B 的第 4 题、C 的首页推荐块、以及身份派生的边界。 */

test('资料页：母语者第 3 题是可选的「我也想练」，不填也能完成', async () => {
  const route = ROUTES.find((item) => item.page.name === 'ProfileSetupPage');
  const zh = createTranslator('zh-Hans');
  const ctx = fakeCtx({ role: 'buddy' });
  const navigate = [];
  ctx.navigate = (to) => navigate.push(to);

  let node = route.page.render(ctx, ctx.view);
  assert.equal(node.querySelector('.question-pager').dataset.total, '4', '母语者现在是 4 题：兴趣 / 身份 / 我也想练 / 头像');

  ctx.view.local.step = 2;
  node = route.page.render(ctx, ctx.view);
  assert.ok(node.textContent.includes(zh('setup.wantToLearn')), '第 3 题标题是「我也想练…」');
  assert.ok(node.textContent.includes(zh('setup.wantToLearnHint')), '要写清「不填也行」');
  // 取值复用母语词表：普通话 / English / Other，**粤语不在里面**
  for (const value of NATIVE_LANGUAGES) {
    assert.ok(findButton(node, labelOf('nativeLanguages', value, 'zh-Hans')), value + ' 应当可选');
  }
  assert.equal(NATIVE_LANGUAGES.includes('yue'), false, '回礼不能是粤语，否则「交换」退化成单向教学');
  assert.equal(findButton(node, labelOf('nativeLanguages', 'yue', 'zh-Hans')), null);

  // 一个都不选，直接点「暂时跳过」：这题不是关卡
  findButton(node, '暂时跳过').click();
  node = route.page.render(ctx, ctx.view);
  findButton(node, zh('setup.nextStep')).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(navigate, ['/onboarding/privacy'], '不填也照样进下一步');
  assert.deepEqual(ctx.store.getState().buddyProfile.wantToLearn, [], '不填 = 空数组（不是 null，也不是必填）');
  assert.equal(ctx.store.getState().buddyProfile.onboarded, true);

  // 选了再跳过：写进母语者资料，学习者资料一个字段都不动
  const picked = fakeCtx({ role: 'buddy' });
  picked.navigate = () => {};
  picked.view.local.step = 2;
  const learnerBefore = JSON.parse(JSON.stringify(picked.store.getState().learnerProfile));
  const pickedNode = route.page.render(picked, picked.view);
  findButton(pickedNode, labelOf('nativeLanguages', 'mandarin', 'zh-Hans')).click();
  findButton(pickedNode, '暂时跳过').click();
  findButton(route.page.render(picked, picked.view), zh('setup.nextStep')).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(picked.store.getState().buddyProfile.wantToLearn, ['mandarin']);
  assert.deepEqual(picked.store.getState().learnerProfile, learnerBefore, '两份资料分开存，互不覆盖');
});

test('首页：学习者的「推荐伙伴」三态齐全，点「直接聊」一键成房', async () => {
  const route = ROUTES.find((item) => item.page.name === 'HomePage');
  const zh = createTranslator('zh-Hans');

  // 加载中：主 CTA 与推荐块标题先渲染，推荐块本身是骨架
  const loading = fakeCtx({ role: 'learner', data: null });
  loading.view.loading = true;
  let node = route.page.render(loading, loading.view);
  assert.ok(node.querySelector('.home-action'), '主 CTA 不依赖数据，loading 时就要在');
  assert.ok(node.querySelector('.recommend-block'), '推荐块要有骨架，不能整块消失');
  assert.ok(node.textContent.includes(zh('home.recommendTitle')));
  assert.ok(node.querySelector('.skeleton-list'), '推荐块用 list 变体骨架');

  // 空：整块收成一行 + 一个去匹配页的按钮，首页不会因为一个模块没数据就变空白
  const empty = fakeCtx({ role: 'learner', data: { progress: {}, history: [], recommended: [] } });
  node = route.page.render(empty, empty.view);
  assert.ok(node.textContent.includes(zh('home.recommendEmpty')));
  assert.equal(findButton(node, zh('home.goMatch')), null, '空推荐不重复主入口');
  assert.ok(findButton(node, zh('home.learnerCta')), '唯一主入口仍然可用');
  assert.ok(node.querySelector('.first-chat-note'));
  assert.ok(node.querySelector('.home-action'), '空态不影响主 CTA');

  // 失败：只收一行提示，其它模块照常
  const failed = fakeCtx({ role: 'learner', data: { progress: {}, history: [], recommended: [], recommendFailed: true } });
  node = route.page.render(failed, failed.view);
  assert.ok(node.textContent.includes(zh('home.recommendFailed')));
  assert.ok(node.querySelector('.home-action'), '推荐取不到不能把首页拖成失败页');
  assert.ok(node.querySelector('.first-chat-note'), '新用户显示第一次聊天的引导');
  const returning = fakeCtx({ data: { progress: { conversations: 2, totalMinutes: 10 }, history: [] } });
  assert.ok(route.page.render(returning, returning.view).querySelector('.tile-grid'), '有交流记录后展示统计');

  // 就绪：top 3，互补的那位带徽标 + 「TA 也想练 X」
  const recommended = [
    { peerId: 'wai-ling', displayName: 'wai-ling', anonymous: false, interests: ['food', 'travel'], matchedTags: ['food'], matchScore: 68, complement: false, complementLanguage: null, wantToLearn: ['mandarin'], nativeLanguages: ['yue'] },
    { peerId: 'ka-ho', displayName: 'ka-ho', anonymous: false, interests: ['movies', 'music'], matchedTags: ['movies'], matchScore: 40, complement: true, complementLanguage: 'english', wantToLearn: ['english'], nativeLanguages: ['yue'] },
    { peerId: 'siu-fung', displayName: 'siu-fung', anonymous: false, interests: ['music'], matchedTags: [], matchScore: 40, complement: false, complementLanguage: null, wantToLearn: [], nativeLanguages: ['yue'] },
    { peerId: 'extra', displayName: 'extra', anonymous: false, interests: [], matchedTags: [], matchScore: 40, complement: false, complementLanguage: null, wantToLearn: [], nativeLanguages: ['yue'] },
  ];
  const ready = fakeCtx({ role: 'learner', data: { progress: {}, history: [], recommended } });
  const navigate = [];
  ready.navigate = (to) => navigate.push(to);
  node = route.page.render(ready, ready.view);
  const cards = node.querySelectorAll('.buddy-card');
  assert.equal(cards.length, 3, '只列 top 3');
  assert.ok(cards[0].textContent.includes(zh('home.chatNow')), '每张卡一个入口按钮');
  assert.equal(cards[0].textContent.includes(zh('match.complementBadge')), false, '不互补的人没有徽标');
  assert.equal(cards[1].textContent.includes(zh('match.complementBadge')), true, '互补的那位带「语言互补」');
  assert.ok(cards[1].textContent.includes('TA 也想练英语'), '并说清是哪门语言：' + cards[1].textContent);
  assert.ok(findButton(node, zh('home.recommendAll')), '要有「看全部」的出口');

  let createCalls = 0;
  const createRoom = ready.api.createRoomWithBuddy;
  ready.api.createRoomWithBuddy = (...args) => { createCalls++; return createRoom(...args); };
  cards[1].click(); cards[1].click();
  assert.equal(createCalls, 1, '进入房间中不能重复请求');
  assert.equal(route.page.render(ready, ready.view).querySelector('.buddy-card').disabled, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(navigate.length, 1);
  assert.ok(navigate[0].startsWith('/room/r-ka-ho'), '直接成房并进房：' + navigate[0]);
  assert.equal(ready.store.getState().runtime.room.role, 'learner', '发起人是学习者');

  // 母语者视角保持现状：只显示等待人数，不推候选人
  const buddy = fakeCtx({ role: 'buddy', data: { progress: {}, history: [], waitingCount: 2 } });
  const buddyNode = route.page.render(buddy, buddy.view);
  assert.equal(buddyNode.querySelector('.recommend-block'), null, '母语者视角不推候选人');
  assert.ok(buddyNode.textContent.includes(zh('home.buddyWaiting', { count: 2 })));
});

test('个人页：母语者能改「我也想练」，学习者看不到这一块', async () => {
  const route = ROUTES.find((item) => item.page.name === 'ProfilePage');
  const zh = createTranslator('zh-Hans');
  const data = { progress: { conversations: 2, totalMinutes: 46, streakDays: 3 }, history: [], me: {}, buddies: [], requests: [] };

  const buddy = fakeCtx({ role: 'buddy', data });
  let node = route.page.render(buddy, buddy.view);
  const card = node.querySelector('.want-to-learn-card');
  assert.ok(card, '母语者资料区要有「我也想练」这一项');
  assert.ok(node.textContent.includes(zh('me.wantToLearn')));
  assert.ok(card.textContent.includes(zh('setup.wantToLearnHint')), '同一句「不填也行、填了排前面」的说明');
  const learnerBefore = JSON.parse(JSON.stringify(buddy.store.getState().learnerProfile));
  const wantCalls = [];
  spyApi(buddy, 'saveBuddyProfile', wantCalls);
  findButton(card, labelOf('nativeLanguages', 'english', 'zh-Hans')).click();
  await flush();
  assert.deepEqual(buddy.store.getState().buddyProfile.wantToLearn, ['english'], '改了立刻写进母语者资料');
  assert.deepEqual(buddy.store.getState().learnerProfile, learnerBefore, '不碰学习者资料');
  assert.deepEqual(
    wantCalls,
    [[{ wantToLearn: ['english'] }]],
    '回礼必须真的送服务端：只改本地的话语言互补排序不生效',
  );

  const learner = fakeCtx({ role: 'learner', data });
  node = route.page.render(learner, learner.view);
  assert.equal(node.querySelector('.want-to-learn-card'), null, '学习者的「想练」恒为粤语，不给这一项');
});

test('匹配页：母语者视角的等待列表带「语言互补」徽标与「TA 的母语是 X」', () => {
  const route = ROUTES.find((item) => item.page.name === 'MatchPage');
  const zh = createTranslator('zh-Hans');
  const local = { tab: 'browse', criteriaOpen: false, criteriaDraft: null, timeoutShown: false };
  const candidates = [
    { peerId: 'mingzhu', displayName: 'mingzhu', anonymous: false, nativeLanguage: 'mandarin', cantoneseLevel: 'elementary', interests: ['food'], matchedTags: ['food'], matchScore: 54, intent: 'learn', complement: true, complementLanguage: 'mandarin' },
    { peerId: 'lucas', displayName: 'lucas', anonymous: false, nativeLanguage: 'english', cantoneseLevel: 'intermediate', interests: ['movies'], matchedTags: [], matchScore: 68, intent: 'learn', complement: false, complementLanguage: null },
  ];
  const ctx = fakeCtx({ role: 'buddy', data: { candidates }, local });
  const node = route.page.render(ctx, ctx.view);
  const cards = node.querySelectorAll('.buddy-card');
  assert.equal(cards.length, 2);
  assert.ok(cards[0].textContent.includes(zh('match.complementBadge')), '互补的那位带徽标');
  assert.ok(cards[0].textContent.includes('TA 的母语是普通话'), '并说清是哪门母语：' + cards[0].textContent);
  assert.equal(cards[1].textContent.includes(zh('match.complementBadge')), false, '不互补的那位没有徽标——人人都有等于没有');
});

test('预览页：大卡上同样有「语言互补」一行', () => {
  const route = ROUTES.find((item) => item.page.name === 'PeerPreviewPage');
  const zh = createTranslator('zh-Hans');
  const card = { id: 'food-beginner-01', topic: 'food', difficulty: 'beginner', cantonese: '你食咗飯未？', mandarin: '你吃饭了吗？', english: 'Have you eaten?', expressions: [] };
  const data = {
    candidate: { peerId: 'mingzhu', displayName: 'mingzhu', anonymous: false, nativeLanguage: 'mandarin', cantoneseLevel: 'elementary', identity: 'university_student', interests: ['food'], matchedTags: ['food'], matchScore: 62, roomAvailable: true, complement: true, complementLanguage: 'mandarin' },
    cards: [card],
  };
  const ctx = fakeCtx({ role: 'buddy', data, local: { previewIndex: null, claiming: false, taken: false } });
  const node = route.page.render(ctx, ctx.view);
  assert.ok(node.textContent.includes(zh('match.complementBadge')));
  assert.ok(node.textContent.includes('TA 的母语是普通话'));

  // 不互补时整行都不出现
  const plain = fakeCtx({ role: 'buddy', data: { ...data, candidate: { ...data.candidate, complement: false, complementLanguage: null } }, local: { previewIndex: null, claiming: false, taken: false } });
  const plainNode = route.page.render(plain, plain.view);
  assert.equal(plainNode.textContent.includes(zh('match.complementBadge')), false);
});

test('首页 load：学习者取推荐候选，取不到也只是这一块失败', async () => {
  const route = ROUTES.find((item) => item.page.name === 'HomePage');
  const view = { data: null, error: null, loading: false, local: {}, role: null };
  const watch = () => () => {};

  const learner = fakeCtx({ role: 'learner', data: null });
  const learnerData = await route.page.load({ ...learner, view: { ...view }, watch });
  assert.ok(Array.isArray(learnerData.recommended));
  assert.ok(learnerData.recommended.length >= 3, '学习者首页直接拿到候选');
  assert.equal(learnerData.recommendFailed, false);
  assert.ok(learnerData.progress, '统计照常');

  const buddy = fakeCtx({ role: 'buddy', data: null });
  const buddyData = await route.page.load({ ...buddy, view: { ...view }, watch });
  assert.deepEqual(buddyData.recommended, [], '母语者视角不推候选人');
  assert.ok(buddyData.waitingCount >= 1, '只显示等待人数');

  // 推荐接口挂了：别的数据照常返回，只有这一块标记失败
  const broken = fakeCtx({ role: 'learner', data: null });
  broken.api = { ...broken.api, listRecommendedBuddies: async () => { throw new Error('503'); } };
  const brokenData = await route.page.load({ ...broken, view: { ...view }, watch });
  assert.equal(brokenData.recommendFailed, true);
  assert.deepEqual(brokenData.recommended, []);
  assert.ok(brokenData.progress, '推荐取不到不能把整页拖进失败态');
});

test('资料可见范围页：匿名与可见范围分别保存，用户名仍支持校验', async () => {
  const route = ROUTES.find((item) => item.page.name === 'PrivacySetupPage');
  const ctx = fakeCtx({ role: 'learner', data: null });
  const calls = [];
  spyApi(ctx, 'saveSettings', calls);
  const node = route.page.render(ctx, ctx.view);

  const switches = node.querySelectorAll('.switch');
  assert.equal(switches.length, 5, '匿名与四个资料可见范围开关');
  assert.ok(node.textContent.includes(ctx.t('privacy.visibilityHint')), '应提示标签可见范围不会隐藏头像名称');
  assert.equal(ctx.store.getState().settings.anonymous, false, '新用户进入 onboarding 时默认不匿名');

  switches[1].click(); // 第一个可见范围项
  await flush();
  assert.deepEqual(calls, [[{ visibility: { nativeLanguage: false } }]], '可见范围要送服务端');
  assert.equal(ctx.store.getState().settings.anonymous, false, '改可见范围不应顺带开启匿名');
  const names = [];
  spyApi(ctx, 'saveLearnerProfile', names);
  const input = node.querySelector('input');
  input.value = 'a';
  input.dispatch('input', { target: input });
  findButton(node, ctx.t('privacy.finishSetup')).click();
  await flush();
  assert.equal(names.length, 0, '过短用户名不能保存');
  assert.ok(node.textContent.includes(ctx.t('privacy.usernameError')));
  input.value = ' 港语同学 ';
  input.dispatch('input', { target: input });
  findButton(node, ctx.t('privacy.finishSetup')).click();
  await flush();
  assert.deepEqual(names, [[{ displayName: '港语同学' }]]);
  assert.equal(ctx.store.getState().learnerProfile.displayName, '港语同学');
  assert.equal(ctx.store.getState().buddyProfile.displayName, '港语同学');
  assert.equal(ctx.store.getState().buddyProfile.onboarded, false, '同步名字不应完成另一身份的注册');
  const personalPage = ROUTES.find((item) => item.page.name === 'ProfilePage').page;
  const personal = personalPage.render(ctx, { data: { progress: {}, buddies: [], requests: [] } });
  assert.equal(personal.querySelector('.profile-head strong').textContent, '港语同学', '注册保存后个人主页显示用户名');
  assert.equal(personal.querySelector('.profile-head .avatar').getAttribute('data-avatar'), 'neutral');
  ctx.store.setRole('buddy');
  const buddyPersonal = personalPage.render(ctx, { data: { progress: {}, buddies: [], requests: [] } });
  assert.equal(buddyPersonal.querySelector('.profile-head strong').textContent, '港语同学', '切换身份保留用户名');
  const fresh = fakeCtx({ role: 'learner' });
  fresh.store.hydrate({ learnerProfile: (await ctx.api.getMe()).learnerProfile });
  const reloaded = personalPage.render(fresh, { data: { progress: {}, buddies: [], requests: [] } });
  assert.equal(reloaded.querySelector('.profile-head strong').textContent, '港语同学', '重新读取资料后仍显示保存的用户名');
  fresh.store.hydrate({ learnerProfile: { displayName: '', userId: 'learner-legacy' } });
  const legacy = personalPage.render(fresh, { data: { progress: {}, buddies: [], requests: [] } });
  assert.equal(legacy.querySelector('.profile-head strong').textContent, 'learner-legacy', '未设置用户名的旧账号仍能显示');
});

test('个人资料标题将姓名和简短身份分行呈现，中英两身份都不重复混排', () => {
  const page = ROUTES.find(item => item.page.name === 'ProfilePage').page;
  for (const role of ['learner', 'buddy']) {
    for (const locale of ['zh-Hans', 'en']) {
      const ctx = fakeCtx({ role, data: { progress: {}, buddies: [], requests: [] } });
      ctx.t = createTranslator(locale);
      const name = '这是一位拥有较长名字的测试同学';
      ctx.store.saveRoleProfile(role, { displayName: name, avatarId: 'female' });
      const node = page.render(ctx, ctx.view);
      const header = node.querySelector('.profile-head');
      assert.equal(header.querySelector('.profile-identity strong').textContent, name);
      const label = ctx.t(role === 'buddy' ? 'me.buddyRole' : 'me.learnerRole');
      assert.equal(header.querySelector('.profile-subtitle').textContent, label);
      assert.equal(header.querySelector('.profile-role').textContent, ctx.t('me.currentRole') + ' · ' + label);
      assert.ok(!header.textContent.includes('Become a'));
      if (locale === 'zh-Hans') assert.ok(!header.textContent.includes('Cantonese Buddy'));
    }
  }
});

test('资料预览：兴趣或所有标签关闭后头像姓名仍显示，隐藏粤语水平不泄露初学者', () => {
  const page = ROUTES.find(item => item.page.name === 'PrivacySetupPage').page;
  for (const role of ['learner', 'buddy']) {
    const ctx = fakeCtx({ role });
    ctx.store.saveRoleProfile(role, { displayName: '测试同学', avatarId: 'female', cantoneseLevel: 'beginner', interests: ['food'], nativeLanguage: 'english', identity: 'university_student' });
    ctx.store.saveSettings({ visibility: { interests: false } });
    const hiddenInterests = page.render(ctx);
    assert.ok(hiddenInterests.querySelector('.buddy-card'));
    assert.equal(hiddenInterests.querySelector('.buddy-card .avatar').getAttribute('data-avatar'), 'female');
    assert.ok(!hiddenInterests.querySelector('.buddy-card').textContent.includes(ctx.label('interests', 'food')));
    ctx.store.saveSettings({ visibility: { interests: false, level: false, nativeLanguage: false, identity: false } });
    const empty = page.render(ctx);
    assert.equal(empty.querySelector('.buddy-card-title strong').textContent, '测试同学');
    assert.ok(empty.querySelector('.buddy-card .avatar'));
    assert.equal(empty.querySelector('.buddy-card .pill-row'), null);
    assert.ok(!empty.querySelector('.buddy-card').textContent.includes(ctx.label('levels', 'beginner')));
  }
});

test('资料可见范围页匿名开关同步服务端，预览仅显示匿名用户，关闭后恢复未提交用户名', async () => {
  const page = ROUTES.find(item => item.page.name === 'PrivacySetupPage').page;
  const ctx = fakeCtx(); const calls = []; spyApi(ctx, 'saveSettings', calls);
  ctx.store.saveRoleProfile('learner', { displayName: '原用户名', avatarId: 'female' });
  ctx.store.saveSettings({ visibility: { interests: false, identity: false, level: false, nativeLanguage: false } });
  let node = page.render(ctx);
  const input = node.querySelector('input'); input.value = '新的用户名'; input.dispatch('input', { target: input });
  node.querySelectorAll('.switch')[0].click(); await flush();
  node = page.render(ctx);
  assert.equal(node.querySelector('.buddy-card-title strong').textContent, '匿名用户');
  assert.ok(!node.querySelector('.buddy-card').textContent.includes(ctx.store.getState().learnerProfile.userId));
  assert.ok(!node.querySelector('.buddy-card').textContent.includes('新的用户名'));
  assert.ok(node.querySelector('.buddy-card .avatar'));
  assert.deepEqual(calls, [[{ anonymous: true }]]);
  node.querySelectorAll('.switch')[0].click(); await flush();
  assert.equal(page.render(ctx).querySelector('.buddy-card-title strong').textContent, '新的用户名');
  assert.equal(ctx.store.getState().learnerProfile.displayName, '原用户名', '匿名切换不修改个人资料');
  assert.equal(ctx.store.getState().settings.anonymous, false);
});

test('我的页设置：匿名默认关闭，且开关会送服务端', async () => {
  const route = ROUTES.find((item) => item.page.name === 'ProfilePage');
  const data = { progress: { conversations: 2, totalMinutes: 46, streakDays: 3 }, history: [], me: {}, buddies: [], requests: [] };
  const ctx = fakeCtx({ role: 'learner', data });
  const calls = [];
  spyApi(ctx, 'saveSettings', calls);
  const node = route.page.render(ctx, ctx.view);

  const toggle = node.querySelectorAll('.switch')[0];
  assert.ok(node.textContent.includes(ctx.t('me.settings')), '匿名开关应位于“设置”区');
  assert.ok(toggle, '我的页设置区要有匿名开关');
  assert.equal(ctx.store.getState().settings.anonymous, false, '初始默认不匿名');
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  toggle.click();
  await flush();
  assert.deepEqual(calls, [[{ anonymous: true }]], '主动开启匿名要送服务端');
  assert.equal(ctx.store.getState().settings.anonymous, true, '本地镜像照旧立刻生效');
  const english = node.querySelectorAll('.language-card button')[2];
  english.click();
  await flush();
  assert.equal(ctx.store.getState().locale, 'en');
  assert.deepEqual(calls[1], [{ locale: 'en' }], '语言选择同步到设置接口');
});

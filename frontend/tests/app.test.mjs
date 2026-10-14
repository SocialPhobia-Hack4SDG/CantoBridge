/**
 * 端到端集成测试：用 DOM / Window stub 把 app.js 真的跑起来，走完 5 分钟 demo 的
 * happy path，并覆盖路由守卫、兜底与界面语言切换。
 *
 * 为什么要有这一层：单测只覆盖模块，而 app.js 的装配（start / 路由 / 守卫 / 页面
 * 三态 / 事件回调 / 首次渲染时序）只有在「真的点一遍」时才会暴露问题。写入本文件
 * 时它一次就抓出两个会让现场 demo 白屏的 bug：
 *   1. start() 里用 `start.lastKey` 存状态——对象字面量的方法简写不会把方法名绑定
 *      成局部变量，于是浏览器一进来就 ReferenceError；
 *   2. MatchPage.render 在 load() 之前就被调用（app.js 先 paint 再取数），直接读
 *      view.local.tab —— 匹配大厅一进去就抛错。
 * 当时的 178 个单测全绿，因为没有哪个测试调用过 app.start()、也没有哪个测试在
 * load() 解析之前渲染过页面。
 *
 * 脚手架（DOM/Window stub、可拨时钟、boot、findButton…）已抽到
 * `tests/helpers/app-harness.mjs`，真后端的端到端脚本（`tools/e2e-real.mjs`）
 * 用的是同一份。
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { createTranslator } from '../src/i18n/i18n.js';
import { labelOf } from '../src/data/labels.js';
import { boot, findButton, flush, restoreGlobalTimers } from './helpers/app-harness.mjs';
import { DEMO_SOCIAL } from './helpers/demoPool.mjs';

// 定时器被脚手架改道到 window stub 上了，跑完要还回去（否则进程会被漏掉的 interval 拖住）
after(() => restoreGlobalTimers());

test('页面切换沿用同一导航滑块，隐藏后恢复及语言切换不会重复创建', async () => {
  const ui = await boot({ hash: '#/home' }); await flush();
  const nav = ui.one('.bottom-nav'); const indicator = nav.querySelector('.bottom-nav-indicator');
  await ui.clickNav(createTranslator('zh-Hans')('nav.match'));
  assert.equal(ui.one('.bottom-nav'), nav);
  assert.equal(nav.style.props['--nav-index'], '1');
  await ui.goto('/shop'); assert.equal(ui.one('.bottom-nav'), null);
  await ui.goto('/leaderboard'); assert.equal(ui.one('.bottom-nav'), nav);
  assert.equal(nav.style.props['--nav-index'], '2');
  ui.store.setLocale('en'); await flush();
  assert.equal(ui.one('.bottom-nav'), nav);
  assert.equal(nav.querySelector('.bottom-nav-indicator'), indicator);
  assert.ok(nav.textContent.includes(createTranslator('en')('nav.leaderboard')));
  await ui.goto('/me'); assert.equal(nav.style.props['--nav-index'], '3');
});

const zh = createTranslator('zh-Hans');
const en = createTranslator('en');
/** 枚举文案（标签词表）走 labels.js；t() 管不到它，两边合起来才是用户看到的字。 */
const label = (group, value) => labelOf(group, value, 'zh-Hans');

/**
 * 排队 8 秒才出现「演示伙伴」入口、匹配弹窗 10 秒倒计时——真等一遍太慢。
 * 测试用 ui.advance(ms) 把时间拨快：store、app 层的后台匹配、mock 层造的时间戳
 * 用的是**同一个时钟**（store.now），所以拨快之后三边看到的「现在」始终一致。
 */
const MATCH_WAIT_MS = 15_000;

test('匹配等待跨页可见、长等待诚实提示、取消失败保留队列并可重试', async () => {
  let cancelFails = true;
  const ui = await boot({ candidates: [], storagePreset: { settings: { backgroundMatch: false } }, apiWrapper: api => ({ ...api, leaveQueue: async () => {
    if (cancelFails) throw new Error('offline');
    return api.leaveQueue();
  } }) });
  ui.win.__CANTOBRIDGE_DEV__ = false;
  await ui.goto('/match'); await ui.clickButton(zh('match.start'));
  assert.ok(ui.text().includes(zh('match.backgroundHint')));
  await ui.goto('/me');
  assert.ok(ui.has('.queue-status-button'));
  await ui.click('.queue-status-button');
  assert.equal(ui.win.location.hash, '#/match');
  ui.advance(65_000); ui.win.tick(1); await flush();
  assert.ok(ui.text().includes(zh('match.waitLong')));
  assert.equal(ui.button(zh('match.demoBuddy')), null, '真实档位不提供假伙伴');
  await ui.clickButton(zh('match.cancel'));
  assert.ok(ui.store.getState().runtime.queue);
  assert.ok(ui.text().includes(zh('match.cancelFailed')));
  cancelFails = false; await ui.clickButton(zh('match.cancel'));
  assert.equal(ui.store.getState().runtime.queue, null);
  assert.equal(ui.has('.queue-status-button'), false);
});


test('回归：app.start() 不抛错，并把落地页挂到 #app', async () => {
  // 曾经的 bug 是 start() 内部引用未定义的 start.lastKey -> 浏览器白屏。
  const ui = await boot();
  assert.ok(ui.has('.landing'), '落地页没有渲染');
  assert.equal(ui.has('.top-bar'), false, '落地页不需要重复显示「首页」顶栏');
  assert.ok(ui.text().includes(zh('app.slogan')), '落地页缺少 slogan');
  assert.equal(ui.win.location.hash, '#/');
});

test('回归：首次渲染（load 还没回来）不会让匹配大厅白屏', async () => {
  const ui = await boot({ role: 'learner' });
  // 直接进入 /match：第一帧必须能渲染出东西，而不是抛 TypeError
  await ui.goto('/match');
  assert.ok(ui.has('.match-start'), '匹配大厅没有渲染出开始卡片');
});

test('happy path（学习者）：落地 -> 注册 -> 匹配 -> 房间 -> 结算 -> 我的', async () => {
  // 出厂三张社交表都是空的（一份真实的新设备谁都不认识）。这条用例要演「我的伙伴」
  // 插槽的三种状态（已连接 / 我发出的 / 收到的），所以显式预置一份演示社交状态——
  // 这类演示数据现在只活在 tests/ 里，产品代码里一个假人都没有。
  //
  // 两份资料都设成「没填过」：这条用例演的是**一台全新设备**，所以注册页上应当是
  // 「这台设备还没有注册过」而不是「继续使用」。
  const ui = await boot({
    learnerOnboarded: false,
    buddyOnboarded: false,
    storagePreset: { social: DEMO_SOCIAL },
  });
  const { store, win } = ui;

  // ① 落地页 -> 注册 -> 身份选择
  // 落地页不建号：点「开始使用」先到注册页，账号是点了「注册」才长出来的
  await ui.clickButton(zh('landing.getStarted'));
  assert.equal(win.location.hash, '#/register', '落地页应当先去注册页');
  assert.ok(ui.text().includes(zh('register.fresh')), '新设备应当显示「还没有注册过」');
  await ui.clickButton(zh('register.submit'));
  assert.equal(win.location.hash, '#/onboarding/role');
  assert.ok(ui.has('.role-learner') && ui.has('.role-buddy'), '身份选择卡没有渲染');
  assert.ok(ui.has('.step-progress'), 'onboarding 步骤条没有渲染');

  // 未选身份时「下一步」应当是禁用态
  assert.equal(findButton(ui.root, zh('action.next')).disabled, true, '未选身份时不应能进入下一步');

  // ② 选学习者 -> 资料页
  await ui.clickButton(zh('role.learnerTitle'));
  assert.notEqual(findButton(ui.root, zh('action.next')).disabled, true, '选了身份之后「下一步」应当可用');
  await ui.clickButton(zh('action.next'));
  assert.equal(win.location.hash, '#/onboarding/profile');
  assert.ok(ui.has('.tag-picker'), '资料页的标签选择器没有渲染（异步标签没回来？）');

  // ③ 资料页「暂时跳过」-> 隐私页（不填也能继续）
  await ui.clickButton(zh('setup.skipForNow'));
  await ui.clickButton(zh('setup.nextStep'));
  assert.equal(win.location.hash, '#/onboarding/privacy');
  assert.ok(ui.has('.privacy-list'), '隐私开关列表没有渲染');
  assert.equal(store.getState().learnerProfile.onboarded, true);

  // ④「完成设置」只收尾注册：回首页，不自动去匹配页、更不会自动入队
  await ui.clickButton(zh('privacy.finishSetup'));
  assert.equal(win.location.hash, '#/home', '完成设置之后应当回首页');
  assert.equal(store.getState().runtime.queue, null, '收尾注册不该把人排上队');
  assert.ok(ui.has('.home-action'), '首页主 CTA 在');
  assert.equal(ui.has('.match-start'), false, '没有被自动送去匹配页');

  // ④b 用户自己去匹配页：只有一张开始卡片，点「开始匹配」才直接入队
  await ui.goto('/match');
  assert.equal(store.getState().runtime.queue, null, '进匹配页还不该自动入队');
  assert.ok(ui.has('.match-start'), '应当先看到开始卡片');
  assert.equal(ui.has('.criteria-editor'), false, '匹配前不再让用户选兴趣主题');
  assert.equal(ui.has('.tag-picker'), false, '开始卡片上没有任何标签选择器');
  await ui.clickButton(zh('match.start'));
  assert.ok(store.getState().runtime.queue, '点「开始匹配」之后才进队列');
  assert.ok(ui.has('.waiting-panel'), '等待面板没有渲染');
  assert.ok(ui.has('.waiting-elapsed'), '等待计时没有渲染');
  assert.equal(ui.has('.match-start'), false, '入队之后开始卡片应当换成等待面板');
  assert.equal(ui.text().includes(zh('match.timeout')), false, '刚开始等的时候不该出现救场入口');

  // ⑤ 手感：匹配挂在后台——离开匹配页再回来，既不重新排队、也不重置等待计时
  const queuedAt = store.getState().runtime.queue.joinedAt;
  await ui.goto('/home');
  assert.ok(store.getState().runtime.queue, '离开匹配页之后排队状态应当还在');
  await ui.goto('/match');
  assert.equal(store.getState().runtime.queue.joinedAt, queuedAt, '进出匹配页不应重新入队');
  assert.ok(ui.has('.waiting-panel'), '回到匹配页应当直接是等待面板，不需要重新排队');

  // ⑤b 后台匹配：人在首页也能收到匹配成功——右上角细条弹窗带倒计时（默认 10 秒）
  await ui.goto('/home');
  ui.advance(MATCH_WAIT_MS);
  win.tick(1);
  await flush();
  assert.ok(store.getState().runtime.matchRequest, '后台匹配应当产出一条待接受请求');
  assert.ok(ui.has('.match-toast'), '人已经离开匹配页，弹窗仍然应该出现');
  assert.ok(ui.text().includes(zh('match.acceptTitle')), '弹窗缺少标题');
  assert.equal(ui.one('.match-toast-bar').style.props['--toast-seconds'], '10s', '倒计时上限默认 10 秒');
  assert.equal(ui.one('.match-toast-count').textContent, '10');
  assert.equal(store.getState().runtime.room, null, '还没点接受就不该成房');
  assert.ok(findButton(ui.root, zh('match.decline')), '弹窗缺少「不接受」按钮');

  // ⑤c 不接受 → 回到等待队列：不跳页面、不进房间、等待计时也不清零
  await ui.clickButton(zh('match.decline'));
  assert.equal(ui.has('.match-toast'), false, '不接受之后弹窗应当收起');
  assert.equal(win.location.hash, '#/home', '不接受不应该跳页面');
  assert.equal(store.getState().runtime.matchRequest, null);
  assert.ok(store.getState().runtime.queue, '不接受之后仍然在排队');
  assert.equal(store.getState().runtime.queue.joinedAt, queuedAt, '等待计时不该被拒绝清零');

  // ⑤d 回到匹配页：等够了所以出现「使用演示伙伴」；一键再匹配一次并接受 → 进房间
  await ui.goto('/match');
  assert.ok(ui.text().includes(zh('match.timeout')), '等太久之后应当出现演示伙伴入口');
  await ui.clickButton(zh('match.demoBuddy'));
  assert.ok(ui.has('.match-toast'), '第二次匹配应该还能弹出弹窗');
  const acceptButton = findButton(ui.root, zh('match.accept'));
  assert.ok(acceptButton.classList.contains('btn-primary'), '「接受」应当是主按钮');
  acceptButton.click();
  await flush();
  assert.match(win.location.hash, /^#\/room\/r-demo-/, '接受之后应当进入房间');

  // ⑥ 房间：话题卡三语、波形、通话控制
  assert.ok(ui.has('.room-page'), '房间没有渲染');
  assert.ok(ui.has('.room-header'), '房间头部没有渲染');
  // 房主徽标是按房间模式**自动**带上的：学习者房主 = 学粤语，不用自己选
  const hostBadge = ui.one('.room-header .pill.tone-accent');
  assert.ok(hostBadge, '房间头部应当有房主自动标签');
  assert.equal(hostBadge.textContent, zh('room.host') + ' · ' + label('matchIntents', 'learn'), '学习者房主应当自动带「学粤语」');
  assert.ok(ui.has('.waveform'), '波形没有渲染');
  assert.equal(ui.one('.call-status')?.textContent, ui.store.getState().runtime.room.peer.peerId, '头像旁应显示对方用户 ID');
  const firstCardId = ui.one('.topic-card').dataset.cardId;
  assert.ok(firstCardId, '话题卡缺少 cardId');
  assert.ok(
    ui.has('.topic-line.is-yue') && ui.has('.topic-line.is-mandarin') && ui.has('.topic-line.is-english'),
    '话题卡不是粤语 / 普通话 / 英文三语对照',
  );

  // 滑到下一张
  await ui.clickButton('›');
  assert.notEqual(ui.one('.topic-card').dataset.cardId, firstCardId, '滑卡后话题卡没有切换');
  assert.ok(ui.text().includes('2 / '), '牌堆位置文案没有更新');

  // 收藏一句句型
  const phrasesBefore = store.getState().social.savedPhrases.length;
  assert.ok(ui.all('.phrase-star').length > 0, '句型收藏按钮没有渲染');
  await ui.click('.phrase-star');
  assert.equal(store.getState().social.savedPhrases.length, phrasesBefore + 1, '收藏句型没有写入 store');

  // 通话控制：浏览器里拿不到麦克风权限时（模拟通话 / 旁听模式）静音按钮是禁用态，
  // 真正能操作的是扬声器开关，这里验证它的状态会翻转。
  assert.equal(ui.all('.control-btn')[0].disabled, true, '没有麦克风时静音按钮应当是禁用态');
  assert.equal(ui.all('.control-btn').length, 3, '通话控制应当有 静音 / 扬声器 / 结束 三个按钮');
  assert.equal(ui.all('.control-btn')[1].getAttribute('aria-pressed'), 'true');
  ui.all('.control-btn')[1].click();
  await flush();
  assert.equal(ui.all('.control-btn')[1].getAttribute('aria-pressed'), 'false', '扬声器开关状态没有翻转');

  // ⑦ 挂断 -> 结算
  const xpBefore = store.getState().progress.xp;
  const conversationsBefore = store.getState().progress.conversations;
  await ui.clickButton(zh('room.hangup'));
  assert.match(win.location.hash, /\/summary$/, '挂断后应当进入结算页');
  assert.ok(ui.has('.reward-card'), '结算卡没有渲染');
  assert.ok(store.getState().progress.xp > xpBefore, '结算没有加积分');
  assert.equal(store.getState().progress.conversations, conversationsBefore + 1, '结算没有累加对话数');
  assert.equal(store.getState().social.history.length, 1, '结算没有写入连线记录');
  assert.ok(ui.has('.feedback-sheet'), '评价区没有渲染');

  // ⑦b 伙伴申请：点「发出伙伴申请」只是发出申请，不能单方面把人存成伙伴
  await ui.clickButton(zh('summary.sendRequest'));
  const requested = store.getState().social.buddyRequests.find((item) => item.direction === 'outgoing');
  assert.ok(requested, '结算页发出申请后应当多出一条 outgoing 申请');
  assert.equal(
    store.getState().social.buddies.some((item) => item.peerId === requested.peerId),
    false,
    '发出申请不等于成为伙伴——要等对方接受',
  );
  assert.ok(ui.text().includes(zh('summary.requested')), '结算页应当显示「申请已发出」而不是直接成功');
  assert.equal(ui.has('.feedback-actions'), false, '发出申请后两个按钮应当收起');

  // ⑧ 去个人主页：新增的「我的伙伴」插槽要同时显示 发出的 / 收到的 / 已连接的
  await ui.clickButton(zh('summary.viewAchievements'));
  assert.equal(win.location.hash, '#/me');
  assert.ok(ui.has('.profile-head'), '个人主页没有渲染');
  assert.ok(ui.has('.badge-wall'), '成就墙没有渲染');
  assert.ok(ui.has('.tile-grid'), '统计小块没有渲染');
  assert.ok(ui.has('.buddy-slot-card'), '个人主页缺少「我的伙伴」插槽');
  assert.ok(ui.text().includes(zh('buddy.slot')), '插槽标题没有渲染');
  assert.ok(ui.text().includes(zh('buddy.pendingOut')), '我发出的申请应当显示为等待确认');
  assert.ok(ui.text().includes(zh('buddy.pendingIn')), '收到的申请应当显示为待你确认');
  assert.ok(ui.text().includes(zh('buddy.connected')), '已连接的伙伴分组没有渲染');

  // 接受收到的那条申请 → 立刻成为伙伴，申请从列表里消失
  await ui.clickButton(zh('buddy.accept'));
  assert.equal(store.getState().social.buddies.some((item) => item.peerId === 'wai-ling'), true, '接受之后应当成为伙伴');
  assert.equal(
    store.getState().social.buddyRequests.some((item) => item.peerId === 'wai-ling'),
    false,
    '接受之后申请应当从申请表移除',
  );
  assert.ok(ui.has('.buddy-slot-card'), '接受之后插槽应当仍然渲染');

  // ⑨ 底部导航：切到排行榜，周榜 / 月榜可切换
  await ui.clickNav(zh('nav.leaderboard'));
  assert.equal(win.location.hash, '#/leaderboard');
  assert.ok(ui.has('.leaderboard-empty-rule'), '短时交流不应上榜，显示规则');
  await ui.clickButton(zh('leaderboard.monthly'));
  assert.ok(ui.has('.leaderboard-empty-rule'), '月榜同样显示空榜规则');

  // ⑩ 底部导航切回「我的」，再从「我的」进连线记录：刚才那场应当在列表里
  await ui.clickNav(zh('nav.me'));
  assert.equal(win.location.hash, '#/me');
  await ui.clickButton(zh('history.title'));
  assert.equal(win.location.hash, '#/history');
  assert.ok(ui.has('.history-row'), '连线记录没有渲染刚才那场对话');
  // 每行的伙伴状态由 buddies + buddyRequests 推导，历史记录不再自带 saved 布尔值
  assert.ok(ui.text().includes(zh('buddy.pendingOut')), '连线记录里应当把申请中的那一行标成「等待对方确认」');
  await ui.clickButton(zh('buddy.cancel'));
  assert.equal(store.getState().social.buddyRequests.length, 0, '撤回之后申请表应当清空');
  assert.ok(ui.text().includes(zh('buddy.request')), '撤回之后应当回到「申请成为伙伴」');

  // ⑪ 连线记录页左上角同样是带文字的显眼返回，点一下一步回「我的」（深链进来也退得回去）
  assert.ok(ui.has('.exit-btn'), '连线记录页要有带文字的页头按钮');
  assert.equal(ui.has('.icon-btn'), false, '连线记录页不再用返回箭头');
  assert.ok(ui.one('.exit-btn').textContent.includes(zh('action.back')));
  await ui.click('.exit-btn');
  assert.equal(win.location.hash, '#/me', '连线记录页返回一步回「我的」');

  // 收尾：离开房间后不应残留 interval（现场 demo 不能越跑越卡）
  assert.equal(win.pendingIntervals(), 0, '还有定时器没有清理');
});

test('注册前不建号：落地页与注册页都不登录，点了「注册」才建出账号', async () => {
  // 这条钉的是「显式注册」的**装配**部分：账号是用户按下去那一刻才长出来的。
  // 少了 app.js 里的 PRE_AUTH_ROUTES，落地页上任何一次 store 变动都会顺手把账号建好，
  // 注册页就退回成走过场——用户以为自己在注册，其实账号早就存在了。
  const calls = [];
  const ui = await boot({
    learnerOnboarded: false,
    buddyOnboarded: false,
    apiWrapper: (base) => ({
      ...base,
      signIn: async (role) => {
        calls.push(role);
        return base.signIn(role);
      },
    }),
  });
  await flush();
  assert.deepEqual(calls, [], '落在落地页时不该登录（也就没有账号）');

  await ui.clickButton(zh('landing.getStarted'));
  assert.equal(ui.win.location.hash, '#/register');
  await flush();
  assert.deepEqual(calls, [], '注册页自己也不该登录——要等用户按下去');

  await ui.clickButton(zh('register.submit'));
  assert.deepEqual(calls, ['learner'], '点「注册」才登录一次（＝建号）');
  assert.equal(ui.win.location.hash, '#/onboarding/role', '注册之后才进身份选择');
});

test('已注册的设备：注册页给「继续使用」，不再重复走注册', async () => {
  const ui = await boot({ learnerOnboarded: true, buddyOnboarded: false });
  await ui.clickButton(zh('landing.getStarted'));
  assert.equal(ui.win.location.hash, '#/register');
  assert.ok(ui.text().includes(zh('register.registered')), '本机注册过就要说出来');
  assert.equal(ui.button(zh('register.submit')), null, '不该再给「注册并开始」');
  assert.ok(ui.button(zh('register.switchAccount')), '要有换人的出口');
  assert.equal(ui.text().includes(ui.store.deviceId()), false, '不向普通用户暴露设备技术编号');

  const firstDevice = ui.store.deviceId();
  await ui.clickButton(zh('register.switchAccount'));
  assert.equal(ui.store.deviceId(), firstDevice, '第一下只展开确认，不该清掉账号');
  assert.ok(ui.text().includes(zh('account.signOutHint')), '确认态要说清换人的后果');
  assert.ok(ui.button(zh('account.confirmYes')), '确认态要有明确确认按钮');
  await ui.clickButton(zh('action.cancel'));
  assert.ok(ui.button(zh('register.switchAccount')), '取消后回到安全的初始状态');

  await ui.clickButton(zh('register.continue'));
  assert.equal(ui.win.location.hash, '#/home', '「继续使用」直接回首页');
});

test('退出并换人：「我的」页退出后换掉账号，并且能重新注册一个人', async () => {
  const calls = [];
  const ui = await boot({
    hash: '#/me',
    apiWrapper: (base) => ({
      ...base,
      signIn: async (role) => {
        calls.push(role);
        return base.signIn(role);
      },
    }),
  });
  await flush();
  const firstDevice = ui.store.deviceId();
  assert.deepEqual(calls, ['learner'], '已注册的设备进「我的」＝启动就登录');

  // 二次确认：第一下只是展开，不该真退出（退出会清掉本机账号，误触代价很大）
  await ui.click('.profile-account');
  await ui.clickButton(zh('account.signOut'));
  assert.equal(ui.store.deviceId(), firstDevice, '第一下只是展开确认，不该动账号');
  assert.ok(ui.text().includes(zh('account.signOutHint')), '确认态要说清后果');

  await ui.clickButton(zh('account.confirmYes'));
  await flush();
  assert.notEqual(ui.store.deviceId(), firstDevice, '退出并换人要换掉设备 id');
  assert.equal(ui.store.getState().learnerProfile.onboarded, false, '本机回到「没注册过」');
  assert.equal(ui.win.location.hash, '#/', '回落地页');

  // 关键回归：退出之后必须能**重新建号**。少了 session 的记账清理（lastRole = null），
  // 这里会静默不登录——人还在，但账号没建出来，后面每个请求都 401。
  await ui.clickButton(zh('landing.getStarted'));
  assert.ok(ui.text().includes(zh('register.fresh')), '换了钥匙之后应当是「还没有注册过」');
  await ui.clickButton(zh('register.submit'));
  assert.deepEqual(calls, ['learner', 'learner'], '退出之后要能重新注册一个人');
  assert.equal(ui.win.location.hash, '#/onboarding/role');
});

test('后台匹配：人离开匹配页也会匹配到，倒计时到点视为不接受', async () => {
  const ui = await boot({ role: 'learner' });
  const { store, win } = ui;

  await ui.goto('/match');
  await ui.clickButton(zh('match.start'));
  assert.ok(store.getState().runtime.queue, '确认主题之后应当开始排队');
  const joinedAt = store.getState().runtime.queue.joinedAt;

  // 走到首页：排队与匹配都不该因此中断
  await ui.goto('/home');
  assert.equal(store.getState().runtime.queue.joinedAt, joinedAt, '离开匹配页不该重置等待');
  ui.advance(MATCH_WAIT_MS);
  win.tick(1);
  await flush();
  assert.ok(store.getState().runtime.matchRequest, '离开匹配页之后仍然应该匹配到人');
  assert.ok(ui.has('.match-toast'), '在任何页面上都应该能看到接受弹窗');
  assert.ok(ui.text().includes(zh('match.acceptTitle')), '弹窗缺少标题');
  assert.equal(ui.one('.match-toast-bar').style.props['--toast-seconds'], '10s', '倒计时上限应当是 10 秒');

  // 倒计时：同一场匹配只画一次 DOM，之后只改秒数（否则进度条动画会被打断）
  const count = ui.one('.match-toast-count');
  assert.equal(count.textContent, '10');
  ui.advance(2_000);
  win.tick(1);
  await flush();
  assert.equal(ui.one('.match-toast-count'), count, '同一场匹配不该重建 DOM');
  assert.equal(count.textContent, '8', '倒计时按真实时间递减');

  // 到点 = 视为不接受：回到等待队列，既不进房也不跳页面
  ui.advance(9_000);
  win.tick(1);
  await flush();
  assert.equal(store.getState().runtime.matchRequest, null, '超时之后待接受请求应当清掉');
  assert.equal(ui.has('.match-toast'), false, '超时之后弹窗应当收起');
  assert.ok(store.getState().runtime.queue, '超时之后人还在队列里');
  assert.equal(win.location.hash, '#/home', '超时不应当把人拽进房间');

  // 冷却：超时之后不会下一拍马上又弹一个，等过一轮才重新匹配
  ui.advance(3_000);
  win.tick(1);
  await flush();
  assert.equal(store.getState().runtime.matchRequest, null, '冷却期内不该马上再弹一个');
  ui.advance(6_000);
  win.tick(1);
  await flush();
  assert.ok(store.getState().runtime.matchRequest, '过了冷却应当重新匹配到人');
});

test('后台匹配：可以关掉，倒计时上限也能现场调', async () => {
  const ui = await boot({ role: 'learner' });
  const { store, win } = ui;

  store.saveSettings({ backgroundMatch: false });
  await ui.goto('/match');
  await ui.clickButton(zh('match.start'));
  ui.advance(MATCH_WAIT_MS);
  win.tick(3);
  await flush();
  assert.equal(store.getState().runtime.matchRequest, null, '关掉后台匹配后不该自动匹配到人');
  assert.equal(ui.has('.match-toast'), false);

  // 手动救场入口仍然可用，而且倒计时上限跟着设置走
  store.saveSettings({ backgroundMatch: true, matchAcceptSeconds: 5 });
  await ui.clickButton(zh('match.demoBuddy'));
  assert.ok(ui.has('.match-toast'), '手动救场也应该弹出同一个弹窗');
  assert.equal(ui.one('.match-toast-bar').style.props['--toast-seconds'], '5s', '上限应当跟着设置变成 5 秒');
  assert.equal(ui.one('.match-toast-count').textContent, '5');
  assert.equal(ui.one('.match-toast').classList.contains('is-urgent'), false);

  // 只剩 3 秒：进入紧急态（进度条与数字变红）
  ui.advance(2_000);
  win.tick(1);
  await flush();
  assert.equal(ui.one('.match-toast-count').textContent, '3', '倒计时应当只剩 3 秒');
  assert.ok(ui.one('.match-toast').classList.contains('is-urgent'), '只剩 3 秒时进入紧急态');

  ui.advance(3_000);
  win.tick(1);
  await flush();
  assert.equal(store.getState().runtime.matchRequest, null, '到点应当按不接受处理');
  assert.ok(store.getState().runtime.queue, '超时之后人还在队列里');
});

test('取消匹配：退出队列、顺手收起待接受弹窗、回首页并留下横幅', async () => {
  const ui = await boot({ role: 'learner' });
  const { store, win } = ui;

  await ui.goto('/match');
  await ui.clickButton(zh('match.start'));
  assert.ok(store.getState().runtime.queue, '点「开始匹配」之后应当开始排队');
  assert.ok(ui.has('.waiting-cancel'), '等待面板上要有「取消匹配」出口');

  // 先让它匹配上，弹窗挂在右上角——取消要能连这个一起收掉
  ui.advance(MATCH_WAIT_MS);
  win.tick(1);
  await flush();
  assert.ok(ui.has('.match-toast'), '先要有一条待接受的匹配请求');

  await ui.clickButton(zh('match.cancel'));

  assert.equal(store.getState().runtime.queue, null, '取消匹配要退出队列');
  assert.equal(store.getState().runtime.matchRequest, null, '取消匹配要作废待接受请求');
  assert.equal(ui.has('.match-toast'), false, '取消之后右上角弹窗要立刻收起');
  assert.equal(win.location.hash, '#/home', '取消之后回首页');
  assert.ok(ui.text().includes(zh('match.cancelled')), '首页要留下一条「已取消」横幅');

  // 取消之后后台引擎不再找人：再拨多久时间都不该冒出新的匹配请求
  ui.advance(MATCH_WAIT_MS * 3);
  win.tick(3);
  await flush();
  assert.equal(store.getState().runtime.matchRequest, null, '退出队列之后不该再被匹配到');
  assert.equal(ui.has('.match-toast'), false);
  assert.equal(win.pendingIntervals(), 0, '没有队列就不该有匹配定时器空转');

  // 取消是可逆的：回到匹配页看到的是开始卡片，而不是被自动重新排上队（进房 / 取消 / 重置演示数据是仅有的三个清空口子）
  await ui.goto('/match');
  assert.equal(store.getState().runtime.queue, null, '取消之后回匹配页不该自动重新排队');
  assert.ok(ui.has('.match-start'), '取消之后应当回到开始卡片');
  await ui.clickButton(zh('match.start'));
  assert.ok(store.getState().runtime.queue, '在开始卡片上再点一次「开始匹配」就重新排队');
});

test('开始匹配卡片：匹配前不再选兴趣，点一下直接入队', async () => {
  const ui = await boot({ role: 'learner' });
  const { store } = ui;

  await ui.goto('/match');
  assert.equal(store.getState().runtime.queue, null, '进匹配页不该自动入队');
  assert.ok(ui.has('.match-start'), '应当先看到开始卡片');
  assert.equal(ui.has('.waiting-panel'), false, '还没排队就不该有等待面板');
  assert.ok(ui.text().includes(zh('match.readyTitle')), '开始卡片缺少标题');

  // 匹配前不再让用户选兴趣主题：卡片上没有任何标签选择器，也没有「随便聊」/「收起」
  assert.equal(ui.has('.criteria-editor'), false, '卡片上不该有兴趣选择器');
  assert.equal(ui.has('.tag-picker'), false, '卡片上不该有标签选择器');
  assert.equal(findButton(ui.root, zh('match.criteriaAny')), null, '「随便聊」已经退场');
  assert.equal(findButton(ui.root, zh('match.criteriaClose')), null, '没有可收起的东西');
  assert.notEqual(findButton(ui.root, zh('match.start')).disabled, true, '没有必填项，按钮永远可点');

  // 点一下就直接入队，不再写任何匹配条件
  await ui.clickButton(zh('match.start'));
  assert.ok(store.getState().runtime.queue, '点「开始匹配」之后才进队列');
  assert.equal(store.getState().settings.matchCriteria, null, '匹配前不写匹配条件（兴趣只在资料里维护）');
  assert.equal(ui.has('.match-start'), false, '入队之后开始卡片换成等待面板');
  assert.ok(ui.has('.waiting-panel'), '入队之后要看等待面板');

  // 等待面板也不再提供「放宽匹配条件」：没有可改的条件了
  assert.equal(ui.has('.criteria-editor'), false);
  assert.equal(findButton(ui.root, zh('match.relax')), null, '「放宽匹配条件」已经退场');

  // 排队挂在后台：在队列里的人离开再回来，接着等，不重新排队也不清零计时
  const queuedAt = store.getState().runtime.queue.joinedAt;
  await ui.goto('/home');
  await ui.goto('/match');
  assert.equal(store.getState().runtime.queue.joinedAt, queuedAt, '在队列里的人回到匹配页不该重新排队');
  assert.ok(ui.has('.waiting-panel'), '在队列里的人回到匹配页直接看等待面板');
  assert.equal(ui.has('.match-start'), false, '已经在队列里就不该再看到开始卡片');
});

test('教 / 学 标签：跟着「我的」里的身份自动来，不给自选', async () => {
  const ui = await boot({ role: 'learner' });
  const { store } = ui;
  const row = () => ui.one('.own-intent-row');

  await ui.goto('/match');
  assert.ok(row(), '匹配页顶部应当有教 / 学标签');
  assert.equal(row().textContent, label('matchIntents', 'learn'), '学习者 = 学粤语');
  assert.equal(row().querySelectorAll('button').length, 0, '标签是只读的，不是可点的选项');
  assert.equal(ui.has('.intent-pill'), false, '闸门上不该再有意图勾选器');
  assert.equal(store.getState().settings.matchIntents, undefined, '身份派生的标签不进设置：settings 里没有这个字段');

  // 换身份（走演示控制台这个真入口）→ 标签自己跟着换，用户什么都不用做
  await ui.goto('/dev/mock');
  await ui.clickButton(zh('role.buddySubtitle'));
  assert.equal(store.getState().role, 'buddy');
  await ui.goto('/match');
  assert.equal(row().textContent, label('matchIntents', 'teach'), '换成母语者 = 教粤语');

  // 等待列表里每个人的标签按**对方的**身份派生：这一列都是学习者
  const cards = ui.all('.buddy-card');
  assert.ok(cards.length > 0, '母语者视图应当有候选人');
  assert.ok(cards[0].textContent.includes(label('matchIntents', 'learn')), '候选人的标签也按身份派生');
});

test('回归：外壳的一次性提示与页面自己的横幅互不覆盖', async () => {
  const ui = await boot({ role: 'learner' });
  const { store } = ui;

  // 首页加载成功时 afterPaint 会调 clearBanner()——它只该管页面自己的横幅。
  // 曾经的 bug：两者共用一个槽，于是首页一加载就把外壳的提示抹掉了（取消匹配的
  // 落地提示、刷新后被踢回大厅的说明都是这么丢的）。
  await ui.goto('/home');
  assert.equal(ui.has('.fallback-banner'), false, '首页正常加载时本来不该有横幅');

  store.setNotice({ kind: 'banner', messageKey: 'match.cancelled', tone: 'info' });
  ui.app.render(true);
  await flush();

  assert.ok(ui.has('.notice-slot .fallback-banner'), '外壳提示应当挂在 notice 槽里');
  assert.ok(ui.text().includes(zh('match.cancelled')), '外壳提示不该被页面的 clearBanner 抹掉');
  assert.equal(ui.has('.banner-slot .fallback-banner'), false, '页面横幅槽应当是空的');

  // 用户点掉之后才消失，且不会因为再次渲染又冒出来
  ui.one('.notice-slot .link-btn').click();
  await flush();
  assert.equal(ui.has('.fallback-banner'), false, '点掉之后提示应当消失');
  ui.app.render(true);
  await flush();
  assert.equal(ui.has('.fallback-banner'), false, '一次性提示看过就不再重复出现');
});
test('母语者路径：匹配大厅浏览 -> 资料预览 -> 成房', async () => {
  const ui = await boot({ role: 'buddy' });
  const { win } = ui;

  await ui.goto('/match');
  assert.ok(ui.has('.list-block'), '候选人列表没有渲染');
  const cards = ui.all('.buddy-card');
  assert.ok(cards.length > 0, '没有渲染任何等待中的学习者');
  assert.ok(cards[0].textContent.includes('%'), '候选人缺少匹配度');

  await ui.click('.buddy-card');
  assert.match(win.location.hash, /^#\/match\//, '点击候选人应当进入资料预览');
  assert.ok(ui.has('.preview-card'), '资料预览卡没有渲染');
  assert.ok(ui.has('.preview-facts'), '资料预览缺少事实行');

  await ui.clickButton(zh('preview.start'));
  assert.match(win.location.hash, /^#\/room\//, '成房后应当进入房间');
  assert.ok(ui.has('.room-page'), '母语者房间没有渲染');
  // 同一个徽标，按房间模式自动换成「教粤语」
  const hostBadge = ui.one('.room-header .pill.tone-accent');
  assert.ok(hostBadge, '母语者房间头部应当有房主自动标签');
  assert.equal(hostBadge.textContent, zh('room.host') + ' · ' + label('matchIntents', 'teach'), '母语者房主应当自动带「教粤语」');
});

test('母语者等待态：切到「我也在等」并入队后，等待计时也每秒跳', async () => {
  const ui = await boot({ role: 'buddy' });
  const { store, win } = ui;

  await ui.goto('/match');
  // 母语者的默认视图是「挑学习者」，先切到等待视图：看到的也是同一张开始卡片
  await ui.clickButton(zh('match.tabWaiting'));
  assert.ok(ui.has('.match-start'), '母语者也要先看到开始卡片');
  assert.equal(store.getState().runtime.queue, null, '切 tab 本身不该入队');

  await ui.clickButton(zh('match.start'));
  assert.ok(store.getState().runtime.queue, '确认主题之后才入队');
  assert.ok(ui.has('.waiting-elapsed'), '母语者的等待面板要有计时');
  assert.equal(ui.one('.waiting-elapsed').textContent, zh('match.elapsed') + ' 0:00');

  // 关键回归：计时器必须自己跑，而不是等下一次重渲染才更新
  ui.advance(3_000);
  win.tick(1);
  await flush();
  assert.equal(ui.one('.waiting-elapsed').textContent, zh('match.elapsed') + ' 0:03', '母语者的等待计时也要每秒跳');

  ui.advance(5_000);
  win.tick(1);
  await flush();
  assert.equal(ui.one('.waiting-elapsed').textContent, zh('match.elapsed') + ' 0:08', '继续跳到 0:08');

  await ui.clickButton(zh('match.cancel'));
  assert.equal(store.getState().runtime.queue, null);
  assert.equal(win.pendingIntervals(), 0, '离开匹配页之后计时器要清掉，不留空转 interval');
});

test('路由守卫：越权访问会被重定向', async () => {
  // 学习者误入「资料预览」-> 回匹配大厅
  const learner = await boot({ role: 'learner' });
  await learner.goto('/match/learner-01');
  assert.equal(learner.win.location.hash, '#/match');

  // 母语者没做完 onboarding -> 回身份选择
  const rawBuddy = await boot({ role: 'buddy', buddyOnboarded: false });
  assert.equal(rawBuddy.store.getState().buddyProfile.onboarded, false);
  await rawBuddy.goto('/home');
  assert.equal(rawBuddy.win.location.hash, '#/onboarding/role');

  // 完成 onboarding 之后就能进首页，并且是母语者视角
  const buddy = await boot({ role: 'buddy' });
  await buddy.goto('/home');
  assert.equal(buddy.win.location.hash, '#/home');
  assert.ok(buddy.has('.home-action'), '首页主 CTA 没有渲染');
});

test('兜底：刷新后房间不在了，给横幅并回到匹配大厅', async () => {
  const ui = await boot({ role: 'learner' });
  await ui.goto('/room/r-not-exist');
  assert.equal(ui.win.location.hash, '#/match', '丢房后应当回到匹配大厅');
  assert.ok(ui.text().includes(zh('state.roomLost')), '没有给出丢房提示横幅');
  assert.ok(ui.has('.fallback-banner'), '横幅组件没有渲染');
});

test('界面语言：入口在我的设置，切换后整页重渲染并保存', async () => {
  const ui = await boot();
  assert.ok(ui.text().includes(zh('app.slogan')));
  assert.equal(ui.has('.top-bar .lang-switch'), false);
  await ui.goto('/me');
  await ui.click('.profile-settings');
  assert.ok(ui.has('.language-card .lang-switch'));

  await ui.clickButton('繁體中文');
  assert.equal(ui.store.getState().locale, 'zh-Hant');
  await ui.goto('/');
  assert.ok(ui.text().includes(createTranslator('zh-Hant')('app.slogan')), '繁体中文字文案没有生效');
  assert.ok(ui.text().includes(createTranslator('zh-Hant')('landing.getStarted')));

  await ui.goto('/me');
  await ui.click('.profile-settings');
  await ui.clickButton('English');
  assert.equal(ui.store.getState().locale, 'en');
  await ui.click('.profile-settings');
  assert.equal(ui.root.querySelector('.language-card .is-selected').textContent, 'English');
  await ui.goto('/');
  assert.ok(ui.text().includes(en('app.slogan')), '英文文案没有生效');
  assert.ok(ui.text().includes(en('landing.getStarted')));
});

test('兜底路由：任何不存在的路径都有页面，不留白屏', async () => {
  const ui = await boot();
  await ui.goto('/nope/not-here');
  assert.ok(ui.text().includes(zh('notFound.title')), '兜底页没有渲染');
  assert.equal(ui.text().includes('/nope/not-here'), false, '兜底页不应暴露对普通用户无帮助的原始路径');
  await ui.clickButton(zh('notFound.action'));
  assert.equal(ui.win.location.hash, '#/');
});

test('接口失败：页面走失败态并挂「离线数据」横幅，重试可用', async () => {
  const ui = await boot({
    role: 'learner',
    apiWrapper: (api) => ({
      ...api,
      getProgress: async () => {
        throw new Error('mock 故障注入');
      },
    }),
  });

  await ui.goto('/home');
  assert.ok(ui.has('.state-block.is-error'), '首页没有进入失败态');
  assert.ok(ui.has('.fallback-banner.is-warning'), '没有挂离线数据横幅');
  // 故障没解除，重试后仍然应当是失败态，但不可以抛错
  await ui.clickButton(zh('action.retry'));
  assert.ok(ui.has('.state-block.is-error'), '重试后没有重新渲染失败态');
});

test('演示控制台：能切身份、切延迟，且即时生效', async () => {
  const ui = await boot({ role: 'learner' });
  await ui.goto('/dev/mock');
  assert.ok(ui.has('.mock-panel'), '演示控制台没有渲染');
  assert.ok(ui.text().includes(zh('dev.waitingCount', { count: 4 })), '没有显示等待人数');

  await ui.clickButton(zh('role.buddySubtitle'));
  assert.equal(ui.store.getState().role, 'buddy');
  assert.ok(ui.text().includes(zh('dev.active')), '切换身份后控制台没有重渲染');

  await ui.clickButton('1.5s');
  assert.equal(ui.store.getState().settings.mockDelayMs, 1500);
  // 调回 0，避免后面的接口调用卡在模拟延迟上
  await ui.clickButton('0s');
  assert.equal(ui.store.getState().settings.mockDelayMs, 0);

  // 跳转链接可用（这里用「排行榜」验证 onJump 接通了）
  await ui.clickButton(zh('leaderboard.title'));
  assert.equal(ui.win.location.hash, '#/leaderboard');
});

test('配色主题：入口只在「我的」页，切一次就整站换色且不重新取数', async () => {
  const ui = await boot();

  // 配色和语言入口都放在“我的 → 设置”。
  await ui.goto('/home');
  assert.equal(ui.has('.theme-switch'), false, '页头不该再有主题切换入口');
  assert.equal(ui.has('.top-actions'), false);
  assert.equal(ui.doc.documentElement.getAttribute('data-theme'), 'mint', '冷启动就要把主题写到 <html>');

  await ui.goto('/me');
  await ui.click('.profile-settings');
  assert.ok(ui.has('.theme-card'), '「我的」页没有配色主题卡');
  assert.ok(ui.has('.theme-card .theme-switch'), '配色主题卡里没有切换器');

  const mainBefore = ui.one('.app-main');
  await ui.clickButton(zh('theme.warm'));
  assert.equal(ui.doc.documentElement.getAttribute('data-theme'), 'warm', '切了主题但 <html> 没跟上');
  assert.equal(ui.store.getState().settings.theme, 'warm');
  assert.equal(
    ui.one('.theme-card .theme-option.theme-warm').classList.contains('is-selected'),
    true,
    '切完没有立刻反白',
  );
  assert.equal(ui.one('.app-main'), mainBefore, '换配色只该改 CSS 变量，不该整页重建壳子');
  assert.equal(ui.has('.skeleton'), false, '换配色不该让当前页回到骨架屏');

  // 回到别的页面：主题跟着走，但页面里依然没有切换入口
  await ui.goto('/match');
  assert.equal(ui.has('.theme-switch'), false);
  assert.equal(ui.doc.documentElement.getAttribute('data-theme'), 'warm', '换页不该把主题弄丢');
});

test('配色主题：「我的」页与演示控制台两处互相同步', async () => {
  const ui = await boot();
  await ui.goto('/me');
  await ui.click('.profile-settings');
  await ui.clickButton(zh('theme.warm'));
  assert.equal(ui.store.getState().settings.theme, 'warm');

  // 演示控制台：同一组主题也要能切（救场用，不用离开当前页）
  await ui.goto('/dev/mock');
  assert.ok(ui.text().includes(zh('theme.title')), '控制台摘要里没有主题');
  assert.ok(ui.text().includes(zh('theme.warm')), '控制台没有反映当前主题');
  await ui.clickButton(zh('theme.mint'));
  assert.equal(ui.store.getState().settings.theme, 'mint');
  assert.equal(ui.doc.documentElement.getAttribute('data-theme'), 'mint');

  // 回「我的」页：换过的主题要同步成选中态
  await ui.goto('/dev/mock');
  await ui.clickButton(zh('theme.warm'));
  await ui.goto('/me');
  await ui.click('.profile-settings');
  assert.equal(
    ui.one('.theme-card .theme-option.theme-warm').classList.contains('is-selected'),
    true,
    '「我的」页没有同步控制台改过的主题',
  );
});

test('配色主题：会话房间是沉浸页，没有页头，因此也不放主题切换入口', async () => {
  const ui = await boot({ role: 'learner' });
  await ui.goto('/match');
  await ui.clickButton(zh('match.start'));
  ui.advance(MATCH_WAIT_MS);
  ui.win.tick(1);
  await flush();
  assert.ok(ui.has('.match-toast'), '排队后没有等到匹配请求');
  await ui.clickButton(zh('match.accept'));
  assert.match(ui.win.location.hash, /^#\/room\//, '接受之后没有进房间：' + ui.win.location.hash);

  assert.equal(ui.has('.top-bar'), false, '沉浸页不该有页头');
  assert.equal(ui.has('.theme-switch'), false, '沉浸页不放主题切换入口（演示前先在外面切好）');
  assert.equal(ui.doc.documentElement.getAttribute('data-theme'), 'mint', '进房不该把主题弄丢');
});

test('onboarding 退出：第一次切换身份直接进资料页，退出后角色与两份资料整段还原', async () => {
  const ui = await boot({ role: 'learner', buddyOnboarded: false });
  const { store, win } = ui;
  const beforeBuddy = JSON.parse(JSON.stringify(store.getState().buddyProfile));
  const beforeLearner = JSON.parse(JSON.stringify(store.getState().learnerProfile));

  await ui.goto('/me');
  assert.ok(ui.text().includes(zh('me.switchNeedsSetup')), '按钮下面先说明「第一次切换要先补资料」');
  await ui.clickButton(zh('me.switchTo'));

  // ① 不再等用户点「匹配」被守卫弹回来：点「切换」＝第 1 步已经选好，直接落在资料页（第 2 步）
  assert.equal(win.location.hash, '#/onboarding/profile');
  assert.equal(store.getState().role, 'buddy', '身份先切过去，但要等填完才算数');
  assert.ok(store.getState().runtime.onboarding, '立了还原点');
  const segments = ui.all('.step-seg');
  assert.equal(segments.length, 3);
  assert.ok(segments[1].classList.contains('is-active'), '步骤条停在 2 / 3');
  assert.ok(segments[0].classList.contains('is-done'), '第 1 步显示为已完成');

  // ② 左上角是带文字的「退出」按钮，不是 44px 的返回箭头
  assert.ok(ui.has('.exit-btn'), '缺少退出按钮');
  assert.ok(ui.one('.exit-btn').textContent.includes(zh('action.exit')));
  assert.equal(ui.has('.icon-btn'), false, 'onboarding 里不再用返回箭头');

  // ③ 改点草稿再退出：草稿丢掉，角色与两份资料一起还原
  await ui.clickButton(label('interests', 'gaming'));
  // 草稿只活在这一页：没点「暂时跳过」就不写进 store（旧版默认资料里本来就有 gaming，
  // 这条断言以前是「假通过」——出厂资料改成不预选之后才暴露出来）
  assert.equal(store.getState().buddyProfile.interests.includes('gaming'), false, '没点「暂时跳过」，资料不落库');
  assert.equal(ui.one('.question-body').textContent.includes(label('interests', 'gaming')), true, '草稿里能看到刚选的那一项');
  await ui.clickButton(zh('action.exit'));
  assert.equal(win.location.hash, '#/me', '退出后回「我的」');
  assert.equal(store.getState().role, 'learner', '角色还原到切换之前');
  assert.deepEqual(store.getState().buddyProfile, beforeBuddy, '母语者资料还原');
  assert.deepEqual(store.getState().learnerProfile, beforeLearner, '学习者资料没被动过');
  assert.equal(store.getState().runtime.onboarding, null, '还原点用完即清');
  assert.ok(ui.text().includes(zh('onboarding.exitRestored')), '挂一条「已还原」的一次性提示');
});

test('资料页：一屏一题，滑动 / 下一项换题，末项「下一步」把已填的部分一起保存', async () => {
  const ui = await boot({ role: 'learner', buddyOnboarded: true });
  const { store, win } = ui;
  await ui.goto('/onboarding/profile');

  assert.equal(ui.one('.question-pager').dataset.index, '0');
  assert.ok(ui.text().includes('第 1 / 6 项'), '学习者 5 题，从第 1 题开始');
  assert.equal(findButton(ui.root, zh('setup.prevItem')).disabled, true, '首项没有上一项');

  // 出厂资料不预选任何一项：第 1 题（母语）一开始是空的，这里自己选一个，
  // 后面用它验证「草稿跨题保留」
  assert.equal(findButton(ui.root, label('nativeLanguages', 'english')).classList.contains('is-selected'), false, '出厂不预选母语');
  await ui.clickButton(label('nativeLanguages', 'english'));
  assert.ok(findButton(ui.root, label('nativeLanguages', 'english')).classList.contains('is-selected'), '选上 English');

  // 左划 → 第 2 题（粤语水平）
  const swipeLeft = () => {
    ui.one('.question-body').dispatch('pointerdown', { clientX: 240 });
    ui.one('.question-body').dispatch('pointerup', { clientX: 150 });
  };
  const swipeRight = () => {
    ui.one('.question-body').dispatch('pointerdown', { clientX: 120 });
    ui.one('.question-body').dispatch('pointerup', { clientX: 210 });
  };
  swipeLeft();
  await flush();
  assert.equal(ui.one('.question-pager').dataset.index, '1', '左划换到下一题');
  assert.ok(ui.text().includes(zh('setup.level')), '第 2 题是粤语水平');

  // 点「下一项」→ 第 3 题（兴趣），选一个标签（选标签不该换题）
  await ui.clickButton(zh('setup.nextItem'));
  assert.equal(ui.one('.question-pager').dataset.index, '2');
  await ui.clickButton(label('interests', 'travel'));
  assert.equal(ui.one('.question-pager').dataset.index, '2', '选标签不换题');

  // 右划回第 2 题、再回第 1 题：第 1 题选的 English 还在（草稿跨题保留）
  swipeRight();
  await flush();
  swipeRight();
  await flush();
  assert.equal(ui.one('.question-pager').dataset.index, '0', '右划回到第 1 题');
  assert.ok(findButton(ui.root, label('nativeLanguages', 'english')).classList.contains('is-selected'), '回到第 1 题，选择还在');

  // 走到末项：那颗按钮换成**可点的「下一步」**，但滑动仍不越界、不提交
  await ui.clickButton(zh('setup.nextItem'));
  await ui.clickButton(zh('setup.nextItem'));
  await ui.clickButton(zh('setup.nextItem'));
  await ui.clickButton(zh('setup.nextItem'));
  await ui.clickButton(zh('setup.nextItem'));
  assert.equal(ui.one('.question-pager').dataset.index, '5');
  const finalStep = findButton(ui.root, zh('setup.nextStep'));
  assert.ok(finalStep, '末项应把「下一项」换成「下一步」');
  assert.notEqual(finalStep.disabled, true, '末项的「下一步」必须可点——否则用户走到头就没有出口了');
  assert.equal(findButton(ui.root, zh('setup.nextItem')), null, '末项不再显示「下一项」');
  swipeLeft();
  await flush();
  assert.equal(ui.one('.question-pager').dataset.index, '5', '末项继续划不越界');
  assert.equal(win.location.hash, '#/onboarding/profile', '滑动不提交');

  // 点末项「下一步」→ 已填的部分落库并进隐私页（与「暂时跳过」同一条路）
  await ui.clickButton(zh('setup.nextStep'));
  assert.equal(win.location.hash, '#/onboarding/privacy');
  assert.equal(store.getState().learnerProfile.interests.includes('travel'), true, '跨题改动都保存了');
  assert.equal(store.getState().learnerProfile.onboarded, true);
  await ui.clickButton(zh('privacy.finishSetup'));
  assert.equal(store.getState().runtime.onboarding, null, '走完三页后还原点作废');
});


test('伙伴关系「打开即准」：进受保护页面就拉两张表，拉不到也不拦启动', async () => {
  // 落地页 / 注册页是「注册前路由」，那时还没有令牌，所以拉表这件事发生在
  // **进到受保护页面**之后（这里直接落在 /home，等于「已注册的设备打开 app」）。
  const calls = [];
  const ui = await boot({
    hash: '#/home',
    apiWrapper: (base) => ({
      ...base,
      listBuddies: async () => {
        calls.push('buddies');
        return [{ peerId: 'siu-fung', label: 'siu-fung', since: '2026-09-29T08:00:00.000Z' }];
      },
      listBuddyRequests: async () => {
        calls.push('requests');
        return [{ requestId: 'req-1', peerId: 'ka-ho', direction: 'incoming', status: 'pending' }];
      },
    }),
  });
  await flush();

  assert.deepEqual(calls.slice().sort(), ['buddies', 'requests'], '启动时两张表都要拉一次');
  assert.deepEqual(
    ui.store.getState().social.buddies.map((row) => row.peerId),
    ['siu-fung'],
    '拉回来的伙伴要灌进 store（/dev/mock 与首屏读的就是它）',
  );
  assert.equal(ui.store.getState().social.buddyRequests[0].requestId, 'req-1');

  // 换身份＝换令牌：再对齐一次
  const before = calls.length;
  ui.store.setRole('buddy');
  await flush();
  assert.equal(calls.length, before + 2, '换身份之后再拉一次');

  // 页面照样能正常走（这条只是锦上添花，不能改变主链路）
  await ui.goto('/me');
  assert.equal(ui.win.location.hash, '#/me');
});

test('伙伴关系「打开即准」：拉失败（未登录 / 后端没起）静默降级，app 照常启动', async () => {
  const ui = await boot({
    // 本地先有一条关系：拉失败时它必须原样留着，不能被清成空表
    storagePreset: { social: { buddies: [{ peerId: 'local-only', label: 'local-only', since: '2026-09-29T08:00:00.000Z' }] } },
    apiWrapper: (base) => ({
      ...base,
      listBuddies: async () => {
        const error = new Error('missing bearer token');
        error.code = 'not_authorized';
        throw error;
      },
      listBuddyRequests: async () => {
        throw new Error('backend down');
      },
    }),
  });
  await flush();

  assert.equal(ui.win.location.hash, '#/', '启动没被拖垮：默认落在落地页');
  assert.ok(ui.root.textContent.length > 0, '页面正常渲染，不是白屏');
  assert.ok(Array.isArray(ui.store.getState().social.buddies), '本地镜像保持原样，不是 undefined');
  assert.deepEqual(
    ui.store.getState().social.buddies.map((row) => row.peerId),
    ['local-only'],
    '拉不到就保持本地原样，不能被清成空表',
  );
});

test('匹配频道：进受保护页面就连上 /ws/match，推送「对方已开房」的 match:matched 直接进房', async () => {
  // 这一条钉的是「我点了对面，对面没反应」那个 bug 的**装配**部分：
  // 前端以前从来没连过 /ws/match，后端推的事件全进了空气。逻辑本身由
  // tests/matchSync.test.mjs 逐条覆盖，这里只证明 app.js 真的把它接上了。
  //
  // 落在 `/home` 而不是落地页：匹配频道要令牌，而令牌是进受保护页面之后才拿到的
  // （落地页 / 注册页是「注册前路由」，见 app.js 的 PRE_AUTH_ROUTES）。
  const { createWebSocketStub } = await import('./helpers/rtc-stub.mjs');
  const { TOKEN_KEY } = await import('../src/services/http.js');
  const { FakeWebSocket, sockets } = createWebSocketStub();

  // 令牌落在 localStorage 里 —— `readStoredToken()` 读的就是它（WebSocket 不能带自定义头）
  const previousStorage = globalThis.localStorage;
  const map = new Map([[TOKEN_KEY, 'tok-test']]);
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };

  try {
    const ui = await boot({
      hash: '#/home',
      role: 'learner',
      signalUrl: 'wss://localhost:4173/ws',
      webSocket: FakeWebSocket,
    });
    await flush();

    // ① 真的挂上了匹配频道（而不是「消息推进空气」）
    assert.equal(sockets.length, 1, '启动后应当连上匹配频道');
    assert.equal(sockets[0].url, 'wss://localhost:4173/ws/match?token=tok-test', '地址与令牌口径不对');

    // ② 母语者挑人 → 后端推 match:matched（requestId 为 null）→ 学习者直接进房
    sockets[0].open();
    sockets[0].message({
      type: 'match:matched',
      requestId: null,
      roomId: 'r-live-9',
      peer: { peerId: 'buddy-u-2', displayName: '阿明', role: 'buddy' },
      expiresAt: null,
    });
    await flush();

    assert.equal(ui.win.location.hash, '#/room/r-live-9', '收到推送应当直接进房，不用用户点「接受」');
    assert.equal(ui.store.getState().runtime.room.roomId, 'r-live-9');
    assert.equal(ui.store.getState().runtime.matchRequest, null, 'requestId 为 null 时不该当成待接受请求');
    assert.equal(ui.has('.match-toast'), false, 'requestId 为 null 时不该弹接受框');
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('退出并换人：匹配频道要跟着关掉（令牌只在握手时校验过，作废会话掐不断 socket）', async () => {
  // 服务端作废会话**不会**把已经握完手的 socket 掐掉 —— 令牌只在握手那一刻看过一次。
  // 所以退出时前端必须自己 `matchSync.close()`，否则旧账号的 match:matched / queue:updated
  // 还会继续推到这台已经没人的设备上（落地页凭空弹一个接受框，甚至把人拉进旧账号的房间）。
  const { createWebSocketStub } = await import('./helpers/rtc-stub.mjs');
  const { TOKEN_KEY } = await import('../src/services/http.js');
  const { FakeWebSocket, sockets } = createWebSocketStub();

  const previousStorage = globalThis.localStorage;
  const map = new Map([[TOKEN_KEY, 'tok-test']]);
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };

  try {
    const ui = await boot({
      hash: '#/me',
      role: 'learner',
      signalUrl: 'wss://localhost:4173/ws',
      webSocket: FakeWebSocket,
    });
    await flush();
    assert.equal(sockets.length, 1, '进受保护页面应当连上匹配频道');
    sockets[0].open();

    await ui.click('.profile-account');
    await ui.clickButton(zh('account.signOut'));
    await ui.clickButton(zh('account.confirmYes'));
    await flush();

    assert.equal(sockets[0].closed, true, '退出时必须关掉匹配频道');
    // 关掉之后不该自己重连（`closedByUs` 之后不再退避重试）
    ui.advance(20_000);
    await flush();
    assert.equal(sockets.length, 1, '退出之后不该重连匹配频道');
    assert.equal(ui.win.location.hash, '#/', '回落地页');
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('回归：接受弹窗必须走 api 层（真后端要在这里原子成房）', async () => {
  const calls = [];
  const ui = await boot({
    apiWrapper: (base, store) => ({
      ...base,
      // 真后端：accept 会 POST /api/match/requests/:id/accept，成功后再把 store 推进房间
      acceptMatchRequest: async () => {
        calls.push('acceptMatchRequest');
        return store.acceptMatchRequest();
      },
    }),
  });

  // 造一条待接受请求（模拟匹配引擎 / 演示口子送来的那一条）
  ui.store.receiveMatchRequest({
    requestId: 'req-live-1',
    roomId: 'r-live-1',
    peer: { peerId: 'ka-ho', displayName: 'ka-ho', anonymous: false },
    expiresAt: Date.now() + 10_000,
  });
  await flush();
  assert.ok(ui.has('.match-toast'), '有待接受请求时应当弹出接受弹窗');

  await ui.clickButton(zh('match.accept'));
  assert.equal(calls.length, 1, '「接受」必须调 api.acceptMatchRequest —— 只改本地 store 的话服务端根本没建房间');
  assert.equal(ui.win.location.hash, '#/room/r-live-1', '接受之后进房间');
});

test('回归：房间页 load 失败时渲染错误态，而不是把整个 app 崩掉', async () => {
  const ui = await boot({
    apiWrapper: (base) => ({
      ...base,
      getCards: async () => {
        const error = new Error('room not found');
        error.code = 'room_gone';
        throw error;
      },
    }),
  });
  ui.store.startRoom({ roomId: 'r-gone', peer: { peerId: 'ka-ho', displayName: 'ka-ho' }, role: 'learner' });

  await ui.goto('/room/r-gone');
  assert.ok(ui.has('.state-block.is-error'), 'load 失败要渲染错误态（以前这里会抛 TypeError 把 paint 打崩）');
  assert.ok(ui.text().includes(zh('state.failed')), '错误态要带文案');

  // 出路：回匹配大厅（契约 4.5 节 room_gone 的处理）
  await ui.clickButton(zh('action.retry'));
  assert.equal(ui.win.location.hash, '#/match', '「重试」应当回到匹配大厅');
});


test('我的页大卡片进入商城，商城故障后返回我的', async () => {
  const normal = await boot({ hash: '#/me' });
  await flush();
  assert.ok(normal.has('.profile-shop-entry'));
  await normal.click('.profile-shop-entry');
  assert.equal(normal.win.location.hash, '#/shop');
  const ui = await boot({ hash: '#/shop', apiWrapper: api => ({ ...api, getShop: async () => { throw Object.assign(new Error('old backend'), { code: 'not_found' }); } }) });
  await flush();
  assert.ok(ui.text().includes(zh('shop.unavailable')), ui.text());
  assert.ok(ui.has('.state-block.is-error'));
  // 商城左上角是带文字的显眼返回（和 onboarding 的退出键同一套外观），不是 44px 的返回箭头
  assert.ok(ui.has('.exit-btn'), '商城页要有带文字的页头按钮');
  assert.equal(ui.has('.icon-btn'), false, '商城页不再用返回箭头');
  assert.ok(ui.one('.exit-btn').textContent.includes(zh('action.back')));
  await ui.click('.exit-btn');
  assert.equal(ui.win.location.hash, '#/me');
  assert.ok(ui.has('.profile-shop-entry'));
  assert.equal(ui.has('.state-block.is-error'), false);
});


test('页面不显示手动布局切换按钮，表单正常可用', async () => {
  const ui = await boot({ hash: '#/onboarding/privacy' });
  await flush();
  const input = ui.one('.custom-tag-input');
  input.value = '正在填写';
  input.dispatch('input');
  assert.equal(ui.one('.custom-tag-input').value, '正在填写');
  assert.equal(ui.has('.display-mode-switch'), false);
  assert.equal(ui.has('.display-mode-button'), false);
});

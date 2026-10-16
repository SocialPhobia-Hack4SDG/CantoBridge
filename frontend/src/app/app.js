/**
 * 应用装配：哈希路由 -> 守卫 -> 外壳（AppShell）-> 页面三态渲染。
 * 只依赖 lib/ 与 components/，页面模块通过 routes.js 注册进来。
 */

import { AppShell, BottomNav, LoadingSkeleton, TopBar, StepProgress, FallbackBanner } from '../components/base.js';
import { MatchAcceptToast, URGENT_SECONDS } from '../components/match.js';
import { labelOf } from '../data/labels.js';
import { normalizeTheme } from '../data/themes.js';
import { createTranslator } from '../i18n/i18n.js';
import { h, mount } from '../lib/dom.js';
import { MATCH_FOUND_AFTER_MS, acceptCountdown } from '../lib/logic.js';
import { createRouter, parseHash } from '../lib/router.js';
import { readStoredToken } from '../services/http.js';
import { createMatchSync } from './matchSync.js';
import { ROUTES, findRoute } from './routes.js';
import { createSocialSync } from './socialSync.js';
import { createSession } from './session.js';
import { createDemoRoom, demoPeer } from './demoRoom.js';
import { createMatchFallback, DEMO_ACCEPT_MS } from './matchFallback.js';

const DEFAULT_HASH = '#/';

/**
 * `signalUrl`：远端信令基址（`lib/signal.js` 解析，`docs/10` 第 5 节）。
 * 只放进 ctx 给房间页用，**不挂到 api 上**——api 的方法名集合要和 mock 逐个相等
 * （`tools/check-api.mjs` 第 7b 条），多挂一个属性就会判红。
 */
export function createApp({
  store,
  api,
  signalUrl = null,
  allowSimulation = signalUrl === null,
  doc = globalThis.document,
  win = globalThis.window,
  mountPoint = 'app',
  webSocket = globalThis.WebSocket ?? null,
}) {
  const router = createRouter(ROUTES.map((route) => ({ path: route.path, name: route.name })));
  const root = typeof mountPoint === 'string' ? doc?.getElementById(mountPoint) : mountPoint;
  if (!root) throw new Error('找不到挂载点 #' + mountPoint + '，请检查 index.html');
  const rooms = new Map();
  let bottomNav = null;
  let demo = null;
  const matchFallback = createMatchFallback();
  let enteringDemo = false;
  // 伙伴关系「打开即准」：启动拉一次、换身份再拉（失败静默，见 socialSync.js）
  const socialSync = createSocialSync({ api, store });
  // 登录引导：启动（及换身份时）先拿到令牌，见 session.js
  const session = createSession({ api, store });
  /**
   * 匹配频道（`/ws/match`）：排队 / 挑人 / 被挑中都靠它推。
   *
   * 少了它，后端推的 `match:matched` 没人接 —— 现场表现就是「我点了对面，对面没反应」
   * （见 matchSync.js 的说明）。缺令牌或缺 `signalUrl` 时它自己就是空操作，
   * 所以纯 mock 档位（`?api=mock`）与单测里不需要特殊处理。
   */
  const matchSync = createMatchSync({
    store,
    signalUrl,
    getToken: () => readStoredToken(),
    WebSocketImpl: webSocket,
    // store 只记房间、不碰路由；进房这一步由外壳层做（与 acceptMatch 同一条路）
    onEnterRoom: (roomId) => navigate('/room/' + roomId),
  });

  /**
   * 「注册前路由」：落地页与注册页。这两页**一个受保护的接口都不调**，
   * 没有令牌也照常渲染；而账号要等用户真点了「注册」才长出来（见 `auth.ensure`）。
   *
   * 少了这道闸，app 一启动就会把账号建好——「显式注册」立刻退回成走过场，
   * 而且任何一台只是路过落地页的设备都会在服务端留下一个空账号。
   */
  const PRE_AUTH_ROUTES = new Set(['/', '/register']);

  /**
   * 这一轮会话允不允许登录。落地页 / 注册页上恒为 false，注册成功（或进了受保护页面）
   * 之后才放开。它交给 `session.attach({ enabled })`，用来回答
   * 「身份变化要不要顺手登录」——注册前必须按兵不动。
   */
  let authEnabled = false;

  let renderToken = 0;
  let current = null;
  let lastSignature = null;
  let lastHash = null;
  let appliedTheme = null;

  /**
   * 确保当前身份有令牌，并在**真的登录了**（而不是「早就登过」）之后接上实时通道。
   *
   * `session.ensure()` 自带幂等（同一个身份第二次返回 false），所以这里可以放心地
   * 每次渲染都调——真正只跑一次的是它后面那两件事（连匹配频道、对齐关系表）。
   * 顺序不能反：没有令牌时连上去会被 401 踢掉、拉列表只会拿到 401。
   */
  async function ensureAuth() {
    authEnabled = true;
    const fresh = await session.ensure();
    if (fresh) {
      matchSync.open();
      await socialSync.sync();
    }
    return fresh;
  }

  /**
   * 退出并换人：关掉实时通道 → 作废服务端会话 → 清本机账号（**连设备 id 一起换掉**）→ 回落地页。
   *
   * 先关闸（`authEnabled = false`）再动 store，顺序不能反：`resetAccount()` 会 notify，
   * 而此刻身份记账已经清空，闸门开着的话订阅回调会立刻拿着新设备 id 把账号建出来——
   * 「退出并换人」就变成了「退出并自动注册一个人」。
   *
   * `matchSync.close()` 也不能漏：令牌只在**握手那一刻**被校验过，服务端作废会话并不会
   * 把已经握完手的 socket 掐掉。不关的话，退出之后旧账号的 `match:matched` / `queue:updated`
   * 还会继续推到这台已经没人的设备上（落地页上凭空弹一个接受框）。
   */
  async function signOutAndReset() {
    authEnabled = false;
    matchSync.close();
    await session.signOut();
    store.resetAccount();
    navigate('/');
  }

  /**
   * 把主题写到 `<html data-theme>`：颜色全部是 CSS 变量，覆盖块挂在根元素上，
   * 所以切主题只需要改这一个属性，**不重建 DOM、不重新取数**。
   * 记一份 appliedTheme 做幂等：store 每次变动都会调它，属性值没变就别动 DOM。
   * 测试里的 document stub 不一定有 documentElement，所以全程可选链。
   */
  function applyTheme(theme) {
    const id = normalizeTheme(theme);
    if (id === appliedTheme) return;
    appliedTheme = id;
    const rootEl = doc?.documentElement;
    if (rootEl && typeof rootEl.setAttribute === 'function') rootEl.setAttribute('data-theme', id);
  }

  function navigate(to) {
    const next = '#' + to;
    if (win.location.hash === next) {
      render(true);
      return;
    }
    win.location.hash = next;
  }

  /**
   * 后台匹配引擎 + 匹配弹窗控制器。
   *
   * 为什么放在 app 层而不是页面里：排队与「匹配成功」必须脱离 /match 页面的生命周期。
   * 页面里注册的定时器会在导航时被 exitCurrent() 清掉，所以「离开匹配页继续排队」这件事
   * 只能由外壳层持有。定时器只在「排队中或有待接受请求」时存在，条件结束立刻清掉，
   * 不留空转的 interval。
   *
   * 演示用的假时序（真实实现应由服务端 match:matched 驱动，见 docs/07 的 Q-G11）：
   * 排队满 MATCH_FOUND_AFTER_MS 后自动产出一条待接受请求。
   */
  const matchRunner = { intervalId: null, working: false, slot: null, toastKey: null, nextAttemptAt: 0 };

  function syncMatchRunner() {
    const state = store.getState();
    const active = Boolean(state.runtime.queue || state.runtime.matchRequest);
    if (active && matchRunner.intervalId === null) {
      // 重新进入匹配流程：冷却时间也跟着重置，别把上一轮的等待带过来
      matchRunner.nextAttemptAt = 0;
      matchRunner.intervalId = setInterval(() => {
        void matchTick();
      }, 1000);
    } else if (!active && matchRunner.intervalId !== null) {
      clearInterval(matchRunner.intervalId);
      matchRunner.intervalId = null;
    }
    syncMatchToast();
  }

  /** 每秒一次：要么推进倒计时，要么给还在排队的学习者找一个伙伴。 */
  async function matchTick() {
    const state = store.getState();
    const request = state.runtime.matchRequest;
    if (request) {
      // 倒计时到点 = 视为「不接受」，回到等待队列（默认值见 docs/07 的 Q-G12）
      if (acceptCountdown(request.expiresAt, store.now()) <= 0) {
        matchRunner.nextAttemptAt = store.now() + MATCH_FOUND_AFTER_MS;
        await api.declineMatchRequest({ expired: true });
        return;
      }
      syncMatchToast();
      return;
    }
    if (!state.runtime.queue || state.runtime.room) return;
    const offer = matchFallback.sync(state, store.now());
    if (offer && acceptCountdown(offer.expiresAt, store.now()) <= 0) {
      await enterFallbackRoom();
      return;
    }
    syncMatchToast();
    if (state.role !== 'learner') return;
    if (state.settings.backgroundMatch === false) return;
    if (store.now() - state.runtime.queue.joinedAt < MATCH_FOUND_AFTER_MS) return;
    // 冷却：拒绝或超时之后不会马上再弹一个，要再等一轮
    if (store.now() < matchRunner.nextAttemptAt) return;
    if (matchRunner.working) return;
    matchRunner.working = true;
    try {
      await api.requestMatch({ reason: 'background' });
    } catch {
      // 演示辅助失败就当作还没匹配到，下一轮再试
    } finally {
      matchRunner.working = false;
      matchRunner.nextAttemptAt = store.now() + MATCH_FOUND_AFTER_MS;
    }
  }

  /**
   * 把待接受的匹配请求画到跨路由的 toast 插槽里。
   * 同一场匹配只建一次 DOM，之后只改秒数——重建会把进度条动画打断。
   */
  function syncMatchToast() {
    const slot = matchRunner.slot;
    if (!slot) return;
    const state = store.getState();
    const request = state.runtime.matchRequest;
    const offer = matchFallback.sync(state, store.now());
    if (!request && offer) {
      const remaining = acceptCountdown(offer.expiresAt, store.now());
      const key = 'demo:' + offer.key;
      if (matchRunner.toastKey !== key) {
        const t = createTranslator(state.locale);
        matchRunner.toastKey = key;
        const toast = MatchAcceptToast({ peer: demoPeer(state), remaining, totalSeconds: DEMO_ACCEPT_MS / 1000,
          title: t('demo.offerTitle'), hint: t('demo.offerHint'), showHint: true,
          acceptLabel: t('demo.accept'), declineLabel: t('demo.keepWaiting'),
          onAccept: () => void enterFallbackRoom(),
          onDecline: () => { matchFallback.dismiss(); syncMatchToast(); },
        });
        toast.classList.add('demo-match-toast');
        mount(slot, toast);
      } else {
        const count = slot.querySelector?.('.match-toast-count');
        if (count) count.textContent = String(remaining);
      }
      return;
    }
    if (!request) {
      if (matchRunner.toastKey !== null) {
        matchRunner.toastKey = null;
        mount(slot, null);
      }
      return;
    }
    const remaining = acceptCountdown(request.expiresAt, store.now());
    if (request.roomId !== matchRunner.toastKey) {
      const t = createTranslator(state.locale);
      matchRunner.toastKey = request.roomId;
      mount(slot, MatchAcceptToast({ anonymousLabel: t('anonymous.label'),
        peer: request.peer,
        remaining,
        totalSeconds: Number(state.settings.matchAcceptSeconds) || 10,
        title: t('match.acceptTitle'),
        hint: t('match.acceptHint'),
        acceptLabel: t('match.accept'),
        declineLabel: t('match.decline'),
        onAccept: acceptMatch,
        onDecline: declineMatch,
      }));
      return;
    }
    const countNode = slot.querySelector?.('.match-toast-count');
    if (countNode) countNode.textContent = String(remaining);
    const toastNode = slot.querySelector?.('.match-toast');
    if (toastNode) {
      if (remaining <= URGENT_SECONDS) toastNode.classList.add('is-urgent');
      else toastNode.classList.remove('is-urgent');
    }
  }

  async function enterFallbackRoom() {
    const source = store.getState();
    if (enteringDemo || matchRunner.working || !matchFallback.sync(source, store.now()) || source.runtime.matchRequest || source.runtime.room) return;
    enteringDemo = true;
    const hash = win.location.hash;
    matchFallback.dismiss();
    syncMatchToast();
    try {
      await api.leaveQueue();
      const latest = store.getState();
      // A live room, new queue, account change or navigation during cancellation wins.
      if (latest.runtime.room || latest.runtime.queue || latest.runtime.matchRequest || latest.role !== source.role || latest.learnerProfile.userId !== source.learnerProfile.userId || win.location.hash !== hash) return;
      demo = createDemoRoom(latest, { now: store.now });
      navigate('/room/demo-preview');
    } catch {
      store.setNotice({ kind: 'banner', messageKey: 'demo.enterFailed', tone: 'warning' });
      render(true);
    } finally {
      enteringDemo = false;
    }
  }

  /**
   * 接受 → 直接进房。
   *
   * **必须走 api 层**（不能直接 `store.acceptMatchRequest()`）：真后端是在 accept
   * 那一刻**原子成房**的，绕过 api 层就只是本地把状态挪一挪 —— 服务端根本没建房间，
   * 进房后 `GET /api/rooms/:id/cards` 直接 404（真数据联调踩到过）。
   * 房间号也以**接受成功后 store 里的房间**为准（服务端返回的那个）。
   */
  async function acceptMatch() {
    const request = store.getState().runtime.matchRequest;
    if (!request) return;
    try {
      await api.acceptMatchRequest();
    } catch (error) {
      // 演示路径不给死胡同：接受失败就当这一条过期，退出等待让用户能重新开始
      void api.declineMatchRequest?.({ expired: true });
      void error;
      return;
    }
    const room = store.getState().runtime.room;
    if (room?.roomId) navigate('/room/' + room.roomId);
  }

  /** 不接受 → 只是回到等待队列，不离开匹配流程；也不跳任何页面。 */
  function declineMatch() {
    void api.declineMatchRequest();
  }

  function exitCurrent() {
    if (!current) return;
    for (const cleanup of current.cleanups) {
      try {
        cleanup();
      } catch (error) {
        void error;
      }
    }
    current.page.onExit?.(current.ctx);
    current = null;
  }

  function guardRedirect(route, state, path, params) {
    if (route.guard === 'learner' && state.role !== 'learner') return { to: '/home' };
    if (route.guard === 'buddy' && state.role !== 'buddy') return { to: '/match' };
    if (route.guard === 'onboarded' || route.guard === 'learner') {
      const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
      if (!profile || profile.onboarded !== true) return { to: '/onboarding/role' };
    }
    if (route.guard === 'room') {
      const room = state.runtime.room;
      if (!room || room.roomId !== params.roomId) {
        return { to: '/match', noticeKey: 'state.roomLost' };
      }
      if (path.endsWith('/summary') && !state.runtime.reward) {
        return { to: '/room/' + params.roomId };
      }
    }
    return null;
  }

  /**
   * 退出 onboarding：整段填写作废，并按进入前的还原点还原（见 store.cancelOnboarding）。
   *
   * 为什么必须还原：在「我的」点「切换为…」时角色就已经改了，此时退出不能把账号留在
   * 「新身份 + 旧资料」的半成品上。落点选「还原后当前身份已有资料」的地方：有资料回
   * 「我的」，连资料都没有（全新用户）回落地页——否则会被 /me 的守卫再弹回 onboarding。
   */
  function leaveOnboarding() {
    const hadSnapshot = Boolean(store.getState().runtime.onboarding);
    store.cancelOnboarding();
    const state = store.getState();
    const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
    if (hadSnapshot) store.setNotice({ kind: 'banner', messageKey: 'onboarding.exitRestored', tone: 'info' });
    navigate(profile?.onboarded === true ? '/me' : '/');
  }

  function topBarNode(route, ctx) {
    if (route.immersive) return null;
    // 左上角按钮两种形态：默认是 44px 返回箭头；带文字的描边胶囊只留给两类入口——
    // onboarding 三页的「退出」（放弃本次填写并还原配置，是有后果的动作），
    // 以及 route.backLabelKey 点名的显眼返回（/shop，见 docs/03 4.2）。
    // 这里保留 t('...') 字面量，好让 check-ui 的 key 扫描看得见 onboarding 这两个文案。
    const isOnboardingStep = Boolean(route.step);
    const backLabel = isOnboardingStep
      ? ctx.t('action.exit')
      : route.backLabelKey
        ? ctx.t(route.backLabelKey)
        : null;
    const backHint = isOnboardingStep
      ? ctx.t('action.exitHint')
      : route.backHintKey
        ? ctx.t(route.backHintKey)
        : null;
    const backHandler =
      route.back && route.path !== '/'
        ? isOnboardingStep
          ? () => leaveOnboarding()
          : route.backTo ? () => navigate(route.backTo) : () => win.history.back()
        : null;
    return h(TopBar, {
      title: ctx.t(route.titleKey ?? 'app.name'),
      onBack: backHandler,
      backLabel,
      backHint,
      backAriaLabel: ctx.t('action.back'),
    });
  }

  function render(force = false) {
    const state0 = store.getState();
    const hash = win.location.hash || DEFAULT_HASH;
    const signature = hash + '|' + state0.locale;
    if (!force && signature === lastSignature) return;
    // 同一条路由、只是界面语言变了（见 start() 里的 locale 订阅）时，把上一份 view 原样
    // 带过来：改语言不该把人从「我的」页的设置面板里踢回主界面，也不该再拉一次接口、
    // 闪一次骨架屏。换路由则一律从头来。
    const carry = hash === lastHash && current ? current.ctx.view : null;
    lastSignature = signature;
    lastHash = hash;
    const token = ++renderToken;
    exitCurrent();
    const { path, query } = parseHash(win.location.hash || DEFAULT_HASH);
    const matched = router.match(path);
    const route = findRoute(matched.route.path);
    const isDemo = route.guard === 'room' && matched.params.roomId === 'demo-preview';
    if (isDemo && (store.getState().runtime.queue || store.getState().runtime.room)) {
      win.location.replace('#/match');
      return;
    }
    if (isDemo && !demo) demo = createDemoRoom(store.getState(), { now: store.now });
    if (!isDemo) demo = null;
    const activeStore = isDemo ? demo.store : store;
    const state = activeStore.getState();
    const locale = state.locale;
    doc.documentElement?.setAttribute?.('lang', locale);
    const t = createTranslator(locale);
    const label = (group, value) => labelOf(group, value, locale);

    const redirect = guardRedirect(route, state, path, matched.params);
    if (redirect) {
      if (redirect.noticeKey) store.setNotice({ kind: 'banner', messageKey: redirect.noticeKey, tone: 'warning' });
      if (win.location.hash === '#' + redirect.to) {
        lastSignature = null;
        win.setTimeout?.(() => render(true), 0);
      } else {
        win.location.replace('#' + redirect.to);
      }
      return;
    }

    // 注册前路由不建号；其余页面一进来就补齐令牌（幂等，见 ensureAuth）。
    // 失败不打断渲染：真后端没起时页面自己会走离线兜底，不该白屏等人。
    if (!isDemo && !PRE_AUTH_ROUTES.has(route.path)) void ensureAuth().catch(() => {});

    // 进 onboarding 的任意一步都先立一个还原点：退出时整段作废（见 leaveOnboarding）。
    // 只在没有还原点时快照，所以从身份页一路走到隐私页不会被盖成中间状态。
    if (route.step) store.beginOnboarding();

    // 两个横幅槽分属两个主人：notice 归外壳（一次性运行时提示，只有用户点掉或下次操作才消失），
    // banner 归页面（「离线数据」「对方已离开」这类）。共用同一个槽会出事：页面 afterPaint
    // 里的 clearBanner 是「数据正常了就把横幅撤掉」，顺手就会把外壳的一次性提示一起抹掉。
    const noticeEl = h('div', { class: 'notice-slot' });
    const bannerEl = h('div', { class: 'banner-slot' });
    const queueEl = h('div', { class: 'queue-status-slot' });
    const pageEl = h('div', { class: 'page', attrs: { 'data-page': route.name } });
    const hasLoad = typeof route.page.load === 'function';
    const view = {
      data: carry ? carry.data ?? null : null,
      error: null,
      // 有旧数据就先用旧数据顶上，不摆骨架屏；load() 照跑，数据到了再静默换一次
      loading: hasLoad && !carry?.data,
    };
    // 页面自己攒的本地状态（面板开没开、草稿、选中项）跟着过来，改语言才不掉现场
    if (carry?.local) view.local = carry.local;

    const ctx = {
      el: pageEl,
      win,
      api: isDemo ? demo.api : api,
      store: activeStore,
      signalUrl: isDemo ? null : signalUrl,
      rooms: isDemo ? demo.rooms : rooms,
      t,
      label,
      locale,
      route,
      path,
      params: matched.params,
      query,
      view,
      getState: () => activeStore.getState(),
      demo: isDemo,
      allowSimulation: isDemo || allowSimulation,
      openDemoRoom: () => {
        if (store.getState().runtime.queue || store.getState().runtime.room) return;
        demo = createDemoRoom(store.getState(), { now: store.now });
        navigate('/room/demo-preview');
      },
      // 账号开关：注册页用它建号，其它页面（「我的」）用它退出并换人。
      // 页面**不直接碰 store.deviceId / http 令牌**——这两件事必须一起做才对，
      // 拆开做就会出现「换了账号但令牌还是旧的」这种半截状态。
      auth: {
        ensure: () => ensureAuth(),
        signOut: () => signOutAndReset(),
      },
      navigate,
      repaint: () => paint(),
      setBanner: (node) => mount(bannerEl, node),
      clearBanner: () => mount(bannerEl, null),
      watch: (handler) => {
        const unsubscribe = activeStore.subscribe(handler);
        current?.cleanups.push(unsubscribe);
        return unsubscribe;
      },
      onCleanup: (fn) => current?.cleanups.push(fn),
      reload: () => {
        view.loading = true;
        view.error = null;
        paint();
        loadPage(route, ctx, view, renderToken, paint);
      },
      paint: () => {},
    };

    // 运行时提示（例如「刷新后房间不在了」）用横幅显示一次
    const notice = state.runtime.notice;
    if (notice?.messageKey) {
      mount(noticeEl, FallbackBanner({
        tone: notice.tone ?? 'info',
        message: t(notice.messageKey),
        onDismiss: () => {
          store.setNotice(null);
          mount(noticeEl, null);
        },
      }));
      store.setNotice({ ...notice, messageKey: null, shown: true });
    }

    /**
     * 语言切换带来的那次重渲染会把上一份 view 整份带过来（见 render() 的 carry）。
     * 页面若在自己的 load() 里重建了 view.local（`ctx.view.local = { … }`），带过来的
     * 面板开合、草稿这些本地状态会跟着被丢掉——这里补回去。只在「页面确实换掉了那个
     * 对象」时补一次：之后页面自己的改动不会再被盖掉。
     */
    let carriedLocal = carry?.local ?? null;

    function paint() {
      if (carriedLocal && view.local !== carriedLocal) {
        view.local = { ...carriedLocal, ...view.local };
        carriedLocal = null;
      }
      view.t = t;
      const content = route.page.render(ctx, view);
      const demoSummary = isDemo && path.endsWith('/summary');
      mount(pageEl, isDemo ? h('section', { class: 'stack demo-room-layout' }, h('div', { class: 'demo-room-note', attrs: { role: 'note' } }, h('strong', { text: t(demoSummary ? 'demo.summaryTitle' : 'demo.roomTitle') }), h('p', { class: 'muted-note', text: t(demoSummary ? 'demo.summaryHint' : 'demo.roomHint') }), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => navigate('/match') }, t('demo.exit'))), content) : content);
      route.page.afterPaint?.(ctx, view, pageEl);
    }
    ctx.paint = paint;

    current = { page: route.page, ctx, cleanups: [] };

    const paintQueue = () => {
      const queued = store.getState().runtime.queue && !store.getState().runtime.room;
      mount(queueEl, queued && route.nav && route.path !== '/match'
        ? h('button', { class: 'queue-status-button', type: 'button', onClick: () => navigate('/match') }, t('match.backgroundStatus'))
        : null);
    };
    current.cleanups.push(store.subscribe(paintQueue));
    paintQueue();

    const shellChildren = [queueEl, pageEl];
    const stepNode = route.step ? StepProgress({ current: route.step, total: 3, label: t(route.stepKey ?? 'role.step') }) : null;

    // 跨路由的匹配弹窗插槽：每次渲染换一个新节点，换完要让控制器的缓存失效
    const toastSlot = h('div', { class: 'toast-slot' });
    matchRunner.slot = toastSlot;
    matchRunner.toastKey = null;

    if (route.nav && !bottomNav) bottomNav = BottomNav({ active: route.nav, t, onNavigate: navigate });

    mount(
      root,
      AppShell({
        notice: noticeEl,
        banner: bannerEl,
        topBar: topBarNode(route, ctx),
        nav: route.nav ? bottomNav : null,
        immersive: Boolean(route.immersive),
        children: stepNode ? [stepNode, pageEl] : shellChildren,
        toast: toastSlot,
      }),
    );
    if (route.nav) {
      // Keep the shared indicator and its previous position through page changes.
      bottomNav.getBoundingClientRect?.();
      bottomNav.updateNav({ active: route.nav, t });
    }

    syncMatchToast();
    paint();

    // 带过来的只是「先顶上」的旧数据：接口照拉，拿到了再静默重绘一次
    if (hasLoad) {
      loadPage(route, ctx, view, token, paint);
    }
  }

  async function loadPage(route, ctx, view, token, paint) {
    try {
      view.data = await route.page.load(ctx);
      view.error = null;
    } catch (error) {
      view.error = error;
      view.data = null;
    }
    if (token !== renderToken) return;
    view.loading = false;
    paint();
  }


  /**
   * 记录上一次渲染用的界面语言；store 的其它变更由各页面自己 watch，
   * 这里只负责「界面语言变了就重渲染」。注意不能用 start.xxx 存状态：
   * 对象字面量的方法简写不会把方法名绑定成局部变量。
   *
   * 主题（「我的」页的配色主题卡）也不在这里触发重渲染：换配色只改 CSS 变量，
   * 重建页面反而会让当前页重新取数、闪一下骨架屏。所以主题变化只同步 <html data-theme>，
   * DOM 一棵不动。
   */
  let startLastKey = null;

  function start() {
    win.addEventListener('hashchange', () => render());
    if (!win.location.hash) win.location.hash = DEFAULT_HASH;
    applyTheme(store.getState().settings.theme);
    store.subscribe((state) => {
      applyTheme(state.settings.theme);
      if (state.locale !== startLastKey) {
        startLastKey = state.locale;
        render();
      }
    });
    // 排队与匹配请求一有变化就同步后台定时器与弹窗（与页面生命周期无关）
    store.subscribe(() => syncMatchRunner());
    startLastKey = store.getState().locale;
    // 启动引导交给 render()：它按当前路由决定要不要建号（见 PRE_AUTH_ROUTES），
    // 所以这里不再单独 ensure 一次——两条路都走会让人分不清账号是谁建的。
    render();
    syncMatchRunner();
    // 换身份＝换令牌：登录成功之后再对齐关系表、并把匹配频道按新令牌重连一次
    // （socialSync.attach 会被这里的 onReady 取代）
    session.attach({
      // 注册前不登录：落地页 / 注册页上身份怎么变都不该建号（见 authEnabled）
      enabled: () => authEnabled,
      onReady: () => {
        matchSync.restart();
        void socialSync.sync();
      },
    });
  }

  return {
    router,
    navigate,
    render,
    rooms,
    // 匹配频道的句柄：排障（`isConnected()`）与测试（注入假 socket 后断言推送落地）用
    matchSync,
    start,
    renderLoading(message) {
      mount(root, h('div', { class: 'app-frame' }, h('p', { class: 'muted-note', text: message }), h(LoadingSkeleton, { rows: 4 })));
    },
  };
}

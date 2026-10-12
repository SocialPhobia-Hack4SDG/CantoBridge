/**
 * Demo 控制台（路由 /dev/mock）：现场救场用。
 * 身份、延迟、话题卡难度、通话模式、自动匹配都能一键改，全部即时生效且不需要刷新。
 */

import { definePage } from '../app/page.js';
import { ErrorState } from '../components/base.js';
import { MockControlPanel } from '../components/progress.js';
import { LEVELS } from '../data/tags.js';
import { THEMES, normalizeTheme, themeLabelKey } from '../data/themes.js';
import { h } from '../lib/dom.js';
import { buddyRelation } from '../lib/logic.js';

const DELAYS = [0, 400, 1500, 3000];
/** 匹配成功后「接受 / 不接受」弹窗的倒计时上限档位（秒）。 */
const ACCEPT_SECONDS = [5, 10, 15, 20];
const MODES = ['sim', 'local', 'remote'];
/** 现场「模拟对方发来伙伴申请」时依次用掉的虚拟名字，避免和已有关系打架。 */
const REQUEST_SENDERS = ['siu-fung', 'mei-lin', 'chun-hei'];

export const MockConsolePage = definePage({
  name: 'MockConsolePage',
  titleKey: 'dev.title',

  async load(ctx) {
    if (ctx.win.__CANTOBRIDGE_DEV__ === false) return { disabled: true };
    ctx.watch(() => ctx.paint());
    let waiting = 0;
    try {
      const list = await ctx.api.listWaitingLearners();
      waiting = list.length;
    } catch {
      waiting = 0;
    }
    return { waiting, disabled: false };
  },

  render(ctx, view) {
    const t = ctx.t;
    if (view.data?.disabled) {
      return h(ErrorState, { message: t('dev.onlyDev'), retryLabel: t('action.back'), onRetry: () => ctx.navigate('/') });
    }
    const state = ctx.getState();
    const settings = state.settings;
    const groups = [
      {
        label: t('dev.role'),
        onChange: (value) => {
          ctx.store.setRole(value);
          ctx.reload();
        },
        options: [
          { value: 'learner', label: t('role.learnerSubtitle'), selected: state.role === 'learner' },
          { value: 'buddy', label: t('role.buddySubtitle'), selected: state.role === 'buddy' },
        ],
      },
      {
        label: t('dev.delay'),
        onChange: (value) => {
          ctx.store.saveSettings({ mockDelayMs: Number(value) });
          ctx.paint();
        },
        options: DELAYS.map((value) => ({
          value,
          label: value === 0 ? '0s' : value / 1000 + 's',
          selected: Number(settings.mockDelayMs) === value,
        })),
      },
      {
        label: t('dev.level'),
        onChange: (value) => {
          ctx.store.saveSettings({ cardLevelOverride: value === '' ? null : value });
          ctx.paint();
        },
        options: [{ value: '', label: t('dev.autoLevel'), selected: !settings.cardLevelOverride }].concat(
          LEVELS.map((value) => ({ value, label: ctx.label('levels', value), selected: settings.cardLevelOverride === value })),
        ),
      },
      {
        label: t('dev.signal'),
        onChange: (value) => {
          ctx.store.saveSettings({ signalMode: value });
          ctx.paint();
        },
        options: MODES.map((value) => ({
          value,
          label: t('dev.mode.' + value),
          selected: settings.signalMode === value,
        })),
      },
      {
        label: t('dev.autoMatch'),
        onChange: (value) => {
          ctx.store.saveSettings({ autoMatch: value === 'on' });
          ctx.paint();
        },
        options: [
          { value: 'on', label: t('dev.on'), selected: Boolean(settings.autoMatch) },
          { value: 'off', label: t('dev.off'), selected: !settings.autoMatch },
        ],
      },
      {
        label: t('dev.backgroundMatch'),
        onChange: (value) => {
          ctx.store.saveSettings({ backgroundMatch: value === 'on' });
          ctx.paint();
        },
        options: [
          { value: 'on', label: t('dev.on'), selected: settings.backgroundMatch !== false },
          { value: 'off', label: t('dev.off'), selected: settings.backgroundMatch === false },
        ],
      },
      {
        label: t('theme.title'),
        onChange: (value) => {
          ctx.store.setTheme(value);
          ctx.paint();
        },
        options: THEMES.map((value) => ({
          value,
          label: t(themeLabelKey(value)),
          selected: normalizeTheme(settings.theme) === value,
        })),
      },
      {
        label: t('dev.acceptSeconds'),
        onChange: (value) => {
          ctx.store.saveSettings({ matchAcceptSeconds: Number(value) });
          ctx.paint();
        },
        options: ACCEPT_SECONDS.map((value) => ({
          value,
          label: value + 's',
          selected: Number(settings.matchAcceptSeconds) === value,
        })),
      },
    ];

    const summary = [
      t('dev.active') + ':',
      t('dev.role') + ' ' + t(state.role === 'buddy' ? 'role.buddySubtitle' : 'role.learnerSubtitle'),
      t('dev.delay') + ' ' + settings.mockDelayMs + 'ms',
      t('dev.signal') + ' ' + t('dev.mode.' + settings.signalMode),
      t('dev.autoMatch') + ' ' + (settings.autoMatch ? t('dev.on') : t('dev.off')),
      t('dev.backgroundMatch') + ' ' + (settings.backgroundMatch === false ? t('dev.off') : t('dev.on')),
      t('dev.acceptSeconds') + ' ' + (Number(settings.matchAcceptSeconds) || 10) + 's',
      t('theme.title') + ' ' + t(themeLabelKey(settings.theme)),
      t('dev.waitingCount', { count: view.data?.waiting ?? 0 }),
    ].join(' · ');

    return h(
      'section',
      { class: 'stack' },
      h('h1', { class: 'page-title', text: t('dev.title') }),
      h('p', { class: 'muted-note', text: t('dev.hint') }),
      h(MockControlPanel, {
        summary,
        groups,
        actions: [
          // 模拟一次「服务端 match:matched」：产出一条待接受请求，右上角弹出倒计时弹窗
          { label: t('dev.forceMatch'), onClick: () => void ctx.api.requestMatch({ reason: 'dev' }) },
          // 伙伴关系是双向的，现场只有一个人：这两个按钮分别替代「对方的两次点击」。
          {
            label: t('dev.receiveRequest'),
            onClick: () => {
              const sender =
                REQUEST_SENDERS.find((name) => buddyRelation(name, state.social).state === 'none') ??
                REQUEST_SENDERS[0];
              void ctx.api.receiveBuddyRequest(sender, sender).then(() => ctx.reload());
            },
          },
          {
            label: t('dev.acceptMyRequest'),
            onClick: () => {
              const outgoing = (state.social.buddyRequests ?? []).find((item) => item.direction === 'outgoing');
              if (outgoing) void ctx.api.acceptBuddyRequest(outgoing.peerId).then(() => ctx.reload());
            },
          },
          { label: t('match.refresh'), onClick: () => ctx.reload() },
        ],
        links: [
          { label: t('nav.home'), to: '/home' },
          { label: t('nav.match'), to: '/match' },
          { label: t('me.title'), to: '/me' },
          { label: t('leaderboard.title'), to: '/leaderboard' },
          { label: t('history.title'), to: '/history' },
          { label: t('role.title'), to: '/onboarding/role' },
          { label: t('setup.title'), to: '/onboarding/profile' },
          { label: t('privacy.title'), to: '/onboarding/privacy' },
          { label: t('demo.enter'), to: '/room/demo-preview' },
          { label: t('app.name'), to: '/' },
        ],
        onJump: (to) => ctx.navigate(to),
        onReset: () => {
          ctx.store.resetDemoData();
          ctx.reload();
        },
        t,
      }),
    );
  },
});

/**
 * 个人主页（ProfilePage）：看见自己的积累、管理隐私与身份，并集中管理「我的伙伴」。
 * 排行榜见 pages/leaderboard.js，连线记录见 pages/history.js。
 */

import { AvatarPicker, PresetAvatar } from '../components/avatars.js';
import { definePage } from '../app/page.js';
import { ErrorState, FallbackBanner, LoadingSkeleton, ThemeSwitch } from '../components/base.js';
import { StatTile } from '../components/home.js';
import { TagPicker } from '../components/onboarding.js';
import { AchievementWall, BuddyRequestList } from '../components/progress.js';
import { ACHIEVEMENT_CATALOG } from '../data/achievements.js';
import { NATIVE_LANGUAGES } from '../data/tags.js';
import { normalizeTheme } from '../data/themes.js';
import { LOCALES } from '../i18n/i18n.js';
import { h, icon } from '../lib/dom.js';
import { uniqueList } from '../lib/logic.js';
import { achievementStates, homeTiles, resolveTile } from '../lib/viewModel.js';

/** 伙伴关系动作统一走这里：先调接口，再整页重取，保证三个分组与统计一起刷新。 */
async function runBuddyAction(ctx, view, method, peerId) {
  if (view.local?.busyPeerId) return;
  view.local.busyPeerId = peerId;
  view.local.actionError = false;
  ctx.paint();
  try {
    await ctx.api[method](peerId);
  } catch {
    view.local.busyPeerId = null;
    view.local.actionError = true;
    ctx.paint();
    return;
  }
  ctx.reload();
}
export const ProfilePage = definePage({
  name: 'ProfilePage',
  titleKey: 'me.title',

  async load(ctx) {
    const [progress, history, me, buddies, requests] = await Promise.all([
      ctx.api.getProgress(),
      ctx.api.getHistory(),
      ctx.api.getMe(),
      ctx.api.listBuddies(),
      ctx.api.listBuddyRequests(),
      ctx.api.getShop().catch(() => null),
    ]);
    ctx.view.local = { editing: false };
    ctx.onCleanup?.(() => {
      if (ctx.view.local?.achievementScrollLocked && document.body?.style) {
        document.body.style.overflow = ctx.view.local.achievementOriginalOverflow ?? '';
      }
    });
    ctx.watch(() => ctx.paint());
    return { progress, history, me, buddies, requests };
  },

  render(ctx, view) {
    const t = ctx.t;
    const state = ctx.getState();
    const role = state.role;
    const progress = view.data?.progress ?? {};
    const profile = role === 'buddy' ? state.buddyProfile : state.learnerProfile;
    const displayName = profile.displayName?.trim() || profile.userId || '';
    const roleLabel = t(role === 'buddy' ? 'me.buddyRole' : 'me.learnerRole');
    const stats = achievementStates(ACHIEVEMENT_CATALOG, role, progress);
    const unlocked = stats.filter((item) => item.unlocked).length;
    const tiles = homeTiles({ role, stats: progress, progress, achievementCount: unlocked });
    // 切换目标与「要不要先补资料」在这里算一次：按钮文案、副提示、点击行为都用同一份判断
    const nextRole = role === 'buddy' ? 'learner' : 'buddy';
    const nextProfile = nextRole === 'buddy' ? state.buddyProfile : state.learnerProfile;
    const needsSwitchSetup = nextProfile?.onboarded !== true;
    // 「退出并换人」的二次确认只活在这一页（load 里预置的是 { editing: false }，缺哪项补哪项）
    const local = (ctx.view.local ??= {});
    if (typeof local.confirming !== 'boolean') local.confirming = false;
    const closeAppearance = () => {
      if (local.appearancePending) return;
      local.appearanceDraft = null; local.appearanceError = false; ctx.paint();
      queueMicrotask(() => ctx.el.querySelector('.profile-avatar-button')?.focus?.());
    };
    const saveAppearance = async () => {
      if (local.appearancePending || !local.appearanceDraft) return;
      local.appearancePending = true; local.appearanceError = false; ctx.paint();
      try {
        await ctx.api[role === 'buddy' ? 'saveBuddyProfile' : 'saveLearnerProfile']({ avatarId: local.appearanceDraft.avatarId, frameId: local.appearanceDraft.frameId });
        local.appearanceDraft = null;
      } catch { local.appearanceError = true; }
      finally { local.appearancePending = false; ctx.paint(); }
    };
    if (!local.achievementsExpanded && local.achievementScrollLocked && document.body?.style) {
      document.body.style.overflow = local.achievementOriginalOverflow ?? '';
      local.achievementScrollLocked = false;
    }
    const equippedTitleId = progress.equippedTitleId ?? state.settings.equippedTitleId ?? null;
    const achievementItems = stats.map(item => {
      const metric = progress.achievementStats?.[item.id];
      return {
        ...item, name: ctx.label('achievements', item.id),
        hint: t('achievement.hint.' + item.id.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())),
        statistics: metric ? t('achievement.statistics', { count: metric.count, percentage: Number(metric.percentage).toFixed(2) }) : t('achievement.statsUnavailable'),
        equipped: equippedTitleId === item.id, busy: local.titlePending,
        statusLabel: !item.unlocked ? t('achievement.locked') : equippedTitleId === item.id ? t('achievement.removeTitle') : t('achievement.equipTitle'),
      };
    });
    const selectTitle = async item => {
      if (!item.unlocked || local.titlePending) return;
      local.titlePending = true; local.titleError = false; ctx.paint();
      try {
        const id = equippedTitleId === item.id ? null : item.id;
        await ctx.api.saveSettings({ equippedTitleId: id });
        view.data.progress = await ctx.api.getProgress();
      } catch { local.titleError = true; }
      finally { local.titlePending = false; ctx.paint(); }
    };
    const wall = items => h(AchievementWall, { items, labels: { empty: t('achievement.empty'), new: t('achievement.new') }, onSelect: item => void selectTitle(item) });
    const titleNotes = () => [
      h('p', { class: 'muted-note', text: t('achievement.titleHint') }),
      h('p', { class: 'achievement-stats-note', text: t('achievement.statsHint') }),
      local.titleError ? h('p', { attrs: { role: 'alert' }, text: t('state.failed') }) : null,
    ];
    if (local.achievementsExpanded) {
      if (!local.achievementScrollLocked && document.body?.style) {
        local.achievementOriginalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        local.achievementScrollLocked = true;
      }
      const close = () => { local.achievementsExpanded = false; ctx.paint(); queueMicrotask(() => document.querySelector?.('.achievement-expand')?.focus?.()); };
      const panel = h('section', { class: 'achievement-fullscreen', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('me.achievements') }, onKeydown: event => {
        if (event.key === 'Escape') close();
        if (event.key === 'Tab') {
          const buttons = [...panel.querySelectorAll('button')].filter(button => !button.disabled);
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus?.(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus?.(); }
        }
      } },
        h('div', { class: 'achievement-fullscreen-head' }, h('h2', { text: t('me.achievements') }),
          h('button', { class: 'btn btn-secondary achievement-close', type: 'button', onClick: close }, t('achievement.close'))),
        titleNotes(), wall(achievementItems));
      queueMicrotask(() => panel.querySelector('.achievement-close')?.focus?.());
      return panel;
    }

    return h(
      'section',
      { class: 'stack' },
      h(
        'div',
        { class: 'card profile-head' },
        h('button', { class: 'profile-avatar-button', type: 'button', attrs: { 'aria-label': t('me.editAppearance'), 'aria-expanded': String(Boolean(local.appearanceDraft)) }, onClick: () => {
          if (local.appearanceDraft) { closeAppearance(); return; }
          local.appearanceDraft = { avatarId: profile.avatarId ?? 'neutral', frameId: profile.frameId ?? 'none' };
          local.appearanceError = false; ctx.paint();
        } }, h(PresetAvatar, { avatarId: profile.avatarId, frameId: profile.frameId, size: 64, label: displayName }), h('span', { class: 'avatar-edit-dot', attrs: { 'aria-hidden': 'true' }, text: '✎' })),
        h('div', { class: 'profile-identity' }, h('strong', { class: 'profile-name', text: displayName }), h('small', { class: 'muted-note profile-subtitle', text: roleLabel }), equippedTitleId ? h('span', { class: 'achievement-title', text: ctx.label('achievements', equippedTitleId) }) : null),
        h('span', { class: 'pill tone-accent-soft profile-role' }, h('span', { text: t('me.currentRole') + ' · ' }), h('span', { text: roleLabel })),
        h('button', { class: 'link-btn profile-edit-button', type: 'button', onClick: () => ctx.navigate('/onboarding/profile') }, t('me.editProfile')),
      ),
      local.appearanceDraft ? h('section', { class: 'card appearance-editor', attrs: { role: 'region', 'aria-label': t('me.editAppearance') }, onKeydown: event => { if (event.key === 'Escape') closeAppearance(); } },
        h('h3', { class: 'card-title', text: t('me.editAppearance') }),
        h(PresetAvatar, { ...local.appearanceDraft, size: 96, label: displayName }),
        h('p', { class: 'muted-note', text: t('me.appearanceHint') }),
        h('fieldset', { disabled: Boolean(local.appearancePending), class: 'appearance-options' },
          h('legend', { text: t('avatar.choose') }),
          h(AvatarPicker, { value: local.appearanceDraft.avatarId, wallet: state.progress.wallet, t, onChange: avatarId => { if (local.appearancePending) return; local.appearanceDraft.avatarId = avatarId; ctx.paint(); } })),
        h('fieldset', { disabled: Boolean(local.appearancePending), class: 'appearance-options' },
          h('legend', { text: t('frame.choose') }),
          h(AvatarPicker, { kind: 'frame', avatarId: local.appearanceDraft.avatarId, value: local.appearanceDraft.frameId, wallet: state.progress.wallet, t, onChange: frameId => { if (local.appearancePending) return; local.appearanceDraft.frameId = frameId; ctx.paint(); } })),
        local.appearanceError ? h('p', { class: 'is-warn', attrs: { role: 'alert' }, text: t('me.appearanceFailed') }) : null,
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', disabled: Boolean(local.appearancePending), attrs: { 'aria-busy': String(Boolean(local.appearancePending)) }, onClick: () => void saveAppearance() }, t(local.appearancePending ? 'state.loading' : 'action.save')),
          h('button', { class: 'btn btn-quiet', type: 'button', disabled: Boolean(local.appearancePending), onClick: closeAppearance }, t('action.cancel')))) : null,
      h('button', { class: 'card profile-shop-entry', type: 'button', onClick: () => ctx.navigate('/shop') },
        h('span', { class: 'profile-shop-symbol', attrs: { 'aria-hidden': 'true' }, text: '✦' }),
        h('span', { class: 'profile-shop-copy' }, h('strong', { text: t('shop.title') }), h('small', { text: t('shop.entryHint') })),
        h('span', { class: 'profile-shop-arrow', attrs: { 'aria-hidden': 'true' }, text: '→' })),
      // 母语者的「回礼」：可选、随时能改，放在身份卡正下方——它说的就是「我这个身份还想拿到什么」。
      // 只改排序权重（matchRank），不筛选：清空了一样能匹配，只是排位回到纯匹配度。
      // 学习者视角不显示：学习者的「想练」恒为粤语，那是身份自带的，不是一道题。
      role === 'buddy'
        ? h(
            'div',
            { class: 'card want-to-learn-card' },
            h('h3', { class: 'card-title', text: t('me.wantToLearn') }),
            h('p', { class: 'muted-note', text: t('setup.wantToLearnHint') }),
            h(TagPicker, {
              tags: NATIVE_LANGUAGES.map((value) => ({ value, label: ctx.label('nativeLanguages', value) })),
              value: uniqueList(profile.wantToLearn),
              max: NATIVE_LANGUAGES.length,
              onChange: (next) => {
                // 回礼是母语者资料的一部分：只改本地的话服务端不知道，语言互补排序不生效
                ctx.store.saveRoleProfile('buddy', { wantToLearn: next });
                ctx.paint();
                void ctx.api
                  .saveBuddyProfile({ wantToLearn: next })
                  .then(() => ctx.paint())
                  .catch(() => ctx.store.setNotice({ kind: 'banner', messageKey: 'state.offlineData', tone: 'warning' }));
              },
            }),
          )
        : null,
      view.error
        ? h(ErrorState, { message: t('state.failed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() })
        : view.loading
          ? h(LoadingSkeleton, { variant: 'grid', rows: 4 })
          : h(
              'div',
              { class: 'tile-grid' },
              tiles.map((tile) => {
                const resolved = resolveTile(tile, { t, labelOf: ctx.label });
                return h(StatTile, { label: resolved.label, value: resolved.value });
              }),
            ),
      h(
        'div',
        { class: 'card' },
        h('h3', { class: 'card-title', text: t('me.achievements') }),
        titleNotes(),
        wall(achievementItems.slice(0, 4)),
        h('button', { class: 'btn btn-secondary btn-block achievement-expand', type: 'button', onClick: () => { local.achievementsExpanded = true; ctx.paint(); } }, t('achievement.expand')),
      ),
      h(
        'div',
        { class: 'card buddy-slot-card' },
        h('h3', { class: 'card-title', text: t('buddy.slot') }),
        local.actionError ? h(FallbackBanner, { tone: 'warning', message: t('state.offlineData') }) : null,
        view.error
          ? h(ErrorState, { message: t('state.failed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() })
          : view.loading
          ? h(LoadingSkeleton, { variant: 'list', rows: 2 })
          : h('div', { class: 'buddy-scroll' },
              h(BuddyRequestList, {
                buddies: view.data?.buddies ?? [],
                requests: view.data?.requests ?? [],
                labels: {
                  incoming: t('buddy.received'),
                  outgoing: t('buddy.sent'),
                  connected: t('buddy.connected'),
                  connectedHint: t('buddy.connectedHint'),
                  pendingIn: t('buddy.pendingIn'),
                  pendingOut: t('buddy.pendingOut'),
                  accept: t('buddy.accept'),
                  decline: t('buddy.decline'),
                  cancel: t('buddy.cancel'),
                  remove: t('buddy.remove'),
                  empty: t('buddy.empty'),
                },
                onAccept: (peerId) => void runBuddyAction(ctx, view, 'acceptBuddyRequest', peerId),
                onDecline: (peerId) => void runBuddyAction(ctx, view, 'declineBuddyRequest', peerId),
                onCancel: (peerId) => void runBuddyAction(ctx, view, 'cancelBuddyRequest', peerId),
                onRemove: (peerId) => void runBuddyAction(ctx, view, 'removeBuddy', peerId),
                busyPeerId: local.busyPeerId ?? null,
              })),
      ),
      h('button', { class: 'row-item', type: 'button', onClick: () => ctx.navigate('/history') }, h('span', { text: t('me.history') }), icon('next', { size: 16 })),
      h('details', { class: 'profile-settings card', open: local.settingsOpen ? true : undefined, onToggle: event => { local.settingsOpen = event.target.open; } },
      h('summary', { class: 'profile-settings-heading' }, h('h2', { class: 'section-title', text: t('me.settings') })),
      h('div', { class: 'card language-card' },
        h('h3', { class: 'card-title', text: t('me.language') }),
        h('div', { class: 'lang-switch', attrs: { role: 'group', 'aria-label': t('me.language') } },
          LOCALES.map((locale) => h('button', {
            type: 'button',
            class: ['pill', locale === state.locale ? 'tone-accent is-selected' : 'tone-neutral'],
            attrs: { 'aria-pressed': locale === state.locale ? 'true' : 'false' },
            onClick: () => {
              if (locale === state.locale) return;
              ctx.store.setLocale(locale);
              ctx.paint();
              void ctx.api.saveSettings({ locale }).catch(() => {
                ctx.store.setNotice({ kind: 'banner', messageKey: 'state.offlineData', tone: 'warning' });
              });
            },
          }, { 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', en: 'English' }[locale])))),
      h(
        'div',
        { class: 'card privacy-row' },
        h(
          'div',
          {},
          h('span', { class: 'privacy-label', text: t('privacy.anonymous') }),
          h('small', { class: 'muted-note', text: t('privacy.anonymousHint') }),
        ),
        h(
          'button',
          {
            class: ['switch', state.settings.anonymous ? 'is-on' : ''],
            type: 'button',
            role: 'switch',
            attrs: { 'aria-checked': state.settings.anonymous ? 'true' : 'false' },
            onClick: () => {
              // 匿名是「服务端同步」的设置项：服务端据此裁剪身份字段，必须送上去
              const next = !state.settings.anonymous;
              ctx.store.saveSettings({ anonymous: next });
              ctx.paint();
              void ctx.api
                .saveSettings({ anonymous: next })
                .then(() => ctx.paint())
                .catch(() => ctx.store.setNotice({ kind: 'banner', messageKey: 'state.offlineData', tone: 'warning' }));
            },
          },
          h('span', { class: 'switch-knob' }),
        ),
      ),
      h(
        'div',
        { class: 'card theme-card' },
        h('h3', { class: 'card-title', text: t('theme.title') }),
        h('p', { class: 'muted-note', text: t('theme.hint') }),
        h(ThemeSwitch, {
          owned: ['mint', 'warm', ...(state.progress.wallet?.ownedThemes ?? [])],
          value: normalizeTheme(state.settings.theme),
          onChange: (theme) => {
            ctx.store.setTheme(theme);
            ctx.paint();
          },
          t,
        }),
      ),
      h(
        'div',
        { class: 'list-block' },
        [
          { label: t('me.privacy'), to: '/onboarding/privacy' },
        ].map((item) =>
          h(
            'button',
            { class: 'row-item', type: 'button', onClick: () => ctx.navigate(item.to) },
            h('span', { text: item.label }),
            icon('next', { size: 16 }),
          ),
        ),
      ),
      ),
      h(
        'button',
        {
          class: 'btn btn-secondary btn-block',
          type: 'button',
          onClick: () => {
            if (!needsSwitchSetup) {
              ctx.store.setRole(nextRole);
              ctx.paint();
              return;
            }
            // 第一次切到这个身份：点「切换」＝ onboarding 的第 1 项（身份）已经选好，
            // 直接进第 2 项（资料与标签）现场填，不要等用户点「匹配」被守卫弹回来。
            // 先立还原点再改 role——中途按「退出」要能回到切换前的账号配置。
            ctx.store.beginOnboarding();
            ctx.store.setRole(nextRole);
            ctx.navigate('/onboarding/profile');
          },
        },
        t('me.switchTo') + ' ' + t(nextRole === 'buddy' ? 'role.buddySubtitle' : 'role.learnerSubtitle'),
      ),
      needsSwitchSetup ? h('p', { class: 'muted-note', text: t('me.switchNeedsSetup') }) : null,
      h('details', { class: 'profile-account card', open: local.accountOpen ? true : undefined, onToggle: event => { local.accountOpen = event.target.open; } },
      h('summary', { class: 'profile-settings-heading' }, h('h2', { class: 'section-title', text: t('account.title') })),
      h(
        'div',
        { class: 'card field' },
        h('small', { class: 'muted-note', text: t('account.hint') }),
        // 二次确认做在行内而不是弹层：这里只有一个动作，为它新造一个弹层组件不划算
        // （组件清单是 docs/05 的可执行契约，多一个就要两边一起改）。
        local.confirming
          ? h(
              'div',
              { class: 'field' },
              h('small', { class: 'muted-note is-warn', text: t('account.signOutHint') }),
              h(
                'button',
                { class: 'btn btn-danger btn-block', type: 'button', onClick: () => void ctx.auth.signOut() },
                t('account.confirmYes'),
              ),
              h(
                'button',
                {
                  class: 'btn btn-quiet btn-block',
                  type: 'button',
                  onClick: () => {
                    local.confirming = false;
                    ctx.paint();
                  },
                },
                t('action.cancel'),
              ),
            )
          : h(
              'button',
              {
                class: 'btn btn-quiet btn-block',
                type: 'button',
                onClick: () => {
                  local.confirming = true;
                  ctx.paint();
                },
              },
              t('account.signOut'),
            ),
      ),
      ),
    );
  },
});

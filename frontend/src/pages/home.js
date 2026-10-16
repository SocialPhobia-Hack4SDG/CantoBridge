/**
 * 首页：按当前身份给唯一主 CTA，配轻量统计与最近记录。
 * 失败时用本地缓存值照常渲染，并挂 FallbackBanner 标注「离线数据」。
 *
 * 学习者视角额外有一块「推荐伙伴」（C，2026-09-29）：不用先去匹配页排队等人来挑，
 * 首页直接列 top 3 候选，点「直接聊」一键成房。这一块**独立三态**——它取不到数据时
 * 只收成一行提示，绝不能把首页的其它模块一起拖进失败态。
 */

import { definePage } from '../app/page.js';
import { BottomNav, ErrorState, FallbackBanner, LoadingSkeleton } from '../components/base.js';
import { HomeActionCard, StatTile } from '../components/home.js';
import { BuddyCard } from '../components/match.js';
import { h } from '../lib/dom.js';
import { formatDuration } from '../lib/logic.js';
import { achievementStates, complementProps } from '../lib/viewModel.js';
import { ACHIEVEMENT_CATALOG } from '../data/achievements.js';
import { homeTiles, homePrimaryAction, resolveTile } from '../lib/viewModel.js';

/**
 * 「推荐伙伴」（C）：学习者视角的 top 3，每张卡一个「直接聊」。
 * 三态各自独立：加载中给 3 行卡骨架；空与失败都收成一行提示 + 一个去 `/match` 的按钮。
 * 排序与互补徽标的口径全在服务层与 `complementView` 里，这里只负责画。
 */
function recommendBlock(ctx, view) {
  const t = ctx.t;
  const data = view.data ?? {};
  const items = data.recommended ?? [];

  if (view.loading) {
    return h(
      'div',
      { class: 'card recommend-block' },
      h('h3', { class: 'card-title', text: t('home.recommendTitle') }),
      h(LoadingSkeleton, { variant: 'list', rows: 3 }),
    );
  }

  if (data.recommendFailed) {
    return h('div', { class: 'recommend-block is-empty' }, h('p', { class: 'muted-note', text: t('home.recommendFailed') }));
  }
  if (items.length === 0) {
    return h('div', { class: 'recommend-block is-empty' }, h('p', { class: 'muted-note', text: t('home.recommendEmpty') }));
  }

  return h(
    'div',
    { class: 'card recommend-block' },
    h('h3', { class: 'card-title', text: t('home.recommendTitle') }),
    h('p', { class: 'muted-note', text: t('home.recommendHint') }),
    h(
      'div',
      { class: 'recommend-list' },
      items.slice(0, 3).map((peer) =>
        h(BuddyCard, { anonymousLabel: t('anonymous.label'), locale: ctx.locale,
          peer,
          matchLabel: peer.matchScore ? peer.matchScore + '% ' + t('match.matchLabel') : null,
          tags: (peer.interests ?? []).slice(0, 3).map((value) => ctx.label('interests', value)),
          matchedTags: (peer.matchedTags ?? []).map((value) => ctx.label('interests', value)),
          ...complementProps(peer, { t, label: ctx.label, noteKey: 'home.complementWants' }),
          ctaLabel: t('home.chatNow'),
          disabled: Boolean(view.local?.startingPeerId),
          busy: view.local?.startingPeerId === peer.peerId,
          onPick: () => void startRoomWith(ctx, peer),
        }),
      ),
    ),
    h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => ctx.navigate('/match') }, t('home.recommendAll')),
  );
}

/**
 * 「直接聊」= 一键成房并进房。**不经过资料预览页**：`/match/:learnerId` 的守卫只放粤语母语者进来，
 * 而学习者需要的信息（匹配度 / 共同兴趣 / 互补徽标）已经全在卡片上；人点按钮就是最终确认。
 * 房间被别人先摘走（409 `room_taken`）时给一条横幅并重取推荐——列表里那一位会立刻消失。
 */
async function startRoomWith(ctx, peer) {
  const local = (ctx.view.local ??= {});
  if (local.startingPeerId) return;
  local.startingPeerId = peer.peerId; ctx.paint();
  try {
    const room = await ctx.api.createRoomWithBuddy(peer.peerId);
    ctx.navigate('/room/' + room.roomId);
  } catch (error) {
    local.startingPeerId = null;
    ctx.store.setNotice({
      kind: 'banner',
      messageKey: error?.code === 'room_taken' ? 'preview.taken' : 'home.recommendFailed',
      tone: 'warning',
    });
    ctx.reload();
  }
}

export const HomePage = definePage({
  name: 'HomePage',
  titleKey: 'app.name',

  async load(ctx) {
    ctx.view.local = {};
    const role = ctx.getState().role;
    ctx.view.role = role;
    // 身份切换后首页必须换视角，这里订阅一次即可（cleanup 交给 app.js）
    ctx.watch(() => {
      if (ctx.getState().role !== ctx.view.role) ctx.reload();
    });
    const [progress, history] = await Promise.all([ctx.api.getProgress(), ctx.api.getHistory()]);
    const waiting = role === 'buddy' ? await ctx.api.listWaitingLearners() : [];
    // C：学习者视角直接推候选。这里单独 try/catch——推荐取不到不该让整页落到失败态，
    // 首页的统计、最近记录、主 CTA 都还能用（docs/03 第 5.13 节的三态要求）。
    let recommended = [];
    let recommendFailed = false;
    if (role === 'learner') {
      try {
        recommended = await ctx.api.listRecommendedBuddies();
      } catch (error) {
        recommendFailed = true;
      }
    }
    return { progress, history, waitingCount: waiting.length, recommended, recommendFailed };
  },

  render(ctx, view) {
    const t = ctx.t;
    const state = ctx.getState();
    const role = state.role;
    const progress = view.data?.progress ?? {};
    const history = view.data?.history ?? [];
    const tiles = homeTiles({
      role,
      stats: progress,
      progress: progress,
      achievementCount: achievementStates(ACHIEVEMENT_CATALOG, role, progress).filter((item) => item.unlocked).length,
    });
    const action = homePrimaryAction({ role, waitingCount: view.data?.waitingCount ?? 0 });
    const hasActivity = Number(progress.conversations) > 0 || Number(progress.totalMinutes) > 0 || history.length > 0;

    return h(
      'section',
      { class: 'stack' },
      h('p', { class: 'muted-note', text: t('app.slogan') }),
      h(HomeActionCard, {
        role,
        headline: t(action.headlineKey),
        ctaLabel: t(action.ctaKey),
        badge: action.badge ? t(action.badge.key, action.badge.vars) : null,
        onStart: () => ctx.navigate(action.to),
      }),
      role === 'learner' ? h('button', { class: 'btn btn-secondary btn-block ai-tutor-entry', type: 'button', onClick: () => ctx.navigate('/tutor') }, t('tutor.entry')) : null,
      role === 'learner' ? recommendBlock(ctx, view) : null,
      view.error
        ? h(ErrorState, { message: t('state.failed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() })
        : view.loading
          ? h(LoadingSkeleton, { variant: 'grid', rows: 4 })
          : !hasActivity
            ? h('div', { class: 'card first-chat-note' }, h('h3', { class: 'card-title', text: t('home.firstChatTitle') }), h('p', { class: 'muted-note', text: t('home.firstChatHint') }))
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
        h('h3', { class: 'card-title', text: t('home.recent') }),
        history.length === 0
          ? h('p', { class: 'muted-note', text: t('home.recentEmpty') })
          : h(
              'ul',
              { class: 'recent-list' },
              history.slice(0, 3).map((entry) =>
                h(
                  'li',
                  { class: 'recent-item' },
                  h('span', { class: 'recent-name', text: entry.peerLabel ?? entry.peerId }),
                  h('small', { class: 'muted-note', text: t(formatDuration(entry.durationSec).key, { minutes: formatDuration(entry.durationSec).minutes }) }),
                ),
              ),
            ),
      ),
    );
  },

  afterPaint(ctx, view) {
    if (view.error) {
      ctx.setBanner(FallbackBanner({ tone: 'warning', message: ctx.t('state.offlineData') }));
    } else if (!view.loading) {
      ctx.clearBanner();
    }
  },
});

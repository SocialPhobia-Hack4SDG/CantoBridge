/**
 * 匹配大厅（MatchPage）与资料预览（PeerPreviewPage）。
 *
 * 匹配是「手动」的：学习者排队等着，母语者浏览并挑人。
 *
 * **匹配前不再选兴趣**：没排队的人看到的是一张很简单的卡片（`matchStartCard`）——只有一句说明和
 * 一个「开始匹配」按钮，点它（`startMatching`）直接入队。「想聊什么主题」不再由用户在匹配前勾选：
 * 匹配度仍然按**资料里的兴趣**算（资料页保留了兴趣题），但不在匹配页重复问一遍。
 *
 * **排队状态活在 store 里，不活在页面里**：一旦入了队，进出匹配页既不会重新入队，也不会重置等待计时；
 * 匹配到人之后由 app 层的后台引擎弹右上角的 `MatchAcceptToast`（不在这一页渲染），
 * 所以用户就算已经走到首页，一样能收到匹配成功的提示。
 * 「等太久出现演示伙伴入口」用的阈值与后台引擎共用 MATCH_FOUND_AFTER_MS。
 *
 * 出口只有一个：等待面板上的「取消匹配」（`cancelMatching`）——它退出队列并作废待接受请求；
 * 「不接受」只跳过这一位伙伴，不算退出。取消之后回到这一页看到的是开始卡片，不会自动重新排队。
 */

import { definePage } from '../app/page.js';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/base.js';
import { BuddyBrowseList, MatchWaitingPanel, ProfilePreviewCard } from '../components/match.js';
import { h, pill } from '../lib/dom.js';
import { MATCH_FOUND_AFTER_MS, intentForRole } from '../lib/logic.js';
import { complementProps, complementView, matchCriteriaSummary } from '../lib/viewModel.js';
import { elapsedSeconds, formatClock } from '../lib/viewModel.js';

function peerMeta(peer, ctx) {
  const parts = [];
  if (peer.nativeLanguage && peer.nativeLanguage !== 'yue') parts.push(ctx.label('nativeLanguages', peer.nativeLanguage));
  if (peer.cantoneseLevel) parts.push(ctx.label('levels', peer.cantoneseLevel) + ' · ' + ctx.t('setup.level'));
  return parts;
}

function scoreLabel(peer, ctx) {
  return peer.matchScore ? peer.matchScore + '% ' + ctx.t('match.matchLabel') : null;
}

export const MatchPage = definePage({
  name: 'MatchPage',
  titleKey: 'match.title',

  async load(ctx) {
    const state = ctx.getState();
    const role = state.role;
    ctx.view.role = role;
    ctx.view.local = {
      tab: role === 'buddy' ? 'browse' : 'waiting',
      timeoutShown: false,
    };

    ctx.watch(() => {
      if (ctx.getState().role !== ctx.view.role) ctx.reload();
    });

    // 匹配频道推来新列表（有人入队 / 退队 / 被摘走）就地重绘。
    // **不 reload**：那会再打一次 REST，还会把骨架屏闪回来。
    let lastPushed = ctx.getState().runtime.matchPeers;
    ctx.watch(() => {
      const next = ctx.getState().runtime.matchPeers;
      if (next === lastPushed) return;
      lastPushed = next;
      ctx.paint();
    });

    // 计时器两种身份都要开：母语者默认视图是「挑学习者」，但切到「我也在等」一样有等待面板，
    // 少了它，那边的「已等待」就只在页面重新渲染时才跳一次（看起来就是卡住不动）。
    // 面板不在时不干活：tick 找不到 .waiting-elapsed 会直接返回。
    startWaitingTicker(ctx);

    if (role === 'buddy') {
      const candidates = await ctx.api.listWaitingLearners();
      return { candidates };
    }

    // 进这一页**不再自动入队**。等待面板只属于已经排上队的人，
    // 新来的（包括刚注册完的新用户）先看到一张开始卡片，点「开始匹配」才真的进队列。
    // 排队状态依然活在 store 里：已经在队列里的人回到这一页还是接着等，不重新排队、计时不清零。
    return { candidates: [] };
  },

  render(ctx, view) {
    const t = ctx.t;
    const local = view.local;
    // 首次渲染发生在 load() 之前（app.js 先 paint 再取数），此时还没有本地状态，
    // 必须先给骨架屏；否则读 local.tab 会直接抛错、整个匹配大厅变成白屏。
    if (!local) return h(LoadingSkeleton, { variant: 'list', rows: 3 });
    const tabs = ctx.getState().role === 'buddy'
      ? h(
          'div',
          { class: 'segment' },
          pill(t('match.tabWaiting'), {
            tone: local.tab === 'waiting' ? 'accent' : 'neutral',
            selected: local.tab === 'waiting',
            // 切到「我也在等」只是换视图：没排队的人看到的是闸门，不会因为点了一下就进队列
            onClick: () => {
              if (local.tab === 'waiting') return;
              local.tab = 'waiting';
              ctx.paint();
            },
          }),
          pill(t('match.tabBrowse'), {
            tone: local.tab === 'browse' ? 'accent' : 'neutral',
            selected: local.tab === 'browse',
            onClick: () => {
              if (local.tab === 'browse') return;
              local.tab = 'browse';
              ctx.paint();
            },
          }),
        )
      : null;

    const body = local.tab === 'waiting' ? waitingTab(ctx, view) : browsePanel(ctx, view);
    // 教 / 学 标签由「我的」页里的身份派生，只读展示：换身份就自动换标签，这里不给选择开关
    const ownIntent = intentForRole(ctx.getState().role);
    return h(
      'section',
      { class: 'stack' },
      tabs,
      h(
        'div',
        { class: 'pill-row own-intent-row' },
        ownIntent ? pill(ctx.label('matchIntents', ownIntent), { tone: 'accent-soft', selected: true }) : null,
      ),
      h('p', { class: 'muted-note', text: t('match.learnerNotice') }),
      body,
    );
  },
});

/**
 * 等待标签页的两个形态：**没排队 = 开始卡片**（一句说明 + 一个「开始匹配」按钮），
 * **已排队 = 等待面板**（计时 + 取消匹配）。匹配前不再有任何选择题。
 */
function waitingTab(ctx, view) {
  return ctx.getState().runtime.queue ? waitingPanel(ctx, view) : matchStartCard(ctx);
}

/**
 * 没排队时看到的开始卡片：不再让用户勾选兴趣主题，只有一个出路「开始匹配」。
 * 匹配度仍然按资料里的兴趣算，想改兴趣去「我的 → 编辑资料」。
 */
function matchStartCard(ctx) {
  const t = ctx.t;
  const local = ctx.view.local;
  return h(
    'section',
    { class: 'card match-start' },
    h('h3', { class: 'card-title', text: t('match.readyTitle') }),
    h('p', { class: 'muted-note', text: t('match.readyHint') }),
    h(
      'button',
      {
        class: 'btn btn-primary btn-block',
        type: 'button',
        disabled: local.queueAction === 'joining',
        attrs: { 'aria-busy': String(local.queueAction === 'joining') },
        onClick: () => void startMatching(ctx),
      },
      local.queueAction === 'joining' ? t('state.loading') : t('match.start'),
    ),
    local.queueError ? h('p', { class: 'muted-note is-warn', attrs: { role: 'alert' }, text: t('match.failed') }) : null,
  );
}

/**
 * 「开始匹配」：直接入队（匹配前不再写匹配条件——兴趣只在资料里维护）。
 * 入队之后本页原地从开始卡片切成等待面板，计时从入队那一刻起算。
 */
async function startMatching(ctx) {
  const local = ctx.view.local;
  if (local.queueAction) return;
  local.queueAction = 'joining';
  local.queueError = false;
  ctx.paint();
  try {
    await ctx.api.joinQueue();
  } catch {
    local.queueError = true;
  } finally {
    local.queueAction = null;
    ctx.paint();
  }
}

function waitingPanel(ctx, view) {
  const t = ctx.t;
  const state = ctx.getState();
  const local = view.local;
  // 计时以 store 里的入队时刻为准：开始卡片点「开始匹配」是原地切换、不会重新 load，
  // 读 view.data 会拿到过期的 queuedAt。
  const elapsed = elapsedSeconds(state.runtime.queue?.joinedAt ?? ctx.store.now(), ctx.store.now());
  const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
  const allowDemoRescue = ctx.win.__CANTOBRIDGE_DEV__ === true;

  return h(
    'div',
    { class: 'stack' },
    h(MatchWaitingPanel, {
      elapsedText: t('match.elapsed') + ' ' + formatClock(elapsed),
      notice: t('match.learnerTitle'),
      backgroundHint: t('match.backgroundHint'),
      waitHint: elapsed >= 60 ? t('match.waitLong') : null,
      // 摘要只描述「现在按什么找人」，不再提供修改入口：兴趣在资料里维护
      criteria: matchCriteriaSummary(profile, { labelOf: ctx.label }),
      cancelLabel: t('match.cancel'),
      cancelBusy: local.queueAction === 'leaving',
      onCancel: () => void cancelMatching(ctx),
      timeoutHint: allowDemoRescue && elapsed >= MATCH_FOUND_AFTER_MS / 1000 ? t('match.timeout') : null,
      demoLabel: allowDemoRescue ? t('match.demoBuddy') : null,
      // 手动救场入口：与后台引擎产出的是同一种「待接受」请求，走同一个弹窗
      onDemo: allowDemoRescue ? () => void ctx.api.requestMatch({ reason: 'demo' }) : null,
    }),
    local.queueError ? h('p', { class: 'is-warn', attrs: { role: 'alert' }, text: t('match.cancelFailed') }) : null,
  );
}

/**
 * 取消匹配：退出队列，并作废还没接受的匹配请求（右上角弹窗跟着收起），然后回首页。
 *
 * 不做二次确认：这是可逆动作——首页主按钮与底部「匹配」都能重新开始，
 * 落地的横幅会说明「已经取消」。进房 / 取消 / 重置演示数据是清掉排队的仅有的三个口子。
 */
async function cancelMatching(ctx) {
  const local = ctx.view.local;
  if (local.queueAction) return;
  local.queueAction = 'leaving';
  ctx.paint();
  try {
    await ctx.api.leaveQueue();
    ctx.store.setNotice({ kind: 'banner', messageKey: 'match.cancelled', tone: 'info' });
    ctx.navigate('/home');
  } catch {
    local.queueAction = null;
    local.queueError = true;
    ctx.paint();
  }
}

/**
 * 候选人列表的**两个来源**：匹配频道推来的那份优先（它最新），
 * 没收到过推送（`matchPeers` 为 null）时回落到进页面时 REST 拉的那份。
 * 断线时推送列表不会凭空变空，界面也就不会闪一下「没有人在等」。
 */
function candidatesOf(ctx, view) {
  const pushed = ctx.getState().runtime.matchPeers;
  if (Array.isArray(pushed)) return pushed;
  return view.data?.candidates ?? [];
}

function browsePanel(ctx, view) {
  const t = ctx.t;
  const local = view.local;
  return h(BuddyBrowseList, { anonymousLabel: t('anonymous.label'), locale: ctx.locale,
    items: view.error ? [] : candidatesOf(ctx, view),
    isLoading: view.loading,
    error: view.error ? t('match.failed') : null,
    emptyLabel: t('match.empty'),
    retryLabel: view.error ? t('action.retry') : t('match.refresh'),
    onRetry: () => ctx.reload(),
    matchLabelFor: (peer) => scoreLabel(peer, ctx),
    metaFor: (peer) => peerMeta(peer, ctx),
    // 教 / 学 标签（按对方身份派生）排在兴趣前面：先看这个人站哪一边，再看聊什么
    tagsFor: (peer) => [
      ...(peer.intent ? [ctx.label('matchIntents', peer.intent)] : []),
      ...(peer.interests ?? []).map((value) => ctx.label('interests', value)),
    ],
    matchedTagsFor: (peer) => (peer.matchedTags ?? []).map((value) => ctx.label('interests', value)),
    // 「语言互补」徽标：母语者看学习者，问的是「TA 的母语是不是我想练的那门」。
    // 没有徽标，台上的排序变化根本看不出来——这正是 B 必须在界面上留痕的原因（见 docs/07 第 9.4 节）。
    complementFor: (peer) => complementView(peer, { t, label: ctx.label, noteKey: 'match.complementPeerNative' }),
    onPick: (peer) => ctx.navigate('/match/' + peer.peerId),
  });
}

function startWaitingTicker(ctx) {
  const tick = () => {
    const node = ctx.el.querySelector?.('.waiting-elapsed');
    if (!node) return;
    const elapsed = elapsedSeconds(ctx.getState().runtime.queue?.joinedAt ?? ctx.store.now(), ctx.store.now());
    node.textContent = ctx.t('match.elapsed') + ' ' + formatClock(elapsed);
    if (ctx.view.local && Boolean(ctx.view.local.slowShown) !== (elapsed >= 60)) {
      ctx.view.local.slowShown = elapsed >= 60;
      ctx.paint();
    }
    if (elapsed >= MATCH_FOUND_AFTER_MS / 1000 && ctx.view.local && !ctx.view.local.timeoutShown) {
      ctx.view.local.timeoutShown = true;
      ctx.paint();
    }
  };
  const id = setInterval(tick, 1000);
  ctx.onCleanup(() => clearInterval(id));
}


export const PeerPreviewPage = definePage({
  name: 'PeerPreviewPage',
  titleKey: 'preview.title',

  async load(ctx) {
    const candidate = await ctx.api.getCandidate(ctx.params.learnerId);
    const cards = await ctx.api.getCards('preview-' + candidate.peerId, {
      interests: candidate.interests,
      level: candidate.cantoneseLevel ?? 'beginner',
    });
    ctx.view.local = { previewIndex: null, claiming: false, taken: false };
    return { candidate, cards: cards.cards };
  },

  render(ctx, view) {
    const t = ctx.t;
    const local = view.local ?? { previewIndex: null, claiming: false, taken: false };

    if (view.loading) return h(LoadingSkeleton, { variant: 'card', rows: 5 });
    if (view.error) {
      return h(ErrorState, {
        message: t('state.failed'),
        retryLabel: t('action.retry'),
        onRetry: () => ctx.reload(),
        secondaryLabel: t('action.back'),
        onSecondary: () => ctx.navigate('/match'),
      });
    }
    if (local.taken || view.data?.candidate?.roomAvailable === false) {
      return h(EmptyState, { title: t('preview.taken'), actionLabel: t('action.back'), onAction: () => ctx.navigate('/match') });
    }

    const candidate = view.data.candidate;
    const matchedTags = (candidate.matchedTags ?? []).map((value) => ctx.label('interests', value));
    const topics = (candidate.interests ?? []).map((value) => ctx.label('interests', value));
    const intent = candidate.intent ? ctx.label('matchIntents', candidate.intent) : null;
    const previewCard = local.previewIndex === null ? null : view.data.cards[local.previewIndex];

    return h(
      'section',
      { class: 'stack' },
      h(ProfilePreviewCard, { anonymousLabel: t('anonymous.label'), locale: ctx.locale,
        peer: { anonymous: candidate.anonymous, displayName: candidate.displayName, peerId: candidate.peerId },
        matchedTags,
        reason: matchedTags,
        meta: peerMeta(candidate, ctx),
        topics,
        ...complementProps(candidate, { t, label: ctx.label, noteKey: 'match.complementPeerNative' }),
        labels: {
          level: t('privacy.itemLevel'),
          levelValue: candidate.cantoneseLevel ? ctx.label('levels', candidate.cantoneseLevel) : '',
          identity: t('privacy.itemIdentity'),
          identityValue: candidate.identity ? ctx.label('identities', candidate.identity) : '',
          hidden: t('preview.hidden'),
          why: t('preview.why'),
        },
      }),
      intent
        ? h('div', { class: 'pill-row preview-intent' }, pill(intent, { tone: 'accent-soft', selected: true }))
        : null,
      h(
        'div',
        { class: 'row-actions' },
        topics.map((label, index) =>
          pill(label, {
            tone: local.previewIndex === index ? 'accent' : 'neutral',
            onClick: () => {
              local.previewIndex = local.previewIndex === index ? null : index;
              ctx.paint();
            },
          }),
        ),
      ),
      previewCard
        ? h(
            'div',
            { class: 'card topic-preview' },
            h('span', { class: 'muted-note', text: t('preview.topicPreview') }),
            h('p', { class: 'topic-line is-yue', text: previewCard.cantonese }),
            h('p', { class: 'topic-line is-mandarin', text: previewCard.mandarin }),
            h('p', { class: 'topic-line is-english', text: previewCard.english }),
          )
        : null,
      h('span', { class: 'match-badge', text: scoreLabel(candidate, ctx) ?? '' }),
      h(
        'button',
        {
          class: 'btn btn-primary btn-block',
          type: 'button',
          disabled: local.claiming,
          onClick: async () => {
            local.claiming = true;
            ctx.paint();
            try {
              const room = await ctx.api.createRoom(candidate.peerId);
              ctx.navigate('/room/' + room.roomId);
            } catch (error) {
              local.claiming = false;
              local.taken = error?.code === 'room_taken';
              ctx.paint();
            }
          },
        },
        local.claiming ? t('state.loading') : t('preview.start'),
      ),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => ctx.navigate('/match') }, t('action.back')),
    );
  },
});

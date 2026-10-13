/**
 * 会话房间（ChatRoomPage）与结算（SessionSummaryPage）。
 * 只做语音：这里没有任何摄像头元素；一切异常都走 FallbackBanner + 模式降级，不弹错误页。
 */

import { definePage } from '../app/page.js';
import { EmptyState, ErrorState, FallbackBanner, LoadingSkeleton } from '../components/base.js';
import { AchievementBadge, AchievementWall, RewardCard, SessionFeedbackSheet } from '../components/progress.js';
import { CallControls, CallStage, PhraseChips, RoomHeader, TopicCardStack } from '../components/room.js';
import { BUDDY_FEEDBACK_TAGS, LEARNER_FEEDBACK_TAGS } from '../data/tags.js';
import { barHeights } from '../lib/audio.js';
import { h, pill } from '../lib/dom.js';
import { intentForRole, uniqueList } from '../lib/logic.js';
import { roomSignalUrl } from '../lib/signal.js';
import { deckPosition, deckProgress, formatClock, roomStatusKey } from '../lib/viewModel.js';
import { createCardSound } from '../lib/cardSound.js';
import { summaryModel } from '../lib/viewModel.js';
import { readStoredToken } from '../services/http.js';
import { createCallSession } from '../services/rtc.js';

// Update only this panel: repainting the entire room disrupts Safari scrolling
// and recreates the card gesture listeners while a call is in progress.
function diagnosticsPanel(ctx, local, call) {
  const report = h('pre', { class: 'call-diagnostics-report', hidden: !local.diagnosticsReport, text: local.diagnosticsReport ?? '' });
  const button = h('button', { class: 'btn btn-secondary', type: 'button', disabled: local.diagnosticsPending,
    'aria-busy': String(Boolean(local.diagnosticsPending)), onClick: () => {
      if (local.diagnosticsPending) return;
      local.diagnosticsPending = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      void Promise.resolve().then(() => call.diagnostics()).catch(() => ({ statsUnavailable: true })).then(value => {
        local.diagnosticsReport = JSON.stringify(value, null, 2);
      }).finally(() => {
        local.diagnosticsPending = false;
        // A normal call-status change may have rendered a newer panel meanwhile.
        const current = ctx.el?.querySelector?.('.call-diagnostics') ?? panel;
        const currentReport = current.querySelector('pre');
        const currentButton = current.querySelector('button');
        if (currentReport) { currentReport.textContent = local.diagnosticsReport; currentReport.hidden = false; }
        if (currentButton) { currentButton.disabled = false; currentButton.setAttribute('aria-busy', 'false'); }
      });
    },
  }, ctx.t('room.checkRefresh'));
  const panel = h('details', { class: 'card field call-diagnostics', open: local.diagnosticsOpen ? true : undefined,
    onToggle: event => { local.diagnosticsOpen = event.target.open; } },
    h('summary', { text: ctx.t('room.check') }),
    h('p', { class: 'muted-note', text: ctx.t('room.checkHint') }), button, report);
  return panel;
}

const PEER_LEFT_SETTLE_MS = 2000;

/**
 * 房间内的本地状态。
 *   - `visited`：**这一叠**看过的卡 id（首张进来就算看过），牌堆进度与「聊过了」标记靠它；
 *   - `sessionVisited` / `sessionTopics`：**跨叠累计**的同一份数据 —— 「再来八张」会换掉
 *     整叠卡并把 `visited` 归零，结算要是也读 `visited`，「聊过 16 张」就会被写成 8 张；
 *   - `round`：第几叠（「再来八张」加一）。它要跟对面同步，两侧才能取到同一批卡。
 */
function makeLocal(deck = [], round = 0) {
  const local = {
    index: 0,
    visited: [],
    sessionVisited: [],
    sessionTopics: [],
    saved: [],
    speakerOn: true,
    peerLeft: false,
    settling: false,
    round,
    /** 上一次翻卡是跟着对方翻的（用来显示一句提示，自己翻一次就清掉）。 */
    followedFromPeer: false,
  };
  if (deck.length > 0) visit(local, deck, 0);
  return local;
}

/** 翻到第 index 张：记下看过的卡（同一个 id 只记一次），返回新的 index。 */
function visit(local, deck, index) {
  if (!Array.isArray(local.visited)) local.visited = [];
  if (!Array.isArray(local.sessionVisited)) local.sessionVisited = [];
  if (!Array.isArray(local.sessionTopics)) local.sessionTopics = [];
  const next = Math.max(0, Math.min(deck.length - 1, index));
  const card = deck[next];
  if (card) {
    if (!local.visited.includes(card.id)) local.visited = local.visited.concat(card.id);
    if (!local.sessionVisited.includes(card.id)) {
      local.sessionVisited = local.sessionVisited.concat(card.id);
      local.sessionTopics = uniqueList(local.sessionTopics.concat(card.topic));
    }
  }
  local.index = next;
  return next;
}

/**
 * 我这边翻了卡 → 告诉对方（「双方看同一张」的上行那半）。
 * `sim` 档位 / 对方不在时 `sendCard` 是个空操作，不影响本地翻卡。
 */
function announceCard(view) {
  const card = (view.data?.deck ?? [])[view.local?.index];
  if (!card) return;
  view.call?.sendCard?.({ cardId: card.id, index: view.local.index, round: view.local?.round ?? 0 });
}

/**
 * 跟到对方那张卡。**优先按 id 找**：牌堆万一漂移（两边取卡时资料刚好不同），
 * 序号会指到另一张卡；找不到才退回序号。绝不回推，否则两边来回弹成死循环。
 */
function followCard(view, payload) {
  const local = view.local;
  const deck = view.data?.deck ?? [];
  if (!local || deck.length === 0) return;
  const byId = deck.findIndex((card) => card.id === payload?.cardId);
  const target = byId >= 0 ? byId : Number(payload?.index);
  if (!Number.isFinite(target) || target < 0 || target >= deck.length) return;
  if (target === local.index) return;
  visit(local, deck, target);
  local.followedFromPeer = true;
}

/** 房主自动标签：由房间模式派生（`room.role`，与「我的」里的身份同源），取不到就不渲染徽标。 */
function hostIntentLabel(ctx, room) {
  const intent = intentForRole(room?.role ?? ctx.getState().role);
  return intent ? ctx.label('matchIntents', intent) : null;
}

function levelForRoom(ctx) {
  const state = ctx.getState();
  const room = state.runtime.room;
  if (state.role === 'learner') return state.learnerProfile.cantoneseLevel ?? 'beginner';
  return room?.peer?.cantoneseLevel ?? state.learnerProfile.cantoneseLevel ?? 'beginner';
}

function sharedInterestsFor(ctx) {
  const state = ctx.getState();
  const room = state.runtime.room;
  const mine = state.role === 'buddy' ? state.buddyProfile.interests ?? [] : state.learnerProfile.interests ?? [];
  const theirs = room?.peer?.interests ?? [];
  return uniqueList(mine.filter((tag) => theirs.includes(tag)));
}

export const ChatRoomPage = definePage({
  name: 'ChatRoomPage',
  titleKey: 'room.title',

  async load(ctx) {
    const room = ctx.getState().runtime.room;
    const level = levelForRoom(ctx);
    // 第 0 叠：开场那一叠。`exclude` 是空数组（本次会话还没看过任何卡）。
    const deck = await ctx.api.getCards(room.roomId, { interests: sharedInterestsFor(ctx), level, round: 0 });

    ctx.view.local = makeLocal(deck.cards, deck.round ?? 0);
    ctx.view.level = level;
    ctx.view.roomId = room.roomId;
    ctx.view.call = await getSession(ctx, room);
    attachSession(ctx);
    return { deck: deck.cards, room };
  },

  render(ctx, view) {
    const t = ctx.t;
    if (view.loading) return h('div', { class: 'stack' }, h(LoadingSkeleton, { variant: 'stage', rows: 3 }));
    // load 失败也要有出路：房间可能已经结束 / 刷新后丢了（契约 4.5 节 `room_gone`）。
    // 没有这一层的话，下面 `local.peerLeft` 会直接抛 TypeError —— 抛在 paint 里就是
    // **整个 app 崩掉**（真数据联调踩到过：`GET /api/rooms/:id/cards` 回 404 时白屏）。
    if (view.error) {
      return h(
        'section',
        { class: 'stack' },
        h(ErrorState, {
          message: t('state.failed'),
          retryLabel: t('action.retry'),
          onRetry: () => ctx.navigate('/match'),
        }),
      );
    }
    // 兜底同上：首帧（load 还没回来）之后 local 理论上一定在，但别让渲染依赖这个假设
    const local = view.local ?? makeLocal([]);
    const room = view.data?.room ?? ctx.getState().runtime.room;
    const call = view.call;
    const snapshot = call?.snapshot() ?? { mode: ctx.allowSimulation === false ? 'remote' : 'sim', status: 'connecting', muted: false, hasMic: true, peerLeft: false };
    const statusLabel = ctx.demo ? t('demo.status') : t(roomStatusKey({ status: snapshot.status, mode: snapshot.mode, hasMic: snapshot.hasMic, peerLeft: local.peerLeft }));
    const elapsed = Math.max(0, Math.round((ctx.store.now() - (room?.startedAt ?? ctx.store.now())) / 1000));
    const deck = view.data?.deck ?? [];
    const position = deckPosition(local.index, deck.length);
    const progress = deckProgress({ index: local.index, total: deck.length, seen: local.visited });
    const covered = local.sessionTopics ?? [];
    const card = deck[local.index];
    const phrases = card?.expressions ?? [];

    return h(
      'div',
      { class: 'stack room-page' },
      h(RoomHeader, {
        peerName: room?.peer?.anonymous ? t('anonymous.label') : (room?.peer?.displayName ?? room?.peer?.peerId ?? t('anonymous.label')),
        elapsedText: formatClock(elapsed),
        anonymous: Boolean(room?.peer?.anonymous),
        statusLabel,
        statusTone: local.peerLeft ? 'warn' : snapshot.status === 'live' ? 'live' : 'idle',
        // 房主标签按房间模式**自动**带上：母语者房主 = 教粤语，学习者房主 = 学粤语。
        // 派生值（intentForRole），不在房间里提供手动切换——换身份就换标签。
        hostLabel: t('room.host'),
        hostIntentLabel: hostIntentLabel(ctx, room),
      }),
      h(CallStage, {
        compact: true,
        showIdentity: true,
        anonymousLabel: t('anonymous.label'),
        interestLabels: room?.peer?.visibility?.interests === false ? [] : uniqueList(room?.peer?.interests).map(value => ctx.label('interests', value)),
        emptyInterestsLabel: t('room.noPublicInterests'),
        peer: room?.peer,
        statusLabel,
        modeLabel: snapshot.mode === 'sim' ? t('room.simulated') : null,
        level: 0,
        active: !snapshot.muted,
        warning: ctx.demo ? null : !snapshot.hasMic
          ? t('room.listenOnly')
          : snapshot.audioBlocked
            ? t('room.gesture')
            : null,
        // 被自动播放策略挡下时，提示已经升级成警告了，别再重复一遍
        hint: null,
      }),
      deck.length === 0
        ? h(EmptyState, {
            title: t('room.empty'),
            actionLabel: t('room.regenerate'),
            onAction: () => ctx.reload(),
          })
        : h('div', { class: 'room-content' }, [
            !local.introDismissed && local.index === 0 && (local.visited?.length ?? 0) <= 1
              ? h('div', { class: 'room-start-hint' }, h('p', { text: t('room.startHint') }), h('button', { class: 'link-btn', type: 'button', onClick: () => { local.introDismissed = true; ctx.paint(); } }, t('room.dismissHint')))
              : null,
            h(TopicCardStack, {
              cards: deck,
              index: local.index,
              positionLabel: t('room.topicOf', position.vars),
              difficultyLabels: deck.map((item) => ctx.label('levels', item.difficulty)),
              seenIds: local.visited,
              seenLabel: t('room.cardSeen'),
              jyutpingLabel: t('room.jyutping'),
              hint: t('room.swipeHint'),
              onSwipe: (delta) => swiping(ctx, delta),
            }),
            // 跟对方看同一张时给一句提示：不解释的话，卡片自己跳走会很莫名其妙
            local.followedFromPeer ? h('p', { class: 'muted-note', text: t('room.followingPeer') }) : null,
            // 进度条 + 「看过 N / M 张」：一叠卡有多少、走了多远，一眼能看出来
            h('div', { class: 'deck-meter' }, [
              h('div', { class: 'deck-meter-track' }, h('div', { class: 'deck-meter-fill', style: { width: progress.percent + '%' } })),
              h('span', { class: 'muted-note', text: t('room.deckProgress', progress.vars) }),
            ]),
            h('div', { class: 'stack-nav' }, [
              h(
                'button',
                {
                  class: 'btn btn-secondary',
                  type: 'button',
                  disabled: progress.atStart,
                  attrs: { 'aria-label': t('room.prevCard') },
                  onClick: () => swiping(ctx, -1),
                },
                '‹',
              ),
              h(
                'button',
                {
                  class: 'btn btn-secondary',
                  type: 'button',
                  disabled: progress.atEnd,
                  attrs: { 'aria-label': t('room.nextCard') },
                  onClick: () => swiping(ctx, 1),
                },
                '›',
              ),
              h('details', { class: 'room-card-settings', open: local.cardSettingsOpen ? true : undefined, onToggle: event => { local.cardSettingsOpen = event.target.open; } },
                h('summary', { text: t('room.cardSettings') }),
                h('div', { class: 'room-card-settings-panel' }, h('button', { class: 'btn btn-quiet card-sound-toggle', type: 'button', attrs: { 'aria-label': t('room.cardSound'), 'aria-pressed': String(local.cardSound !== false) }, onClick: () => { local.cardSound = local.cardSound === false; ctx.paint(); } }, t(local.cardSound === false ? 'room.soundOff' : 'room.soundOn')))),
            ]),
            // 到头了就给明确的出路：两个箭头都置灰的时候，别让人对着按钮干瞪眼。
            // 两条路：「再上八张」换一整叠新的（旧的作废、进度归零），或「聊完，去结算」。
            progress.atEnd
              ? h('div', { class: 'room-deck-end' }, [
                  h('p', { class: 'muted-note', text: t('room.deckEnd') }),
                  h(
                    'button',
                    {
                      class: 'btn btn-primary btn-block',
                      type: 'button',
                      attrs: { 'data-action': 'deal-more' },
                      onClick: () => void dealMore(ctx, view),
                    },
                    t('room.dealMore'),
                  ),
                  h(
                    'button',
                    { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => void settle(ctx, view) },
                    t('room.finishNow'),
                  ),
                ])
              : null,
            covered.length === 0
              ? null
              : h('details', { class: 'covered-block', open: local.coveredOpen ? true : undefined, onToggle: event => { local.coveredOpen = event.target.open; } }, [
                  h('summary', { class: 'muted-note', text: t('room.coveredTitle') }),
                  h('div', { class: 'row-actions' }, covered.map((topic) => pill(ctx.label('topicCards', topic), { tone: 'accent-soft' }))),
                ]),
            h(PhraseChips, {
              phrases,
              savedIds: local.saved,
              onPick: null,
              onSave: async (phrase) => {
                // 收藏先落本地：/api/me/saved-phrases 是后端清单里的「可后置」端点，
                // 接口还没接好之前星星也要立刻点亮，不能点了没反应。
                local.saved = uniqueList(local.saved.concat(phrase.cantonese));
                ctx.paint();
                try {
                  await ctx.api.savePhrase(phrase);
                } catch {
                  // 服务端没写上也不影响这次演示：本地已经记下（与 settle() 的离线兜底同一套思路）。
                }
              },
              saveLabel: t('room.savePhrase'),
              savedLabel: t('room.saved'),
              title: t('room.phraseHint'),
            }),
          ]),
      !ctx.demo && call?.diagnostics ? diagnosticsPanel(ctx, local, call) : null,
      h(CallControls, {
        muted: snapshot.muted,
        speakerOn: snapshot.speakerOn !== false,
        disabled: !ctx.demo && !snapshot.hasMic,
        onToggleMute: () => {
          call?.toggleMute();
          ctx.paint();
        },
        onToggleSpeaker: () => {
          call?.setSpeakerEnabled(snapshot.speakerOn === false);
          ctx.paint();
        },
        onHangup: () => void settle(ctx, view),
        labels: { mic: t('room.mic'), muted: t('room.muted'), speaker: t('room.speaker'), speakerOn: t('room.playbackOn'), speakerOff: t('room.playbackOff'), hangup: t('room.hangup') },
      }),
    );
  },

  afterPaint(ctx, view) {
    const call = view.call;
    if (!call) return;
    const local = view.local;
    if (!local.animating) {
      local.animating = true;
      startWaveLoop(ctx, view, call);
    }
    if (!local.ticking) {
      local.ticking = true;
      const id = setInterval(() => {
        const node = ctx.el.querySelector?.('.room-header-meta');
        const room = ctx.getState().runtime.room;
        if (node && room) {
          const elapsed = Math.max(0, Math.round((ctx.store.now() - room.startedAt) / 1000));
          const first = node.children?.[0];
          if (first) first.textContent = formatClock(elapsed);
        }
      }, 1000);
      ctx.onCleanup(() => clearInterval(id));
    }
  },

  onExit(ctx) {
    ctx.view.cardAudio?.close();
    const roomId = ctx.view.roomId;
    ctx.view.cardUnsubscribe?.();
    const call = ctx.rooms.get(roomId);
    if (call && !ctx.view.local?.keepAlive) {
      ctx.rooms.delete(roomId);
      void call.hangup();
    }
  },
});

function swiping(ctx, delta) {
  const view = ctx.view;
  const deck = view.data?.deck ?? [];
  const local = view.local;
  if (!local || deck.length === 0) return;
  const before = local.index;
  visit(local, deck, before + delta);
  if (local.index === before) return; // 到头了：箭头此时已置灰，滑动这一路也停住
  // 音效复用**通话那条** `AudioContext`：通话进行中另起一条，移动端会重新协商音频会话、
  // 把正在播的远端人声打断（见 lib/cardSound.js）。拿不到（sim 档位 / 通话已结束）才自己建。
  if (local.cardSound !== false) {
    (view.cardAudio ??= createCardSound(ctx.win, { getContext: () => view.call?.getAudioContext?.() ?? null })).play();
  }
  local.followedFromPeer = false; // 我自己翻的，不再显示「跟到对方那张」
  announceCard(view);
  ctx.paint();
}

/**
 * 换一叠（「再上八张」）：**旧的一叠整叠作废** —— 进度归零、重新从第一张开始。
 *
 * 两件事必须一起做，否则「全新的 8 张」是空话：
 *   1. `round + 1`：服务端的洗牌种子是「房间号 + 第几叠」，加一才会换一批卡；
 *      同时它保证**两侧请求同一个 round 拿到同一叠**（对面也能跟过来）。
 *   2. `exclude`：把**这一叠已经看过的卡**传下去。窗口里可能就那 8 张，
 *      不排除的话洗来洗去还是同一批 —— 宁可去同一主题的下一档拿新卡。
 *
 * `announce: false` 用在「对面换了我跟着换」这条路上：跟着换不再回推，否则两边互相触发。
 */
async function dealMore(ctx, view, options = {}) {
  const local = view.local;
  const room = ctx.getState().runtime.room;
  if (!local || !room) return;
  const requested = Number(options.round);
  const round = Number.isFinite(requested) ? requested : (local.round ?? 0) + 1;
  let deck;
  try {
    deck = await ctx.api.getCards(room.roomId, {
      interests: sharedInterestsFor(ctx),
      level: view.level,
      round,
      exclude: local.visited ?? [],
    });
  } catch {
    // 换不了就维持原样：这不是「通话失败」，不该把整页掀掉
    return;
  }
  const cards = deck?.cards ?? [];
  if (cards.length === 0) return;

  view.data = { ...(view.data ?? {}), deck: cards };
  local.round = deck.round ?? round;
  local.index = 0;
  local.visited = [];
  local.followedFromPeer = false;
  visit(local, cards, 0); // 新一叠的第一张也算看过（sessionVisited / sessionTopics 继续累计）

  if (options.announce !== false) {
    view.call?.sendCard?.({ cardId: cards[0].id, index: 0, round: local.round });
  }
  ctx.paint();
}

async function getSession(ctx, room) {
  const existing = ctx.rooms.get(room.roomId);
  if (existing) return existing;
  const session = createCallSession({
    roomId: room.roomId,
    mode: ctx.allowSimulation === false ? 'remote' : ctx.getState().settings.signalMode,
    allowSimulation: ctx.allowSimulation !== false,
    win: ctx.win,
    // 远端档位要的两样东西：信令地址（`lib/signal.js` 解析）与握手令牌。
    // `local` / `sim` 档位拿不到也没关系，用不到就不会被读。
    signalUrl: roomSignalUrl(ctx.signalUrl, room.roomId),
    token: readStoredToken(),
    // STUN / TURN 由后端下发（`docs/10` 4.8），拿不到时 rtc.js 自己退到写死的 STUN
    loadIceServers: async () => (await ctx.api.getIceServers())?.iceServers ?? null,
  });
  ctx.rooms.set(room.roomId, session);
  await session.start();
  return session;
}

function attachSession(ctx) {
  const view = ctx.view;
  const call = view.call;
  if (!call || view.unsubscribe) return;
  const onState = snapshot => {
    // 通话状态是这一页的主要内容（状态文案 / 「点一下开始通话」的警告 / 麦克风提示），
    // **变了就必须重绘**。以前只在「对方离开 / 降级」两条路上重绘，于是接通之后界面一直停在
    // 「正在建立连接……」，被自动播放策略挡下时那条警告也永远画不出来 —— 用户既不知道已经接通，
    // 也不知道要再点一下才出声。
    const callKey = [snapshot.status, snapshot.audioBlocked, snapshot.hasMic, snapshot.peerPresent, snapshot.muted, snapshot.speakerOn].join('|');
    if (callKey !== view.callKey) {
      view.callKey = callKey;
      ctx.paint();
    }
    if (snapshot.peerLeft && !view.local.peerLeft) {
      view.local.peerLeft = true;
      view.local.keepAlive = true;
      ctx.setBanner(FallbackBanner({ tone: 'warning', message: ctx.t('room.peerLeft') }));
      ctx.paint();
      const id = setTimeout(() => void settle(ctx, view), PEER_LEFT_SETTLE_MS);
      ctx.onCleanup(() => clearTimeout(id));
    }
    if (snapshot.status === 'degraded') {
      ctx.setBanner(
        FallbackBanner({
          tone: 'warning',
          message: ctx.t('room.degraded'),
          actionLabel: ctx.t('room.reconnect'),
          onAction: () => void call.retryConnection?.().then(() => ctx.paint()),
        }),
      );
    }
    if (!ctx.demo && snapshot.hasMic === false) ctx.setBanner(FallbackBanner({ tone: 'info', message: ctx.t('room.listenOnly') }));
  };
  view.unsubscribe = call.subscribe(onState);
  onState(call.snapshot());

  // 「双方看同一张」的下行那半：对方翻到哪张，我这边就跟到哪张。
  // **绝不回推**（`visit` 只改本地，不调 `announceCard`），否则两边会来回弹成死循环。
  view.cardUnsubscribe = call.onCard?.((payload) => {
    const local = view.local;
    if (!local) return;
    // 对方换了一叠（「再上八张」）：先把同一叠取回来，再跟到他那张。
    // 种子同源（房间号 + round）+ 同一份 `exclude`，两侧拿到的是同一批卡。
    const round = Number(payload?.round ?? local.round ?? 0);
    if (Number.isFinite(round) && round !== (local.round ?? 0)) {
      void dealMore(ctx, view, { round, announce: false }).then(() => {
        followCard(view, payload);
        ctx.paint();
      });
      return;
    }
    followCard(view, payload);
    ctx.paint();
  });
}

function startWaveLoop(ctx, view, call) {
  const draw = () => {
    const nodes = ctx.el.querySelectorAll?.('.waveform .wave') ?? [];
    const levels = call.levels();
    nodes.forEach((node, index) => {
      const heights = barHeights(Math.max(levels.self, levels.peer), nodes.length);
      node.style?.setProperty?.('height', Math.round((heights[index] ?? 0.2) * 100) + '%');
    });
    if (ctx.rooms.has(view.roomId)) ctx.win.requestAnimationFrame?.(draw);
  };
  ctx.win.requestAnimationFrame?.(draw);
}

async function settle(ctx, view) {
  const local = view.local;
  if (local.settling) return;
  local.settling = true;
  const room = ctx.getState().runtime.room;
  const durationSec = Math.max(1, Math.round((ctx.store.now() - (room?.startedAt ?? ctx.store.now())) / 1000));
  // 用**跨叠累计**的「看过的卡」而不是当前这一叠的 index：
  // 来回翻过的话 index 会低估，「再上八张」之后更会把上一叠整个抹掉。
  // 上限 64 是后端 `assertInt` 的口径（契约 4.5 节）。
  const cardsUsed = Math.min(64, local.sessionVisited?.length ?? 0);
  const topics = local.sessionTopics ?? [];
  let reward;
  try {
    reward = await ctx.api.endRoom(room.roomId, {
      durationSec,
      cardsUsed,
      topics,
      peerId: room.peer?.peerId,
      peerLabel: room.peer?.displayName,
      role: room.role,
    });
  } catch {
    reward = { durationSec, cardsUsed, xpEarned: 0, unlocked: [], topics, offline: true };
  }
  ctx.store.setReward({ ...reward, roomId: room.roomId, peer: room.peer, role: room.role });
  local.keepAlive = true;
  await ctx.rooms.get(room.roomId)?.hangup();
  ctx.rooms.delete(room.roomId);
  ctx.navigate('/room/' + room.roomId + '/summary');
}

export const SessionSummaryPage = definePage({
  name: 'SessionSummaryPage',
  titleKey: 'summary.title',

  async load(ctx) {
    const reward = ctx.getState().runtime.reward;
    // request 记录「这次结算里伙伴申请走到哪一步」：none -> pending -> buddy
    ctx.view.local = { feedback: [], request: 'none' };
    return { reward, role: reward?.role ?? ctx.getState().role };
  },

  render(ctx, view) {
    const t = ctx.t;
    // 首次渲染发生在 load() 解析之前（app.js 先 paint 再取数），此时 view.data 还是 null；
    // 这里必须给默认值，否则一进结算页就抛错（与 MatchPage 同一类问题）。
    const data = view.data ?? {};
    const role = data.role ?? ctx.getState().role;
    const reward = data.reward ?? {};
    const model = summaryModel({
      role,
      durationSec: reward.durationSec ?? 0,
      cardsUsed: reward.cardsUsed ?? 0,
      xpEarned: reward.xpEarned ?? 0,
      unlocked: reward.unlocked ?? [],
    });
    const local = view.local ?? { feedback: [], request: 'none' };
    const feedbackOptions = (role === 'buddy' ? BUDDY_FEEDBACK_TAGS : LEARNER_FEEDBACK_TAGS).map((value) => ({
      value,
      label: ctx.label('feedback', value),
    }));

    return h(
      'section',
      { class: 'stack' },
      h('h1', { class: 'page-title', text: t(model.headlineKey) }),
      h(RewardCard, {
        xpLabel: t('summary.xp'),
        xpText: '+' + model.xpEarned,
        durationText: { label: t('summary.durationLabel'), value: t(model.durationKey, model.durationVars) },
        cardsText: { label: t('summary.cardsUsed'), value: String(model.cardsUsed) },
        roleNote: role === 'buddy' ? t('summary.domainHint') : null,
        hint: model.showBadges ? null : t('summary.tooShort'),
      }),
      h(
        'div',
        { class: 'card' },
        h('h3', { class: 'card-title', text: t('summary.achievements') }),
        model.unlocked.length === 0
          ? h('p', { class: 'muted-note', text: t('summary.tooShort') })
          : h(
              'div',
              { class: 'badge-wall' },
              model.unlocked.map((id) =>
                h(AchievementBadge, { name: ctx.label('achievements', id), hint: '', unlocked: true, isNew: true, newLabel: t('achievement.new') }),
              ),
            ),
      ),
      h(SessionFeedbackSheet, {
        title: t('summary.feedbackTitle'),
        question: t('summary.feedbackQuestion'),
        options: feedbackOptions,
        value: local.feedback,
        onToggle: (value) => {
          if (local.feedbackPending || local.feedbackSaved) return;
          local.feedback = local.feedback.includes(value) ? local.feedback.filter((item) => item !== value) : local.feedback.concat(value);
          local.feedbackError = false;
          ctx.paint();
        },
        onSubmit: async () => {
          if (local.feedbackPending || local.feedbackSaved || !local.feedback.length) return;
          local.feedbackPending = true; local.feedbackError = false; ctx.paint();
          try {
            await ctx.api.sendFeedback(reward.roomId, { tags: local.feedback });
            local.feedbackSaved = true;
          } catch { local.feedbackError = true; }
          finally { local.feedbackPending = false; ctx.paint(); }
        },
        onSkip: () => ctx.navigate(ctx.demo ? '/match' : '/me'),
        onConnect: async () => {
          if (local.requestPending || local.request !== 'none') return;
          local.requestPending = true; local.requestError = false; ctx.paint();
          // 只发出申请：对方接受之前不会出现在「我的伙伴」里。
          try {
            const result = await ctx.api.sendBuddyRequest(
            reward.peer?.peerId ?? 'unknown',
            reward.peer?.displayName ?? t('anonymous.label'),
            { roomId: reward.roomId ?? null },
          );
            local.request = result?.status === 'accepted' || result?.status === 'buddy' ? 'buddy' : 'pending';
          } catch { local.requestError = true; }
          finally { local.requestPending = false; ctx.paint(); }
        },
        connectLabel: t('summary.sendRequest'),
        notNowLabel: t('action.notNow'),
        skipLabel: t('action.skip'),
        submitLabel: t(local.feedbackPending ? 'summary.savingFeedback' : local.feedbackSaved ? 'summary.feedbackSaved' : 'summary.saveFeedback'),
        feedbackPending: Boolean(local.feedbackPending),
        feedbackSaved: Boolean(local.feedbackSaved),
        requestPending: Boolean(local.requestPending),
        sendingLabel: t('summary.sendingRequest'),
        requestState: local.request,
        pendingLabel: t('summary.requested'),
        buddyLabel: t('summary.alreadyBuddy'),
      }),
      local.feedbackError ? h('p', { class: 'muted-note is-warn', attrs: { role: 'alert' }, text: t('summary.feedbackFailed') }) : null,
      local.requestError ? h('p', { class: 'muted-note is-warn', attrs: { role: 'alert' }, text: t('summary.requestFailed') }) : null,
      !ctx.demo && local.feedbackSaved ? h('p', { class: 'muted-note', attrs: { role: 'status' }, text: t('summary.feedbackSaved') }) : null,
      ctx.demo && local.feedbackSaved ? h('p', { class: 'muted-note', attrs: { role: 'status' }, text: t('demo.feedbackSaved') }) : null,
      h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: Boolean(local.feedbackPending || local.requestPending), onClick: () => ctx.demo ? ctx.openDemoRoom() : ctx.navigate('/match') }, t(ctx.demo ? 'demo.replay' : 'summary.again')),
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', disabled: Boolean(local.feedbackPending || local.requestPending), onClick: () => ctx.navigate(ctx.demo ? '/match' : '/me') }, t(ctx.demo ? 'demo.exit' : 'summary.viewAchievements')),
    );
  },
});

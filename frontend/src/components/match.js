/**
 * 匹配相关组件：BuddyCard / BuddyBrowseList / ProfilePreviewCard /
 * MatchWaitingPanel / MatchAcceptToast。
 * 匿名由服务层裁剪好后传进来，组件只负责画。
 */

import { PresetAvatar } from './avatars.js';
import { h, icon, pill } from '../lib/dom.js';
import { coversAllOptions } from '../lib/logic.js';
import { EmptyState, ErrorState, LoadingSkeleton } from './base.js';
import { labelOf } from '../data/labels.js';

function titleNode(peer, locale = 'zh-Hans') {
  return peer?.equippedTitleId ? h('span', { class: 'achievement-title', text: labelOf('achievements', peer.equippedTitleId, locale) }) : null;
}

function avatarNode(peer, size = 44) {
  return h(PresetAvatar, { avatarId: peer?.avatarId, frameId: peer?.frameId, anonymous: peer?.anonymous, size });
}

/**
 * 「语言互补」徽标 + 一行说明。两处用到（等待列表行 / 预览大卡），所以抽成一个内部小函数，
 * 不新增导出组件——check-ui 的组件清单是双向闭合的，多一个导出就要多改一份文档。
 * 徽标本身不是装饰：没有它，排序变了台上根本看不出来（见 docs/07 第 9.4 节）。
 */
function complementNode(label, note) {
  if (!label && !note) return null;
  return h(
    'div',
    { class: 'complement-row' },
    label ? pill(label, { tone: 'accent', selected: true }) : null,
    note ? h('small', { class: 'muted-note', text: note }) : null,
  );
}

export function BuddyCard({ anonymousLabel = '匿名用户', locale = 'zh-Hans', peer, matchLabel, meta = [], tags = [], matchedTags = [], onPick, ctaLabel = null, complementLabel = null, complementNote = null, disabled = false, busy = false }) {
  const highlighted = new Set(matchedTags);
  const interactive = typeof onPick === 'function';
  return h(
    interactive ? 'button' : 'article',
    { class: ['buddy-card', interactive ? 'is-interactive' : 'is-preview'], type: interactive ? 'button' : undefined, disabled: interactive && disabled, attrs: interactive ? { 'aria-busy': String(busy) } : undefined, onClick: interactive ? () => { if (!disabled) onPick(peer); } : undefined },
    h(
      'div',
      { class: 'buddy-card-head' },
      avatarNode(peer),
      h(
        'div',
        { class: 'buddy-card-title' },
        h('strong', { text: peer.anonymous ? anonymousLabel : peer.displayName }),
        titleNode(peer, locale),
        h('span', { class: 'muted-note', text: meta.join(' · ') }),
      ),
      matchLabel ? h('span', { class: 'match-badge', text: matchLabel }) : null,
    ),
    complementNode(complementLabel, complementNote),
    tags.length > 0
      ? h('div', { class: 'pill-row' }, tags.map((tag) => pill(tag, { tone: highlighted.has(tag) ? 'accent' : 'neutral' })))
      : null,
    ctaLabel && interactive ? h('span', { class: 'buddy-card-cta', text: ctaLabel }) : null,
  );
}

export function BuddyBrowseList({
  locale = 'zh-Hans',
  anonymousLabel = '匿名用户',
  items = [],
  isLoading = false,
  error = null,
  emptyLabel,
  retryLabel,
  onPick,
  onRetry,
  matchLabelFor,
  metaFor,
  tagsFor,
  matchedTagsFor,
  complementFor = null,
  ctaLabel = null,
}) {
  if (isLoading) return h('div', { class: 'list-block' }, h(LoadingSkeleton, { variant: 'card', rows: 3 }));
  if (error) return h(ErrorState, { message: error, retryLabel, onRetry });
  if (items.length === 0) return h(EmptyState, { title: emptyLabel, actionLabel: retryLabel, onAction: onRetry });
  return h('div', { class: 'list-block' }, items.map((peer) => h(BuddyCard, {
    peer, anonymousLabel, locale,
    matchLabel: matchLabelFor(peer),
    meta: metaFor(peer),
    tags: tagsFor(peer),
    matchedTags: matchedTagsFor(peer),
    complementLabel: complementFor ? complementFor(peer)?.label ?? null : null,
    complementNote: complementFor ? complementFor(peer)?.note ?? null : null,
    ctaLabel,
    onPick,
  })));
}

export function ProfilePreviewCard({ anonymousLabel = '匿名用户', locale = 'zh-Hans', peer, matchedTags = [], reason = [], meta = [], topics = [], labels, complementLabel = null, complementNote = null }) {
  const highlighted = new Set(matchedTags);
  const rows = [
    { label: labels.level, value: labels.levelValue, hidden: !peer.cantoneseLevel },
    { label: labels.identity, value: labels.identityValue, hidden: !peer.identity },
  ];
  return h(
    'section',
    { class: 'card preview-card' },
    h(
      'div',
      { class: 'preview-head' },
      avatarNode(peer, 64),
      h(
        'div',
        {},
        h('h2', { class: 'preview-name', text: peer.anonymous ? anonymousLabel : peer.displayName }),
        titleNode(peer, locale),
        h('p', { class: 'muted-note', text: meta.join(' · ') }),
      ),
    ),
    complementNode(complementLabel, complementNote),
    h(
      'dl',
      { class: 'preview-facts' },
      rows.flatMap((row) => [
        h('dt', { text: row.label }),
        h('dd', { text: row.hidden ? labels.hidden : row.value }),
      ]),
    ),
    topics.length > 0 ? h('div', { class: 'pill-row' }, topics.map((tag) => pill(tag, { tone: highlighted.has(tag) ? 'accent' : 'neutral' }))) : null,
    reason.length > 0
      ? h(
          'div',
          { class: 'preview-reason' },
          h('span', { class: 'muted-note', text: labels.why }),
          h('div', { class: 'pill-row' }, reason.map((tag) => pill(tag, { tone: 'accent-soft', selected: true }))),
        )
      : null,
  );
}

export function MatchWaitingPanel({ elapsedText, notice, criteria, backgroundHint = null, waitHint = null, relaxLabel = null, onRelax = null, relaxExpanded = false, cancelLabel = null, onCancel = null, cancelBusy = false, timeoutHint = null, demoLabel = null, onDemo = null }) {
  return h(
    'section',
    { class: 'card waiting-panel' },
    h('div', { class: 'breath-ring' }, icon('match', { size: 30 })),
    h('p', { class: 'waiting-title', text: notice }),
    h('p', { class: 'waiting-elapsed', text: elapsedText }),
    backgroundHint ? h('p', { class: 'muted-note waiting-background-hint', text: backgroundHint }) : null,
    waitHint ? h('p', { class: 'waiting-long-hint', attrs: { role: 'status' }, text: waitHint }) : null,
    criteria ? h('p', { class: 'muted-note', text: criteria }) : null,
    // 「放宽匹配条件」是可选能力：匹配页不再让用户选兴趣之后就不传 relaxLabel，这里不凭空多出一个按钮
    relaxLabel
      ? h(
          'button',
          {
            class: 'btn btn-secondary btn-block',
            type: 'button',
            attrs: { 'aria-expanded': relaxExpanded ? 'true' : 'false' },
            onClick: onRelax,
          },
          relaxLabel,
        )
      : null,
    // 出口放在这里：位置固定，下面超时兜底块出现时它不会被顶走
    cancelLabel
      ? h('button', { class: 'btn btn-quiet btn-block waiting-cancel', type: 'button', disabled: cancelBusy, attrs: { 'aria-busy': String(cancelBusy) }, onClick: onCancel }, cancelLabel)
      : null,
    timeoutHint
      ? h(
          'div',
          { class: 'waiting-timeout' },
          h('p', { class: 'muted-note', text: timeoutHint }),
          demoLabel ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: onDemo }, demoLabel) : null,
        )
      : null,
  );
}

/**
 * 自定义匹配条件。**当前没有任何调用点**：2026-09-29 起匹配页不再让用户选兴趣，
 * 「排队前闸门」与等待中的「放宽匹配条件」两个入口都已下线，组件保留给后续的筛选需求。
 * 下面是它自身的能力规格（当初的两种用法只是 `saveLabel` / `closeLabel` 取值不同）：
 *   - 不传 `closeLabel`：底部只有 `saveLabel` 一个按钮；
 *   - 传 `closeLabel`：多一颗「收起」，丢弃草稿、不改任何状态。
 * 它不是一次性开关，而是真的能改条件的地方。
 *
 * 两条通道并列在同一个面板里：
 *   1. 「随便聊」——一键把全部主题勾上（`onSelectAll`），等于不挑主题；全部勾上时它自己也高亮，
 *      所以用户能看出来现在是「都行」而不是「选了十几个」。
 *   2. 逐个勾选主题——想聊什么就挑什么。
 * 一个都没选时保存按钮禁用并给出提示：没有条件就没法按条件找人，要「都行」就点「随便聊」。
 */
export function MatchCriteriaEditor({
  title,
  hint = null,
  anyLabel,
  anyHint = null,
  options = [],
  value = [],
  selectedLabel = null,
  minHint = null,
  saveLabel,
  closeLabel,
  onToggle,
  onSelectAll,
  onSave,
  onClose,
}) {
  const selected = new Set(value);
  const allSelected = coversAllOptions(value, options.map((option) => option.value));
  const count = value.length;
  return h(
    'section',
    { class: 'card criteria-editor' },
    h('h3', { class: 'card-title', text: title }),
    hint ? h('p', { class: 'muted-note', text: hint }) : null,
    h(
      'button',
      {
        class: ['criteria-any', allSelected ? 'is-selected' : ''],
        type: 'button',
        attrs: { 'aria-pressed': allSelected ? 'true' : 'false' },
        onClick: onSelectAll,
      },
      h('span', { class: 'criteria-any-label', text: anyLabel }),
      anyHint ? h('small', { class: 'criteria-any-hint', text: anyHint }) : null,
    ),
    h(
      'div',
      { class: 'tag-picker-body' },
      options.map((option) => {
        const isSelected = selected.has(option.value);
        return h(
          'button',
          {
            class: ['pill', 'tone-accent-soft', isSelected ? 'is-selected' : ''],
            type: 'button',
            attrs: { 'aria-pressed': isSelected ? 'true' : 'false' },
            onClick: () => onToggle(option.value),
          },
          option.label,
        );
      }),
    ),
    h('small', {
      class: ['muted-note criteria-count', count === 0 ? 'is-warn' : ''],
      text: (selectedLabel ? selectedLabel + ' ' : '') + count + ' / ' + options.length,
    }),
    count === 0 && minHint ? h('p', { class: 'muted-note is-warn', text: minHint }) : null,
    h(
      'div',
      { class: 'criteria-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', disabled: count === 0, onClick: onSave }, saveLabel),
      // 不传 closeLabel = 不渲染「收起」，底部只剩保存一个出路
      closeLabel ? h('button', { class: 'btn btn-quiet', type: 'button', onClick: onClose }, closeLabel) : null,
    ),
  );
}

/** 剩余秒数低于这个值就进入紧急态（进度条与数字变红），提醒「要来不及了」。 */
export const URGENT_SECONDS = 3;

/**
 * 匹配成功后的「接受 / 不接受」细条弹窗（右上角，参考联机游戏的匹配确认）。
 *
 * 不接管全屏：玩家可以继续看当前页面，弹窗只是贴在右上角的一个细条。
 * 倒计时上限由 `totalSeconds` 决定（来自 settings.matchAcceptSeconds，现场可调）。
 * 到 0 之前必须做选择；到点由调用方按「不接受」处理（见 docs/07 的 Q-G12）。
 */
export function MatchAcceptToast({
  anonymousLabel = '匿名用户',
  peer = null,
  remaining = 0,
  totalSeconds = 10,
  title,
  hint = null,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}) {
  const total = Number(totalSeconds) > 0 ? Number(totalSeconds) : 1;
  const urgent = Number(remaining) <= URGENT_SECONDS;
  return h(
    'div',
    {
      class: ['match-toast', urgent ? 'is-urgent' : ''],
      // 提示语不上屏（细条要保持矮），改用可访问名：读屏会说清「超时会回到等待队列」
      attrs: { role: 'dialog', 'aria-live': 'assertive', 'aria-label': hint ?? title },
    },
    // 进度条的总时长写进 CSS 变量：动画一次跑完，秒数变化时只需改数字、不必重建 DOM
    h('span', { class: 'match-toast-bar', style: { '--toast-seconds': total + 's' } }),
    avatarNode(peer, 32),
    h(
      'div',
      { class: 'match-toast-body' },
      h('strong', { class: 'match-toast-title', text: title }),
      h('span', { class: 'match-toast-name', text: peer?.anonymous ? anonymousLabel : (peer?.displayName ?? '') }),
    ),
    h('span', { class: 'match-toast-count', text: String(remaining) }),
    h(
      'div',
      { class: 'match-toast-actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => onAccept?.(peer) }, acceptLabel),
      h(
        'button',
        { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => onDecline?.(peer) },
        declineLabel,
      ),
    ),
  );
}

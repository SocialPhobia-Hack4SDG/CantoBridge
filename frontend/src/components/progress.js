/**
 * 沉淀与结算组件：RewardCard / SessionFeedbackSheet / AchievementBadge /
 * AchievementWall / LeaderboardList / MockControlPanel / BuddyRequestList。
 */

import { splitBuddyRequests } from '../lib/logic.js';
import { PresetAvatar } from './avatars.js';
import { h, icon, pill } from '../lib/dom.js';

export function AchievementBadge({ name, hint, unlocked = true, isNew = false, onOpen = null, newLabel = '', statistics = '', statusLabel = '', equipped = false, busy = false }) {
  const tag = onOpen ? 'button' : 'div';
  return h(
    tag,
    {
      class: ['badge', unlocked ? 'is-unlocked' : 'is-locked', isNew ? 'is-new' : '', equipped ? 'is-equipped' : ''],
      type: onOpen ? 'button' : undefined,
      disabled: onOpen && (!unlocked || busy),
      attrs: { title: hint ?? '', 'aria-pressed': onOpen ? String(equipped) : undefined },
      onClick: onOpen ?? undefined,
    },
    h('span', { class: 'badge-medal', text: unlocked ? '★' : '☆' }),
    h('span', { class: 'badge-name', text: name }),
    isNew && newLabel ? h('span', { class: 'badge-new', text: newLabel }) : null,
    h('span', { class: 'badge-hint', text: hint ?? '' }),
    statistics ? h('small', { class: 'badge-statistics', text: statistics }) : null,
    statusLabel ? h('span', { class: 'badge-title-action', text: statusLabel }) : null,
  );
}

export function AchievementWall({ items = [], labels, onSelect = null }) {
  if (items.length === 0) return h('p', { class: 'muted-note', text: labels.empty });
  return h(
    'div',
    { class: 'badge-wall' },
    items.map((item) =>
      h(AchievementBadge, {
        name: item.name,
        hint: item.hint,
        unlocked: item.unlocked,
        isNew: item.isNew,
        newLabel: labels.new,
        onOpen: onSelect ? () => onSelect(item) : null,
        statistics: item.statistics,
        statusLabel: item.statusLabel,
        equipped: item.equipped,
        busy: item.busy,
      }),
    ),
  );
}

export function RewardCard({ durationText, cardsText, xpText, xpLabel, roleNote = null, hint = null }) {
  return h(
    'section',
    { class: 'card reward-card' },
    h('p', { class: 'reward-xp-label', text: xpLabel }),
    h('p', { class: 'reward-xp', text: xpText }),
    h(
      'div',
      { class: 'reward-rows' },
      h('div', { class: 'reward-row' }, h('span', { class: 'muted-note', text: durationText.label }), h('strong', { text: durationText.value })),
      h('div', { class: 'reward-row' }, h('span', { class: 'muted-note', text: cardsText.label }), h('strong', { text: cardsText.value })),
    ),
    roleNote ? h('p', { class: 'muted-note', text: roleNote }) : null,
    hint ? h('p', { class: 'muted-note', text: hint }) : null,
  );
}

export function SessionFeedbackSheet({
  options = [],
  value = [],
  onToggle,
  onSubmit,
  onSkip,
  onConnect,
  connectLabel,
  notNowLabel,
  question,
  title,
  skipLabel,
  submitLabel,
  requestState = 'none',
  pendingLabel = '',
  buddyLabel = '',
  feedbackPending = false,
  feedbackSaved = false,
  requestPending = false,
  sendingLabel = '',
}) {
  const selected = new Set(value);
  return h(
    'section',
    { class: ['card', 'feedback-sheet', 'is-request-' + requestState] },
    h('h3', { class: 'card-title', text: title }),
    h('div', { class: 'pill-row' }, options.map((option) => pill(option.label, {
      tone: 'accent-soft',
      selected: selected.has(option.value),
      onClick: () => { if (!feedbackPending && !feedbackSaved) onToggle(option.value); },
      disabled: feedbackPending || feedbackSaved,
    }))),
    h('p', { class: 'feedback-question', text: question }),
    requestState === 'none'
      ? h(
          'div',
          { class: 'feedback-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', disabled: requestPending, attrs: { 'aria-busy': String(requestPending) }, onClick: onConnect }, requestPending ? sendingLabel : connectLabel),
          h('button', { class: 'btn btn-secondary', type: 'button', disabled: requestPending || feedbackPending, onClick: onSkip }, notNowLabel),
        )
      : h('p', {
          class: 'muted-note buddy-request-state',
          text: requestState === 'buddy' ? buddyLabel : pendingLabel,
        }),
    h('button', { class: 'link-btn', type: 'button', disabled: feedbackPending || feedbackSaved || value.length === 0, attrs: { 'aria-busy': String(feedbackPending) }, onClick: onSubmit }, submitLabel),
  );
}

/**
 * 「我的伙伴」插槽：伙伴关系是双向的，所以三种状态都要看得见、点得动。
 *   1. 收到的申请 → 接受 / 拒绝
 *   2. 我发出的申请 → 撤回（等对方确认）
 *   3. 已连接的伙伴 → 解除
 */
export function BuddyRequestList({
  buddies = [],
  requests = [],
  labels,
  onAccept = null,
  onDecline = null,
  onCancel = null,
  onRemove = null,
  busyPeerId = null,
}) {
  const { incoming, outgoing } = splitBuddyRequests(requests);

  function buildRow(item, statusLabel, actions) {
    const name = item.label ?? item.peerId ?? '';
    return h(
      'div',
      { class: 'buddy-row', dataset: { peerId: item.peerId ?? '' } },
      h('span', { class: 'avatar' }, String(name).slice(0, 1).toUpperCase()),
      h('div', { class: 'buddy-row-main' }, h('strong', { text: name }), h('small', { class: 'muted-note', text: statusLabel })),
      h(
        'div',
        { class: 'buddy-actions' },
        actions.map((action) => h('button', {
          class: 'btn ' + action.className,
          type: 'button',
          disabled: busyPeerId !== null,
          attrs: { 'aria-busy': String(busyPeerId === item.peerId) },
          onClick: action.onClick,
        }, action.label)),
      ),
    );
  }

  function buildGroup(title, rows) {
    if (rows.length === 0) return null;
    return h('div', { class: 'buddy-slot-group' }, h('span', { class: 'buddy-slot-title', text: title }), rows);
  }

  if (incoming.length === 0 && outgoing.length === 0 && buddies.length === 0) {
    return h('div', { class: 'buddy-slot is-empty' }, h('p', { class: 'muted-note', text: labels.empty }));
  }

  return h(
    'div',
    { class: 'buddy-slot' },
    buildGroup(
      labels.incoming,
      incoming.map((item) =>
        buildRow(item, labels.pendingIn, [
          { label: labels.accept, className: 'btn-primary', onClick: () => onAccept?.(item.peerId) },
          { label: labels.decline, className: 'btn-secondary', onClick: () => onDecline?.(item.peerId) },
        ]),
      ),
    ),
    buildGroup(
      labels.outgoing,
      outgoing.map((item) =>
        buildRow(item, labels.pendingOut, [
          { label: labels.cancel, className: 'btn-secondary', onClick: () => onCancel?.(item.peerId) },
        ]),
      ),
    ),
    buildGroup(
      labels.connected,
      buddies.map((item) =>
        buildRow(item, labels.connectedHint, [
          { label: labels.remove, className: 'btn-secondary', onClick: () => onRemove?.(item.peerId) },
        ]),
      ),
    ),
  );
}

export function LeaderboardList({ rows = [], me = null, labels }) {
  return h(
    'div',
    { class: 'leaderboard' },
    h(
      'ol',
      { class: 'leaderboard-list' },
      rows.map((row) =>
        h(
          'li',
          { class: ['leaderboard-row', row.isMe ? 'is-me' : ''] },
          h('span', { class: 'rank', text: '#' + row.rank }),
          h(PresetAvatar, { avatarId: row.avatarId, frameId: row.frameId, anonymous: row.anonymous, size: 36 }),
          h('span', { class: 'row-name', text: row.name }),
          h('span', { class: 'row-value', text: row.primary }),
          row.secondary ? h('span', { class: 'row-secondary', text: row.secondary }) : null,
        ),
      ),
    ),
    me
      ? h(
          'div',
          { class: 'leaderboard-me' },
          h('span', { class: 'muted-note', text: labels.me }),
          h('strong', { text: '#' + me.rank }),
          h('span', { class: 'muted-note', text: me.primary }),
        )
      : null,
  );
}

export function MockControlPanel({ summary, groups = [], actions = [], links = [], onJump, onReset, t }) {
  return h(
    'section',
    { class: 'card mock-panel' },
    h('p', { class: 'muted-note', text: summary }),
    groups.map((group) =>
      h(
        'div',
        { class: 'mock-group' },
        h('span', { class: 'mock-group-title', text: group.label }),
        h(
          'div',
          { class: 'pill-row' },
          group.options.map((option) =>
            pill(option.label, {
              tone: 'accent-soft',
              selected: option.selected,
              onClick: () => group.onChange(option.value),
            }),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'mock-actions' },
      actions.map((action) => h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: action.onClick }, action.label)),
      h('button', { class: 'btn btn-danger btn-block', type: 'button', onClick: onReset }, t('dev.reset')),
    ),
    h(
      'div',
      { class: 'mock-group' },
      h('span', { class: 'mock-group-title', text: t('dev.jump') }),
      h('div', { class: 'pill-row' }, links.map((link) => pill(link.label, { onClick: () => onJump(link.to) }))),
    ),
  );
}

/**
 * 房间组件：RoomHeader / CallStage / AudioWaveform / CallControls /
 * TopicCard / TopicCardStack / PhraseChips。滑动手势统一走 lib/swipe.js（问答分页器共用同一套）。
 * 只做语音：这里没有任何摄像头相关的元素。
 */

import { PresetAvatar } from './avatars.js';
import { h, icon, pill } from '../lib/dom.js';
import { barHeights } from '../lib/audio.js';
import { attachSwipe } from '../lib/swipe.js';

const WAVE_BARS = 9;

export function AudioWaveform({ level = 0, active = true, bars = WAVE_BARS }) {
  const heights = barHeights(active ? level : 0, bars);
  return h(
    'div',
    { class: ['waveform', active ? 'is-active' : 'is-idle'], attrs: { 'aria-hidden': 'true' } },
    heights.map((height) => h('span', { class: 'wave', style: { height: Math.round(height * 100) + '%' } })),
  );
}

export function RoomHeader({ peerName, elapsedText, anonymous, statusLabel, statusTone = 'live', hostLabel = null, hostIntentLabel = null }) {
  return h(
    'header',
    { class: 'room-header' },
    h('span', { class: ['status-dot', 'tone-' + statusTone] }),
    h('span', { class: 'room-header-name', text: peerName }),
    anonymous ? pill('匿名', { tone: 'accent-soft' }) : null,
    // 房主标签是**自动**带上的（按房间模式派生），不是用户在房间里手动选的
    hostLabel && hostIntentLabel ? pill(hostLabel + ' · ' + hostIntentLabel, { tone: 'accent' }) : null,
    h('span', { class: 'room-header-meta' }, h('span', { text: elapsedText }), h('small', { text: statusLabel })),
  );
}

export function CallStage({ peer, compact = false, showIdentity = false, anonymousLabel = '匿名用户', interestLabels = [], emptyInterestsLabel = '', statusLabel, modeLabel = null, level = 0, active = true, warning = null, hint = null }) {
  const identity = peer?.anonymous ? anonymousLabel : (peer?.peerId ?? peer?.userId ?? peer?.displayName ?? anonymousLabel);
  return h(
    'section',
    { class: 'call-stage' + (compact ? ' is-compact' : '') },
    h(PresetAvatar, { avatarId: peer?.avatarId, frameId: peer?.frameId, anonymous: peer?.anonymous, size: compact ? 44 : 96 }),
    h('p', { class: 'call-status', text: showIdentity ? identity : statusLabel }),
    showIdentity
      ? (interestLabels.length ? h('div', { class: 'call-interests' }, interestLabels.map(label => pill(label, { tone: 'accent-soft' }))) : h('small', { class: 'call-interests-empty', text: emptyInterestsLabel }))
      : modeLabel ? pill(modeLabel, { tone: 'accent-soft' }) : null,
    h(AudioWaveform, { level, active }),
    warning ? h('p', { class: 'call-warning', text: warning }) : null,
    hint ? h('p', { class: 'muted-note', text: hint }) : null,
  );
}

export function CallControls({ muted, speakerOn, disabled = false, onToggleMute, onToggleSpeaker, onHangup, labels }) {
  return h(
    'div',
    { class: 'call-controls' },
    h(
      'button',
      {
        class: ['control-btn', muted ? 'is-off' : ''],
        type: 'button',
        disabled,
        attrs: { 'aria-label': labels.mic, 'aria-pressed': muted ? 'true' : 'false' },
        onClick: onToggleMute,
      },
      icon(muted ? 'micOff' : 'mic', { size: 20 }),
      h('small', { text: muted ? labels.muted : labels.mic }),
    ),
    h(
      'button',
      {
        class: ['control-btn', speakerOn ? '' : 'is-off'],
        type: 'button',
        attrs: { 'aria-label': labels.speaker, 'aria-pressed': speakerOn ? 'true' : 'false' },
        onClick: onToggleSpeaker,
      },
      icon('speaker', { size: 20 }),
      h('small', { text: speakerOn ? labels.speakerOn ?? labels.speaker : labels.speakerOff ?? labels.speaker }),
    ),
    h(
      'button',
      { class: 'control-btn is-danger', type: 'button', attrs: { 'aria-label': labels.hangup }, onClick: onHangup },
      icon('hangup', { size: 22 }),
      h('small', { text: labels.hangup }),
    ),
  );
}

export function TopicCard({ card, positionLabel, difficultyLabel, seenLabel = null, jyutpingLabel = 'Jyutping' }) {
  if (!card) return null;
  return h(
    'article',
    { class: 'topic-card', dataset: { cardId: card.id }, attrs: { role: 'group' } },
    h(
      'div',
      { class: 'topic-card-head' },
      h(
        'div',
        { class: 'topic-card-meta' },
        h('span', { class: 'muted-note', text: positionLabel }),
        // 「聊过了」：这张卡在本次会话里已经翻到过（翻回去还能看见，方便找回刚聊的内容）
        seenLabel ? pill(seenLabel, { tone: 'neutral' }) : null,
      ),
      pill(difficultyLabel, { tone: 'accent-soft' }),
    ),
    card.jyutping ? h('div', { class: 'topic-pronunciation' },
      h('small', { class: 'topic-jyutping-label', text: jyutpingLabel }),
      h('p', { class: 'topic-line is-jyutping', text: card.jyutping, attrs: { lang: 'yue-Latn' } })) : null,
    h('p', { class: 'topic-line is-yue', text: card.cantonese }),
    h('p', { class: 'topic-line is-mandarin', text: card.mandarin }),
    h('p', { class: 'topic-line is-english', text: card.english }),
  );
}

export function TopicCardStack({
  cards = [],
  index = 0,
  positionLabel,
  difficultyLabels = [],
  seenIds = [],
  seenLabel = null,
  jyutpingLabel = 'Jyutping',
  onSwipe,
  hint,
}) {
  if (cards.length === 0) return null;
  const current = cards[Math.max(0, Math.min(cards.length - 1, index))];
  const node = h(
    'div',
    { class: 'topic-stack' },
    hint ? h('p', { class: 'muted-note stack-hint', text: hint }) : null,
    h('div', { class: 'stack-body' }, h(TopicCard, {
      card: current,
      positionLabel: positionLabel,
      difficultyLabel: difficultyLabels[index] ?? '',
      seenLabel: seenIds.includes(current.id) ? seenLabel : null,
      jyutpingLabel,
    })),
  );
  const body = node.querySelector?.('.stack-body');
  if (body) attachSwipe(body, { onSwipe });
  return node;
}

export function PhraseChips({ phrases = [], savedIds = [], onPick, onSave, saveLabel, savedLabel, title }) {
  if (phrases.length === 0) return null;
  return h(
    'div',
    { class: 'phrase-block' },
    title ? h('p', { class: 'muted-note', text: title }) : null,
    h(
      'div',
      { class: 'phrase-list' },
      phrases.map((phrase, index) => {
        const id = phrase.cantonese + '|' + index;
        const saved = savedIds.includes(phrase.cantonese);
        return h(
          'div',
          { class: ['phrase-chip', saved ? 'is-saved' : ''] },
          onPick
            ? h('button', { class: 'phrase-text', type: 'button', onClick: () => onPick(phrase) }, phrase.cantonese)
            : h('span', { class: 'phrase-text', text: phrase.cantonese }),
          h(
            'button',
            {
              class: 'phrase-star',
              type: 'button',
              title: saved ? savedLabel : saveLabel,
              attrs: { 'aria-label': saved ? savedLabel : saveLabel, 'data-phrase': id },
              onClick: () => onSave(phrase),
            },
            icon(saved ? 'starFilled' : 'star', { size: 16 }),
          ),
        );
      }),
    ),
  );
}

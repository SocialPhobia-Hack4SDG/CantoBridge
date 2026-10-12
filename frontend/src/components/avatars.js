import { h } from '../lib/dom.js';
import { FRAMES, frameOf, ownedFrames } from '../data/frames.js';
import { AVATARS, avatarOf, ownedAvatars } from '../data/avatars.js';

export function PresetAvatar({ avatarId, frameId, anonymous = false, size = 48, label = '' }) {
  const avatar = avatarOf(anonymous ? 'neutral' : avatarId);
  const image = h('img', { class: 'avatar preset-avatar', src: avatar.src, alt: label, width: size, height: size, loading: 'lazy', attrs: { 'data-avatar': avatar.id } });
  const frame = frameOf(anonymous ? 'none' : frameId);
  if (frame.id === 'none') return image;
  return h('span', { class: 'framed-avatar avatar-with-badge', style: { '--avatar-size': size + 'px' }, attrs: { 'data-frame': frame.id } }, image,
    h('img', { class: 'avatar-badge', src: frame.src, alt: '', attrs: { 'aria-hidden': 'true' } }));
}

export function AvatarPicker({ value = 'neutral', wallet, t, initial = false, kind = 'avatar', avatarId = 'neutral', onChange }) {
  const frames = kind === 'frame';
  const owned = frames ? ownedFrames(wallet) : ownedAvatars(wallet);
  const items = frames ? FRAMES : initial ? AVATARS.filter(item => item.free) : AVATARS;
  return h('div', { class: 'avatar-picker', attrs: { role: 'group', 'aria-label': t(frames ? 'frame.choose' : 'avatar.choose') } },
    items.map(item => {
      const locked = !owned.includes(item.id);
      const selected = frames ? frameOf(value).id === item.id : avatarOf(value).id === item.id;
      return h('button', { class: 'avatar-option' + (selected ? ' is-selected' : '') + (locked ? ' is-locked' : ''), type: 'button', disabled: locked,
        attrs: { 'aria-pressed': String(selected), 'aria-label': t(item.labelKey) + (locked ? ' · ' + t('avatar.locked') : ''), [frames ? 'data-frame-option' : 'data-avatar-option']: item.id },
        onClick: () => { if (!locked) onChange(item.id); } },
        h(PresetAvatar, { avatarId: frames ? avatarId : item.id, frameId: frames ? item.id : undefined, size: 72 }),
        frames && item.id === 'none' ? h('strong', { text: t('frame.none') }) : null,
        selected ? h('span', { class: 'avatar-selection-check', attrs: { 'aria-hidden': 'true' }, text: '✓' }) : null,
        !frames && item.free ? null : h('small', { text: t(locked ? 'avatar.locked' : item.id === 'none' ? 'avatar.free' : 'shop.owned') }));
    }));
}

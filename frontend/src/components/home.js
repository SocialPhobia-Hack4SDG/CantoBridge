/**
 * 首页组件：HomeActionCard（唯一主 CTA）与 StatTile（轻量统计小块）。
 * 对应 docs/05 第 6 节。数据由页面从 viewModel 换算好再传进来。
 */

import { h, icon } from '../lib/dom.js';

export function HomeActionCard({ role, headline, ctaLabel, badge = null, onStart, hint = null }) {
  return h(
    'section',
    { class: ['home-action', 'role-' + role] },
    h('div', { class: 'home-action-art' }, icon(role === 'buddy' ? 'match' : 'mic', { size: 34 })),
    h('h2', { class: 'home-action-title', text: headline }),
    badge ? h('p', { class: 'home-action-badge', text: badge }) : null,
    hint ? h('p', { class: 'home-action-hint', text: hint }) : null,
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: onStart }, ctaLabel),
  );
}

export function StatTile({ label, value, hint = null, onOpen = null }) {
  const tag = onOpen ? 'button' : 'div';
  return h(
    tag,
    { class: 'stat-tile', type: onOpen ? 'button' : undefined, onClick: onOpen ?? undefined },
    h('span', { class: 'stat-value', text: value }),
    h('span', { class: 'stat-label', text: label }),
    hint ? h('span', { class: 'stat-hint', text: hint }) : null,
  );
}

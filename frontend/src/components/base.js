/**
 * 通用外壳与状态组件（对应 docs/05 第 6 节的 AppShell / TopBar / BottomNav /
 * StepProgress / LoadingSkeleton / EmptyState / ErrorState / FallbackBanner）。
 * 全部是纯展示组件：不进 state、不取数据，只吃 props。
 */

import { THEMES, themeLabelKey } from '../data/themes.js';
import { h, icon } from '../lib/dom.js';

const NAV_ITEMS = [
  { id: 'home', labelKey: 'nav.home', glyph: 'home', to: '/home' },
  { id: 'match', labelKey: 'nav.match', glyph: 'match', to: '/match' },
  { id: 'leaderboard', labelKey: 'nav.leaderboard', glyph: 'ranking', to: '/leaderboard' },
  { id: 'me', labelKey: 'nav.me', glyph: 'me', to: '/me' },
];

/**
 * `toast` 是**跨路由**的插槽：匹配成功的「接受 / 不接受」弹窗挂在这里，
 * 因此它在任何页面上都能弹出来（哪怕用户已经离开 /match）。
 */
export function AppShell({ children, notice = null, banner = null, topBar = null, nav = null, footer = null, immersive = false, toast = null }) {
  return h(
    'div',
    { class: ['app-frame', immersive ? 'is-immersive' : ''] },
    // notice 是外壳所有的一次性提示，banner 是页面自己的横幅，两者互不覆盖
    notice,
    banner,
    topBar,
    h('main', { class: 'app-main', attrs: { id: 'app-main' } }, children),
    footer,
    nav,
    toast,
  );
}

/**
 * 页头：返回 / 标题 / 右侧动作。
 * 传了 backLabel 就渲染成带文字的「退出」按钮（onboarding 用）：退出是有后果的动作，
 * 不能只靠一个 44px 的返回箭头——太小、也太容易和「上一步」混在一起。
 */
export function TopBar({ title, onBack, action = null, subtitle = null, backLabel = null, backHint = null, backAriaLabel = 'back' }) {
  return h(
    'header',
    { class: 'top-bar' },
    onBack
      ? backLabel
        ? h(
            'button',
            {
              class: 'exit-btn',
              type: 'button',
              attrs: { 'aria-label': backLabel, title: backHint ?? backLabel },
              onClick: onBack,
            },
            icon('back', { size: 16 }),
            h('span', { text: backLabel }),
          )
        : h('button', { class: 'icon-btn', type: 'button', attrs: { 'aria-label': backAriaLabel }, onClick: onBack }, icon('back', { size: 22 }))
      : h('span', { class: 'icon-btn is-ghost' }),
    h('div', { class: 'top-bar-title' }, h('span', { text: title }), subtitle ? h('small', { text: subtitle }) : null),
    action ?? h('span', { class: 'top-bar-spacer', attrs: { 'aria-hidden': 'true' } }),
  );
}

/**
 * 配色主题切换器：每套主题一张药丸（色点 + 主题全名），放在「我的」页的配色主题卡里。
 *
 * 点击后**自己把选中态刷上去**，不依赖调用方重渲染——配色是纯 CSS 变量，
 * 不该为了换个颜色让页面重新取数。任何入口都是同一个组件、同一组文案 key。
 */
export function ThemeSwitch({ value, onChange, t, owned = ['mint', 'warm'] }) {
  const buttons = new Map();
  let selected = value;

  function markSelected(next) {
    for (const [id, button] of buttons) {
      const isOn = id === next;
      if (isOn) button.classList.add('is-selected');
      else button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    }
  }

  return h(
    'span',
    {
      class: 'theme-switch',
      attrs: { role: 'group', 'aria-label': t('theme.title') },
    },
    THEMES.filter((id) => owned.includes(id)).map((id) => {
      const button = h(
        'button',
        {
          class: ['pill', 'tone-neutral', 'theme-option', 'theme-' + id, selected === id ? 'is-selected' : ''],
          type: 'button',
          attrs: { 'aria-pressed': selected === id ? 'true' : 'false', title: t(themeLabelKey(id)), 'data-theme-id': id },
          onClick: () => {
            if (id === selected) return;
            selected = id;
            markSelected(id);
            onChange?.(id);
          },
        },
        h('span', { class: 'theme-dot', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'theme-option-label', text: t(themeLabelKey(id)) }),
      );
      buttons.set(id, button);
      return button;
    }),
  );
}

export function BottomNav({ active, onNavigate, t }) {
  const buttons = [];
  let activeId = active;
  const nav = h(
    'nav',
    { class: 'bottom-nav', attrs: { 'aria-label': 'primary' } },
    h('span', { class: 'bottom-nav-indicator', attrs: { 'aria-hidden': 'true' } }),
    NAV_ITEMS.map((item) => {
      const button = h(
        'button',
        {
          class: ['nav-item', item.id === active ? 'is-active' : ''],
          type: 'button',
          onClick: () => {
            if (item.id !== activeId) onNavigate(item.to);
          },
        },
        icon(item.glyph, { size: 20 }),
        h('span', { text: t(item.labelKey) }),
      );
      buttons.push(button);
      return button;
    }),
  );
  nav.updateNav = ({ active: next, t: translate }) => {
    activeId = next;
    const index = Math.max(0, NAV_ITEMS.findIndex(item => item.id === next));
    nav.style.setProperty('--nav-index', String(index));
    buttons.forEach((button, i) => {
      if (i === index) button.classList.add('is-active'); else button.classList.remove('is-active');
      button.setAttribute('aria-current', i === index ? 'page' : 'false');
      const label = button.children[button.children.length - 1];
      if (label) label.textContent = translate('nav.' + NAV_ITEMS[i].id);
    });
  };
  nav.updateNav({ active, t });
  return nav;
}

export function StepProgress({ current, total = 3, label = null }) {
  const segments = [];
  for (let index = 1; index <= total; index += 1) {
    segments.push(h('span', { class: ['step-seg', index < current ? 'is-done' : '', index === current ? 'is-active' : ''] }));
  }
  return h('div', { class: 'step-progress' }, h('div', { class: 'step-track' }, segments), label ? h('small', { text: label }) : null);
}

export function LoadingSkeleton({ variant = 'card', rows = 3 }) {
  const items = [];
  for (let index = 0; index < rows; index += 1) items.push(h('div', { class: 'skeleton-row' }));
  return h('div', { class: ['skeleton', 'skeleton-' + variant], attrs: { 'aria-busy': 'true' } }, items);
}

export function EmptyState({ title, description = null, actionLabel = null, onAction = null }) {
  return h(
    'div',
    { class: 'state-block' },
    h('span', { class: 'state-glyph', text: '○' }),
    h('p', { class: 'state-title', text: title }),
    description ? h('p', { class: 'state-desc', text: description }) : null,
    actionLabel ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: onAction }, actionLabel) : null,
  );
}

export function ErrorState({ message, retryLabel = null, onRetry = null, secondaryLabel = null, onSecondary = null }) {
  return h(
    'div',
    { class: 'state-block is-error' },
    h('span', { class: 'state-glyph', text: '!' }),
    h('p', { class: 'state-title', text: message }),
    h(
      'div',
      { class: 'state-actions' },
      retryLabel ? h('button', { class: 'btn btn-primary', type: 'button', onClick: onRetry }, retryLabel) : null,
      secondaryLabel ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: onSecondary }, secondaryLabel) : null,
    ),
  );
}

export function FallbackBanner({ tone = 'info', message, actionLabel = null, onAction = null, onDismiss = null }) {
  return h(
    'div',
    { class: ['fallback-banner', 'is-' + tone], attrs: { role: 'status' } },
    h('span', { class: 'fallback-text', text: message }),
    actionLabel ? h('button', { class: 'link-btn', type: 'button', onClick: onAction }, actionLabel) : null,
    onDismiss ? h('button', { class: 'link-btn', type: 'button', onClick: onDismiss }, '×') : null,
  );
}

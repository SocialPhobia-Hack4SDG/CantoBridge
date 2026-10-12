/**
 * onboarding 三页用到的组件：RoleSelectCard / TagPicker / LevelSelector / PrivacyToggleList / QuestionPager。
 * 全部受控组件：值由页面持有，组件只回调 onChange。
 */

import { h, icon, pill } from '../lib/dom.js';
import { attachSwipe } from '../lib/swipe.js';

export function RoleSelectCard({ role, title, subtitle, selected = false, onSelect }) {
  return h(
    'button',
    {
      class: ['role-card', 'role-' + role, selected ? 'is-selected' : ''],
      type: 'button',
      attrs: { 'aria-pressed': selected ? 'true' : 'false' },
      onClick: () => onSelect(role),
    },
    h('span', { class: 'role-art' }, icon(role === 'buddy' ? 'match' : 'mic', { size: 28 })),
    selected ? h('span', { class: 'role-check', text: '✓' }) : null,
    h('strong', { class: 'role-title', text: title }),
    h('span', { class: 'role-subtitle', text: subtitle }),
  );
}

export function TagPicker({ tags = [], value = [], max = 5, onChange, countLabel = null, emptyLabel = null, custom = null, layout = 'tags' }) {
  if (custom) tags = tags.concat(value.filter((item) => !tags.some((tag) => tag.value === item)).map((item) => ({ value: item, label: item })));
  if (tags.length === 0 && !custom) {
    return h('p', { class: 'muted-note', text: emptyLabel ?? '' });
  }
  const selected = new Set(value);
  const full = value.length >= max;
  // capped 才是「不能再选」：单选时已经选了一项也还能换成别的
  const capped = full && max > 1;
  const picker = h(
    'div',
    { class: ['tag-picker', layout === 'rows' ? 'tag-picker-rows' : ''] },
    h(
      'div',
      { class: 'tag-picker-head' },
      countLabel ? h('small', { class: 'muted-note', text: countLabel }) : null,
      h('small', { class: ['muted-note', full && max > 1 ? 'is-warn' : ''], text: value.length + ' / ' + max }),
    ),
    h(
      'div',
      { class: 'tag-picker-body' },
      tags.map((tag) => {
        const isSelected = selected.has(tag.value);
        return h(
          'button',
          {
            class: ['pill', 'tone-accent-soft', isSelected ? 'is-selected' : '', !isSelected && capped ? 'is-disabled' : ''],
            type: 'button',
            disabled: !isSelected && capped,
            attrs: { 'aria-pressed': isSelected ? 'true' : 'false' },
            onClick: () => {
              // 超过上限时直接忽略，不依赖 disabled 属性（有些浏览器/自动化仍会派发点击）
              if (!isSelected && capped) return;
              if (isSelected) {
                onChange(value.filter((item) => item !== tag.value));
                return;
              }
              // 单选（max = 1）：点另一项就是换过去，不用「先取消再选」——手机上那是多余的一步
              if (max === 1) {
                onChange([tag.value]);
                return;
              }
              onChange(value.concat(tag.value).slice(0, max));
            },
          },
          tag.label,
        );
      }),
    ),
  );
  if (custom) {
    const message = h('small', { class: 'muted-note', attrs: { 'aria-live': 'polite' } });
    const counter = h('small', { class: 'muted-note', text: '0 / 10' });
    const input = h('input', { class: 'custom-tag-input', type: 'text', attrs: { 'aria-label': custom.label, placeholder: custom.hint } });
    const errorFor = () => {
      const text = input.value.trim();
      if ([...text].length > 10) return custom.long;
      if (!text) return custom.empty;
      if (/[\u0000-\u001f\u007f]/u.test(text)) return custom.invalid;
      if (max > 1 && value.length >= max) return custom.full;
      const existing = tags.find((tag) => tag.label === text || tag.value === text);
      if (value.includes(existing?.value ?? text)) return custom.duplicate;
      return '';
    };
    const validate = () => {
      const error = errorFor();
      counter.textContent = [...input.value.trim()].length + ' / 10';
      message.textContent = error;
      message.setAttribute('class', 'muted-note' + (error ? ' is-warn' : ''));
      input.setAttribute('aria-invalid', error ? 'true' : 'false');
      return error;
    };
    const add = () => {
      if (validate()) return;
      const text = input.value.trim();
      const existing = tags.find((tag) => tag.label === text || tag.value === text);
      onChange(max === 1 ? [existing?.value ?? text] : value.concat(existing?.value ?? text));
    };
    input.addEventListener('input', validate);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); add(); }
    });
    const editor = h('div', { class: 'custom-tag-editor', hidden: true }, input, counter, message,
      h('div', { class: 'custom-tag-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: add }, custom.add),
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onClick: () => { editor.hidden = true; trigger.focus?.(); } }, custom.cancel)));
    const trigger = h('button', { type: 'button', class: 'pill tone-accent-soft custom-tag-trigger', disabled: capped,
      onClick: () => { if (capped) return; editor.hidden = false; input.focus?.(); } }, '+ ' + custom.label);
    picker.querySelector('.tag-picker-body').appendChild(trigger);
    picker.appendChild(editor);
  }
  return picker;
}

export function LevelSelector({ levels = [], value = null, onChange }) {
  return h(
    'div',
    { class: 'level-selector' },
    levels.map((level) =>
      h(
        'button',
        {
          class: ['level-option', level.value === value ? 'is-selected' : ''],
          type: 'button',
          attrs: { 'aria-pressed': level.value === value ? 'true' : 'false' },
          onClick: () => onChange(level.value),
        },
        h('span', { class: 'level-name', text: level.label }),
        level.hint ? h('span', { class: 'level-hint', text: level.hint }) : null,
      ),
    ),
  );
}

export function PrivacyToggleList({ items = [], onChange }) {
  return h(
    'div',
    { class: 'privacy-list' },
    items.map((item) =>
      h(
        'div',
        { class: 'privacy-row' },
        h('span', { class: 'privacy-label', text: item.label }),
        h(
          'button',
          {
            class: ['switch', item.value ? 'is-on' : ''],
            type: 'button',
            role: 'switch',
            attrs: { 'aria-checked': item.value ? 'true' : 'false' },
            onClick: () => onChange(item.key, !item.value),
          },
          h('span', { class: 'switch-knob' }),
        ),
      ),
    ),
  );
}
/**
 * 问卷分页器：一屏只显示一道题，左右滑动（或点「上一项 / 下一项」）在题与题之间走。
 * 进度点会标出「已填写」的题（实心）与当前位置（主色），用户随时知道还剩几题。
 *
 * 末项那颗按钮有两种形态：
 *   - 传了 `onFinal` → 它变成**可点**的 `finalLabel`（不传则沿用 `nextLabel`），点一下直接收尾；
 *   - 没传 → 照旧置灰禁用（组件层的默认行为，不替调用方决定收尾动作）。
 * 无论哪种形态，**左右滑动都不触发收尾** —— 只有点按钮才会，避免误触。
 * 字段本身仍由 TagPicker / LevelSelector 渲染，这里只管分页与手势。
 */
export function QuestionPager({
  index = 0,
  total = 1,
  filled = [],
  counterLabel = null,
  prevLabel = null,
  nextLabel = null,
  finalLabel = null,
  hint = null,
  onPrev = null,
  onNext = null,
  onFinal = null,
  children = null,
}) {
  const safeIndex = Math.max(0, Math.min(total - 1, index));
  const isLast = safeIndex >= total - 1;
  const finalEnabled = isLast && typeof onFinal === 'function';
  const dots = [];
  for (let position = 0; position < total; position += 1) {
    dots.push(
      h('span', {
        class: [
          'question-dot',
          filled[position] ? 'is-filled' : '',
          position === safeIndex ? 'is-active' : '',
          position < safeIndex ? 'is-done' : '',
        ],
      }),
    );
  }
  const node = h(
    'div',
    { class: 'question-pager', dataset: { index: safeIndex, total } },
    h(
      'div',
      { class: 'question-progress' },
      h('div', { class: 'question-dots', attrs: { 'aria-hidden': 'true' } }, dots),
      counterLabel ? h('small', { class: 'question-counter', text: counterLabel }) : null,
    ),
    h('div', { class: 'question-body' }, children),
    h(
      'div',
      { class: 'question-nav' },
      h(
        'button',
        {
          class: 'btn btn-quiet question-nav-btn',
          type: 'button',
          disabled: safeIndex === 0,
          onClick: () => onPrev?.(),
        },
        icon('back', { size: 16 }),
        prevLabel,
      ),
      h(
        'button',
        {
          class: 'btn btn-quiet question-nav-btn',
          type: 'button',
          disabled: isLast && !finalEnabled,
          onClick: () => {
            if (finalEnabled) onFinal();
            else onNext?.();
          },
        },
        finalEnabled && finalLabel ? finalLabel : nextLabel,
        icon('next', { size: 16 }),
      ),
    ),
    hint ? h('p', { class: 'muted-note question-hint', text: hint }) : null,
  );
  const body = node.querySelector?.('.question-body');
  if (body) {
    attachSwipe(body, {
      onSwipe: (delta) => {
        if (delta > 0) onNext?.();
        else if (delta < 0) onPrev?.();
      },
    });
  }
  return node;
}

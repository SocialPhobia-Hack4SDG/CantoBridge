/**
 * 极简 DOM 构造器（零依赖、无构建步骤）。
 * 只在浏览器里使用；模块导入阶段不访问 document，因此可以在 Node 里做静态校验。
 */

function currentDocument() {
  const doc = globalThis.document;
  if (!doc) throw new Error('lib/dom.js 需要 document，只能在浏览器环境调用');
  return doc;
}

function applyProps(element, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      element.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
      continue;
    }
    if (key === 'text') {
      element.textContent = String(value);
      continue;
    }
    if (key === 'style' && typeof value === 'object') {
      for (const [name, raw] of Object.entries(value)) {
        if (raw === undefined || raw === null) continue;
        if (typeof element.style?.setProperty === 'function') element.style.setProperty(name, String(raw));
        else element.style[name] = String(raw);
      }
      continue;
    }
    if (key === 'dataset' && typeof value === 'object') {
      for (const [name, raw] of Object.entries(value)) {
        if (raw === undefined || raw === null) continue;
        element.dataset[name] = String(raw);
      }
      continue;
    }
    if (key === 'attrs' && typeof value === 'object') {
      for (const [name, raw] of Object.entries(value)) {
        if (raw === undefined || raw === null || raw === false) continue;
        element.setAttribute(name, String(raw));
      }
      continue;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (key === 'disabled' || key === 'checked' || key === 'hidden' || key === 'muted') {
      element[key] = Boolean(value);
      continue;
    }
    if (key === 'value') {
      element.value = value;
      continue;
    }
    element.setAttribute(key, String(value));
  }
}

function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false || child === true) continue;
    parent.appendChild(typeof child === 'object' ? child : currentDocument().createTextNode(String(child)));
  }
}

/**
 * 两种用法：
 *   h('div', { class: 'x' }, '文本')            建元素
 *   h(TopBar, { title: '首页' })                 调用组件函数（组件只需要一个 props 对象）
 */
export function h(tag, props, ...children) {
  if (typeof tag === 'function') {
    if (children.length > 0) {
      throw new Error('组件函数只接受一个 props 对象，请把子节点放进 props.children');
    }
    return tag(props ?? {});
  }
  const element = currentDocument().createElement(tag);
  applyProps(element, props);
  appendChildren(element, children);
  return element;
}

export function frag(...children) {
  const fragment = currentDocument().createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

export function icon(name, { size = 24, className = 'icon' } = {}) {
  const sheet = globalThis.CANTOBRIDGE_ICONS ?? {};
  const node = h('span', { class: className, 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px' } });
  node.dataset.icon = name;
  node.textContent = sheet[name] ?? ICON_GLYPHS[name] ?? '';
  return node;
}

/** 图标统一用文本字形，避免引入图标库与字体文件；如需换成 SVG 只改这一处。 */
export const ICON_GLYPHS = {
  home: '◉',
  match: '◎',
  ranking: '▤',
  me: '☺',
  back: '‹',
  check: '✓',
  star: '☆',
  starFilled: '★',
  mic: '●',
  micOff: '○',
  speaker: '▲',
  hangup: '×',
  next: '›',
};

export function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

export function mount(element, node) {
  clear(element);
  if (node === undefined || node === null || node === false) return element;
  if (Array.isArray(node)) appendChildren(element, node);
  else if (node && typeof node === 'object') element.appendChild(node);
  else element.appendChild(currentDocument().createTextNode(String(node)));
  return element;
}

export function qs(root, selector) {
  return typeof root.querySelector === 'function' ? root.querySelector(selector) : null;
}
/** 药丸标签（Chip）是全站最常用的原子件，放在这里避免各组件重复实现。 */
export function pill(label, { tone = 'neutral', selected = false, onClick = null, title = null, disabled = false } = {}) {
  const tag = onClick ? 'button' : 'span';
  return h(
    tag,
    {
      class: ['pill', 'tone-' + tone, selected ? 'is-selected' : ''],
      type: onClick ? 'button' : undefined,
      disabled: onClick && disabled,
      attrs: onClick ? { ...(title ? { title } : {}), 'aria-pressed': String(selected) } : title ? { title } : undefined,
      onClick: onClick ?? undefined,
    },
    label,
  );
}

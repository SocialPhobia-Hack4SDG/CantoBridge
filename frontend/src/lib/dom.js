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

// Local SVG paths share a viewBox and inherit the active theme's text color.
const ICON_PATHS = {
  home: 'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7',
  match: 'M4 4h12v9H9l-5 4Z M18 8h3v12l-5-4h-4',
  ranking: 'M4 20V12h5v8 M9 20V4h6v16 M15 20v-9h5v9 M2 20h20',
  me: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  back: 'm15 5-7 7 7 7', next: 'm9 5 7 7-7 7', check: 'm5 12 4 4L19 6',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  starFilled: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0Z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
  micOff: 'm3 3 18 18 M9 5a3 3 0 0 1 6 1v5 M9 10v2a3 3 0 0 0 4 2.8 M5 10v2a7 7 0 0 0 11 5.7 M19 10v2 M12 19v3 M8 22h8',
  speaker: 'M3 9h4l5-4v14l-5-4H3Z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',
  hangup: 'M3 15v-4a17 17 0 0 1 18 0v4h-5v-3a12 12 0 0 0-8 0v3Z',
  tram: 'M7 3h10l2 3v13H5V6Z M5 11h14 M12 3v8 M8 15h1 M15 15h1 M8 19l-2 3 M16 19l2 3 M9 1h6',
};

export function icon(name, { size = 24, className = 'icon' } = {}) {
  const node = h('span', { class: className, 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px' } });
  node.dataset.icon = name;
  const doc = currentDocument();
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '100%', height: '100%', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false' })) svg.setAttribute(key, value);
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[name] ?? ICON_PATHS.match);
  if (name === 'starFilled') path.setAttribute('fill', 'currentColor');
  svg.appendChild(path); node.appendChild(svg);
  return node;
}

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

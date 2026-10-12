/**
 * 极小的 DOM stub：只实现组件渲染用到的那部分 API。
 * 目的不是替代浏览器，而是让「组件到底渲染出了什么」可以在 Node 里断言。
 */

class StubClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return (this.element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }

  add(name) {
    const next = new Set(this.values());
    next.add(name);
    this.element.setAttribute('class', [...next].join(' '));
  }

  remove(name) {
    const next = new Set(this.values());
    next.delete(name);
    this.element.setAttribute('class', [...next].join(' '));
  }

  contains(name) {
    return this.values().includes(name);
  }
}

export class StubElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.ownText = '';
    const props = {};
    this.style = {
      props,
      setProperty(name, value) {
        props[name] = String(value);
      },
      removeProperty(name) {
        delete props[name];
      },
    };
    this._classList = new StubClassList(this);
  }

  get classList() {
    return this._classList;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    return child;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  set textContent(value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.ownText = String(value);
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set innerHTML(value) {
    this.ownText = String(value);
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] ?? []) handler({ target: this, ...event });
  }

  click() {
    this.dispatch('click');
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  walk() {
    const out = [this];
    for (const child of this.children) out.push(...child.walk());
    return out;
  }

  querySelector(selector) {
    return this.walk().slice(1).find((node) => matches(node, selector)) ?? null;
  }

  querySelectorAll(selector) {
    return this.walk().slice(1).filter((node) => matches(node, selector));
  }
}

export class StubTextNode {
  constructor(value) {
    this.tagName = '#text';
    this.ownText = String(value);
    this.children = [];
    this.parentNode = null;
  }

  get textContent() {
    return this.ownText;
  }

  set textContent(value) {
    this.ownText = String(value);
  }

  get classList() {
    return { values: () => [], add: () => {}, remove: () => {}, contains: () => false };
  }

  walk() {
    return [this];
  }

  getAttribute() {
    return null;
  }

  closest() {
    return null;
  }
}

export class StubDocumentFragment extends StubElement {
  constructor() {
    super('#fragment');
  }
}

function matches(node, selector) {
  const tokens = String(selector).trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (!matchesSimple(node, last)) return false;
  let ancestor = node.parentNode;
  for (let index = tokens.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesSimple(ancestor, tokens[index])) ancestor = ancestor.parentNode;
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

function matchesSimple(node, token) {
  if (!node || typeof node.tagName !== 'string' || node.tagName === '#text') return false;
  if (token.startsWith('[')) return node.getAttribute(token.slice(1, -1)) !== null;
  if (token.includes('.')) {
    const parts = token.split('.').filter(Boolean);
    const tagPart = token.startsWith('.') ? null : parts.shift();
    if (tagPart && node.tagName !== tagPart.toUpperCase()) return false;
    return parts.every((className) => node.classList.contains(className));
  }
  return node.tagName === token.toUpperCase();
}

export function installDom() {
  const document = {
    // <html>：主题切换靠 <html data-theme>，所以要有一个可以被断言的根元素
    documentElement: new StubElement('html'),
    createElement: (tag) => new StubElement(tag),
    createTextNode: (value) => new StubTextNode(value),
    createElementNS: (_namespace, tag) => new StubElement(tag),
    createDocumentFragment: () => new StubDocumentFragment(),
    getElementById: () => null,
    addEventListener: () => {},
  };
  globalThis.document = document;
  globalThis.window = globalThis.window ?? { addEventListener: () => {} };
  return document;
}

/** 收集子树里的纯文本，断言用。 */
export function textOf(node) {
  return node ? node.textContent : '';
}

/** 按 class 取元素，断言用。 */
export function findAll(root, selector) {
  return root.querySelectorAll(selector);
}
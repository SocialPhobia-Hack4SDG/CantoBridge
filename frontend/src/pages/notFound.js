/**
 * 兜底页：任何迷路都不出现空白页。
 */

import { definePage } from '../app/page.js';
import { h } from '../lib/dom.js';

export const NotFoundPage = definePage({
  name: 'NotFoundPage',
  titleKey: 'notFound.title',

  render(ctx) {
    const t = ctx.t;
    return h(
      'section',
      { class: 'stack' },
      h('h1', { class: 'page-title', text: t('notFound.title') }),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => ctx.navigate('/') }, t('notFound.action')),
      ctx.win.history.length > 1
        ? h('button', { class: 'btn btn-secondary btn-block', type: 'button', onClick: () => ctx.win.history.back() }, t('action.back'))
        : null,
    );
  },
});

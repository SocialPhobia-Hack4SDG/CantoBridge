/**
 * 落地页：3 秒讲清这是什么，并把用户推进身份选择。
 * 首屏文案立即渲染，不等任何异步数据；插画用纯 CSS 画，不依赖图片与字体文件。
 */

import { definePage } from '../app/page.js';
import { FallbackBanner } from '../components/base.js';
import { h, pill } from '../lib/dom.js';

export const LandingPage = definePage({
  name: 'LandingPage',
  titleKey: 'app.slogan',

  render(ctx) {
    const t = ctx.t;
    return h(
      'section',
      { class: 'landing' },
      h('img', { class: 'landing-logo', src: '/assets/branding/logo.png', alt: t('app.name'), width: 180, height: 180 }),
      h('h1', { class: 'landing-slogan', text: t('app.slogan') }),
      h(
        'div',
        { class: 'landing-art', attrs: { 'aria-hidden': 'true' } },
        h('span', { class: 'art-dot is-left' }),
        h('span', { class: 'art-bridge' }),
        h('span', { class: 'art-dot is-right' }),
      ),
      h(
        'ul',
        { class: 'landing-cards' },
        h(
          'li',
          { class: 'card ability-card' },
          h('strong', { text: t('landing.card1Title') }),
          h('span', { class: 'muted-note', text: t('landing.card1Desc') }),
        ),
        h(
          'li',
          { class: 'card ability-card' },
          h('strong', { text: t('landing.card2Title') }),
          h('span', { class: 'muted-note', text: t('landing.card2Desc') }),
        ),
      ),
      h(
        'div',
        { class: 'landing-actions' },
        h('div', { class: 'landing-language' },
          h('p', { class: 'muted-note', text: '简体中文 / 繁體中文 / English' }),
          h('div', { class: 'lang-switch', attrs: { role: 'group', 'aria-label': 'Choose language' } },
            [['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['en', 'English']].map(([locale, label]) => pill(label, {
              tone: (ctx.locale ?? ctx.store?.getState().locale) === locale ? 'accent' : 'neutral',
              selected: (ctx.locale ?? ctx.store?.getState().locale) === locale,
              onClick: () => { if (ctx.store.getState().locale !== locale) ctx.store.setLocale(locale); },
            })))),
        // 只有一个入口：开始使用 → **注册**。**不再有「我是粤语母语者，想帮手」这条捷径**：
        // 身份在注册之后自己选，落地页不预设、也不分流。
        // 先过注册页而不是直接进身份选择：账号是用户点「注册」那一刻才建出来的，
        // 落地页与注册页都不预登录（见 app.js 的 PRE_AUTH_ROUTES）。
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => ctx.navigate('/register') }, t('landing.getStarted')),
      ),
    );
  },

  afterPaint(ctx) {
    // 缺 key 的语言包不显示裸 key，而是回退英文并挂横幅说明
    const missing = ctx.view.missingKeys ?? [];
    if (missing.length > 0) {
      ctx.setBanner(FallbackBanner({ tone: 'warning', message: ctx.t('state.offlineData') }));
    }
  },
});

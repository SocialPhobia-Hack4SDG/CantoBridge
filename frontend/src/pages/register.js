/**
 * 注册页（RegisterPage）：把「账号」做成用户真的按下去的一步。
 *
 * 为什么需要它：账号是按设备长出来的（契约 4.1.1），但以前是 app 一启动就默默建好，
 * 用户从头到尾没按过任何「注册」——落地页点「开始使用」就直接进身份选择了。
 * 这一页把那一刻显式化，同时承担「同一台手机换人用」的入口：
 *
 *   - 本机没注册过 → 「注册」→ 真去建号（`auth.ensure()`）→ 身份选择；
 *   - 本机注册过   → 默认「继续使用」（回首页），另有「换个人用」把本机账号退掉重来。
 *
 * **点「注册」才建号**：本页与落地页都不预登录（见 app.js 的 `PRE_AUTH_ROUTES`）。
 * 所以「本机注册过没有」只能看本机存档，不能靠服务端回答——两台设备本来就是两个
 * 账号，这个问题只对本机有意义。
 */

import { definePage } from '../app/page.js';
import { h } from '../lib/dom.js';

export const RegisterPage = definePage({
  name: 'RegisterPage',
  titleKey: 'register.title',

  render(ctx, view) {
    const t = ctx.t;
    // 只活在这一页：按钮点下去之后的等待态与失败态
    const local = (view.local ??= { pending: false, failed: false, confirming: false });
    const state = ctx.getState();
    // 任一身份走完过 onboarding 就算这台设备注册过——账号只有一份，身份有两份。
    const registered = state.learnerProfile?.onboarded === true || state.buddyProfile?.onboarded === true;

    /**
     * 收口「点下去 → 等待 → 成功跳走 / 失败留在原地」这一套。
     * `to` 为 null 表示动作自己负责落点（退出由 app 层统一回落地页）。
     */
    async function run(action, to) {
      local.pending = true;
      local.failed = false;
      ctx.paint();
      try {
        await action();
        if (to) ctx.navigate(to);
      } catch {
        // 失败不跳走：按钮留在原地可以重试，否则用户会以为是页面坏了
        local.pending = false;
        local.failed = true;
        ctx.paint();
      }
    }

    const primary = registered
      ? h(
          'button',
          {
            class: 'btn btn-primary btn-block',
            type: 'button',
            disabled: local.pending,
            attrs: { 'aria-busy': String(local.pending) },
            onClick: () => run(() => ctx.auth.ensure(), '/home'),
          },
          local.pending ? t('register.pending') : t('register.continue'),
        )
      : h(
          'button',
          {
            class: 'btn btn-primary btn-block',
            type: 'button',
            disabled: local.pending,
            attrs: { 'aria-busy': String(local.pending) },
            onClick: () => run(() => ctx.auth.ensure(), '/onboarding/role'),
          },
          local.pending ? t('register.pending') : t('register.submit'),
        );

    return h(
      'section',
      { class: 'stack' },
      h('h1', { class: 'page-title', text: t('register.title') }),
      h('p', { class: 'muted-note', text: t('register.intro') }),
      // `.card` 本身只是内边距，竖排间距靠 `.field`（flex column + gap）撑开
      h(
        'div',
        { class: 'card field' },
        h('strong', { text: registered ? t('register.registered') : t('register.fresh') }),
        registered ? h('small', { class: 'muted-note', text: t('register.registeredHint') }) : null,
      ),
      primary,
      // 「换个人用」是个有后果的动作（本机账号会被清掉），所以做成安静按钮并放在主按钮下面，
      // 不跟「继续使用」抢视线；展开后必须再次确认，避免误触清掉本机账号。
      registered && local.confirming
        ? h(
            'div',
            { class: 'card field account-confirm' },
            h('small', { class: 'muted-note is-warn', text: t('account.signOutHint') }),
            h('button', { class: 'btn btn-danger btn-block', type: 'button', disabled: local.pending, attrs: { 'aria-busy': String(local.pending) }, onClick: () => run(() => ctx.auth.signOut(), null) }, t('account.confirmYes')),
            h('button', { class: 'btn btn-quiet btn-block', type: 'button', disabled: local.pending, onClick: () => { local.confirming = false; ctx.paint(); } }, t('action.cancel')),
          )
        : registered
          ? h('button', { class: 'btn btn-quiet btn-block', type: 'button', disabled: local.pending, onClick: () => { local.confirming = true; ctx.paint(); } }, t('register.switchAccount'))
        : null,
      local.failed ? h('p', { class: 'muted-note is-warn', text: t('register.failed') }) : null,
      h('small', { class: 'muted-note', text: t('register.note') }),
    );
  },
});

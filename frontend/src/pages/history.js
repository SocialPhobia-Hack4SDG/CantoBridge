/**
 * 连线记录：倒序列表 + 只看我的伙伴 + 展开聊过的话题。
 *
 * 每一行的「伙伴状态」由 buddies + buddyRequests 推导（见 lib/logic.js 的 buddyRelation），
 * 历史记录本身不再存布尔值，避免出现「记录说已保存、伙伴表里却没有」的脱节。
 */

import { definePage } from '../app/page.js';
import { EmptyState, ErrorState, FallbackBanner, LoadingSkeleton } from '../components/base.js';
import { h, icon, pill } from '../lib/dom.js';
import { uniqueList } from '../lib/logic.js';
import { historyRows } from '../lib/viewModel.js';
export const HistoryPage = definePage({
  name: 'HistoryPage',
  titleKey: 'history.title',

  async load(ctx) {
    const [history, buddies, requests] = await Promise.all([
      ctx.api.getHistory(),
      ctx.api.listBuddies(),
      ctx.api.listBuddyRequests(),
    ]);
    ctx.view.local = { buddyOnly: false, expanded: null };
    return { history, buddies, requests };
  },

  render(ctx, view) {
    const t = ctx.t;
    if (view.loading) return h(LoadingSkeleton, { variant: 'list', rows: 3 });
    if (view.error) return h(ErrorState, { message: t('state.failed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() });
    const local = view.local;
    const rows = historyRows(view.data?.history ?? [], {
      buddies: view.data?.buddies ?? [],
      requests: view.data?.requests ?? [],
      buddyOnly: local.buddyOnly,
    });

    /** 伙伴状态 -> 文案。写成显式分支，让静态检查也能确认这四个 key 存在。 */
    function stateLabel(state) {
      if (state === 'buddy') return t('buddy.connected');
      if (state === 'pending-out') return t('buddy.pendingOut');
      if (state === 'pending-in') return t('buddy.pendingIn');
      return t('buddy.request');
    }

    /** 每行可点的伙伴动作：不同状态给的按钮不一样。 */
    function stateActions(row) {
      if (row.buddyState === 'buddy') return [{ label: t('buddy.remove'), method: 'removeBuddy' }];
      if (row.buddyState === 'pending-out') return [{ label: t('buddy.cancel'), method: 'cancelBuddyRequest' }];
      if (row.buddyState === 'pending-in') {
        return [
          { label: t('buddy.accept'), method: 'acceptBuddyRequest' },
          { label: t('buddy.decline'), method: 'declineBuddyRequest' },
        ];
      }
      return [{ label: t('buddy.request'), method: 'sendBuddyRequest' }];
    }

    async function runAction(row, method) {
      if (local.pendingAction) return;
      local.pendingAction = row.sessionId + ':' + method;
      local.actionError = false;
      ctx.paint();
      try {
        if (method === 'sendBuddyRequest') await ctx.api.sendBuddyRequest(row.peerId, row.peerLabel);
        else await ctx.api[method](row.peerId);
      } catch {
        local.pendingAction = null;
        local.actionError = true;
        ctx.paint();
        return;
      }
      ctx.reload();
    }

    return h(
      'section',
      { class: 'stack' },
      h(
        'div',
        { class: 'segment' },
        pill(t('history.onlyBuddies'), {
          tone: local.buddyOnly ? 'accent' : 'neutral',
          selected: local.buddyOnly,
          onClick: () => {
            local.buddyOnly = !local.buddyOnly;
            ctx.paint();
          },
        }),
      ),
      local.actionError ? h(FallbackBanner, { tone: 'warning', message: t('state.offlineData') }) : null,
      rows.length === 0
        ? h(EmptyState, { title: t('history.empty'), actionLabel: t('action.back'), onAction: () => ctx.navigate('/me') })
        : h(
            'div',
            { class: 'list-block' },
            rows.map((row) =>
              h(
                'div',
                { class: 'card history-row' },
                h(
                  'div',
                  { class: 'history-head' },
                  h('strong', { text: row.peerLabel ?? row.peerId }),
                  h('small', { class: 'muted-note', text: row.when }),
                ),
                h(
                  'div',
                  { class: 'pill-row' },
                  pill(t(row.durationKey, row.durationVars), { tone: 'neutral' }),
                  pill(t('summary.topics') + ' ' + String(row.cardsUsed ?? 0), { tone: 'neutral' }),
                  pill(stateLabel(row.buddyState), {
                    tone: row.buddyState === 'buddy' ? 'accent-soft' : 'neutral',
                  }),
                ),
                local.expanded === row.sessionId
                  ? h('div', { class: 'pill-row' }, uniqueList(row.topics).map((topic) => pill(topic, { tone: 'accent-soft' })))
                  : null,
                h(
                  'div',
                  { class: 'row-actions' },
                  h(
                    'button',
                    {
                      class: 'link-btn',
                      type: 'button',
                      onClick: () => {
                        local.expanded = local.expanded === row.sessionId ? null : row.sessionId;
                        ctx.paint();
                      },
                    },
                    t('history.topics'),
                  ),
                  stateActions(row).map((action) =>
                    h(
                      'button',
                      {
                        class: 'link-btn history-buddy-action',
                        type: 'button',
                        disabled: Boolean(local.pendingAction),
                        attrs: { 'aria-busy': String(local.pendingAction === row.sessionId + ':' + action.method) },
                        onClick: () => void runAction(row, action.method),
                      },
                      h(
                        'span',
                        { class: 'history-star' },
                        icon(row.buddyState === 'buddy' ? 'starFilled' : 'star', { size: 16 }),
                        ' ',
                        action.label,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
    );
  },
});

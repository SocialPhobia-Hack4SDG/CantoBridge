/**
 * 排行榜：周榜 / 月榜 × 学习者榜 / 伙伴榜，自己那一行吸底固定。
 */

import { definePage } from '../app/page.js';
import { ErrorState, LoadingSkeleton } from '../components/base.js';
import { LeaderboardList } from '../components/progress.js';
import { h, pill } from '../lib/dom.js';
export const LeaderboardPage = definePage({
  name: 'LeaderboardPage',
  titleKey: 'leaderboard.title',

  async load(ctx) {
    const [weeklyLearners, weeklyBuddies, monthlyLearners, monthlyBuddies] = await Promise.all([
      ctx.api.getLeaderboard('weekly', 'learner'),
      ctx.api.getLeaderboard('weekly', 'buddy'),
      ctx.api.getLeaderboard('monthly', 'learner'),
      ctx.api.getLeaderboard('monthly', 'buddy'),
    ]);
    ctx.view.local = { period: 'weekly', role: 'learner' };
    return { weekly: { learner: weeklyLearners, buddy: weeklyBuddies }, monthly: { learner: monthlyLearners, buddy: monthlyBuddies } };
  },

  render(ctx, view) {
    const t = ctx.t;
    if (view.loading) return h(LoadingSkeleton, { variant: 'list', rows: 5 });
    if (view.error) return h(ErrorState, { message: t('state.failed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() });
    const local = view.local;
    const rows = (view.data?.[local.period]?.[local.role] ?? []).slice(0, 30);
    const mapped = rows.map((row) => ({
      ...row,
      name: row.anonymous ? t('anonymous.label') : row.userId,
      primary: t('duration.minutes', { minutes: row.minutes }),
      secondary: row.xp + ' XP',
    }));
    const me = mapped.find((row) => row.isMe) ?? null;

    return h(
      'section',
      { class: 'stack' },
      h(
        'div',
        { class: 'segment' },
        ['weekly', 'monthly'].map((period) =>
          pill(t('leaderboard.' + period), {
            tone: local.period === period ? 'accent' : 'neutral',
            selected: local.period === period,
            onClick: () => {
              if (local.period === period) return;
              local.period = period;
              ctx.paint();
            },
          }),
        ),
      ),
      h(
        'div',
        { class: 'segment' },
        [
          { id: 'learner', key: 'leaderboard.learners' },
          { id: 'buddy', key: 'leaderboard.buddies' },
        ].map((tab) =>
          pill(t(tab.key), {
            tone: local.role === tab.id ? 'accent' : 'neutral',
            selected: local.role === tab.id,
            onClick: () => {
              if (local.role === tab.id) return;
              local.role = tab.id;
              ctx.paint();
            },
          }),
        ),
      ),
      mapped.length === 0
        ? h('p', { class: 'leaderboard-empty-rule', text: t('leaderboard.empty') })
        : h(LeaderboardList, { rows: mapped, me, labels: { me: t('leaderboard.me') } }),
    );
  },
});

import { xpFor } from './logic.js';

// Calendar weeks start on Monday; both windows use Hong Kong time.
export function leaderboardStats(history, role, period, now) {
  const offset = 8 * 60 * 60 * 1000;
  const date = new Date(now + offset);
  let start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  start = period === 'monthly' ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    : start - ((date.getUTCDay() + 6) % 7) * 86400000;
  start -= offset;
  let seconds = 0; let xp = 0;
  for (const entry of history) {
    const timestamp = Date.parse(entry.startedAt);
    if (entry.role !== role || !Number.isFinite(timestamp) || timestamp < start || timestamp > now) continue;
    const duration = Math.max(0, Number(entry.durationSec) || 0);
    seconds += duration;
    xp += xpFor(duration, Math.max(0, Number(entry.cardsUsed) || 0));
  }
  return { seconds, minutes: Math.round(seconds / 60 * 10) / 10, xp };
}

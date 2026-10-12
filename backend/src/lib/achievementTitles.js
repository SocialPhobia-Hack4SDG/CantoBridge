import { ACHIEVEMENT_RULES, unlockedAchievements } from './scoring.js';

export function earnedTitles(progress = {}) {
  return [...new Set([...unlockedAchievements('learner', progress), ...unlockedAchievements('buddy', progress)])];
}

export function publicTitle(db, accountId) {
  const id = db.getSettings(accountId)?.equippedTitleId ?? null;
  return id && earnedTitles(db.getProgress(accountId) ?? {}).includes(id) ? id : null;
}

export function achievementStatistics(db) {
  const users = db.listUsers();
  const counts = Object.fromEntries(ACHIEVEMENT_RULES.map(rule => [rule.id, 0]));
  for (const user of users) {
    for (const id of earnedTitles(db.getProgress(user.userId) ?? {})) counts[id]++;
  }
  return Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, {
    count, totalUsers: users.length,
    percentage: Math.max(0.01, users.length ? Math.round(count / users.length * 10000) / 100 : 0),
  }]));
}

/**
 * 匹配纯函数：与前端 `frontend/src/lib/logic.js` **逐行同源**。
 *
 * 为什么后端要再写一份：排序与百分比是**服务端算完下发**的（契约 4.4 节：
 * 「匿名与可见范围由服务端裁剪」「两边排的是同一批候选、同一套排序键」），
 * 后端不能依赖前端源码目录。一致性由 `tests/matching.test.mjs` 钉住：
 * 同一组输入下，两边的 `matchScore` / `matchRank` 必须给出同一个数。
 */

export const COMPLEMENT_BOOST = 8;

/**
 * 学习者的「想练什么」恒为粤语——这是**看的人**的 wantToLearn，
 * 不是这位学习者的回礼。于是每位粤语母语者拿到的加成一样，
 * 首页推荐块的最终顺序仍是 `matchScore` 降序（与前端 mock 一致）。
 */
export const LEARNER_WANT_TO_LEARN = ['yue'];

export function uniqueList(values) {
  const seen = new Set();
  const out = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sharedTags(a, b) {
  const right = new Set(b ?? []);
  return uniqueList(a ?? []).filter((tag) => right.has(tag));
}

/**
 * 匹配度：共同标签占「较小标签集（上限 4）」的比例，映射到 40 ~ 95。
 * 没有共同标签时给 40，避免出现 0% 让人以为匹配失败。
 */
export function matchScore(myTags, peerTags) {
  const mine = uniqueList(myTags);
  const theirs = uniqueList(peerTags);
  const shared = sharedTags(mine, theirs).length;
  const denominator = Math.max(1, Math.min(mine.length, theirs.length, 4));
  const score = 40 + Math.round((shared / denominator) * 55);
  return Math.max(40, Math.min(95, score));
}

/** 这位伙伴的母语里，有没有我想练的（只影响顺序，不影响谁出现在列表里）。 */
export function complementLanguage(wantToLearn, peerNativeLanguages) {
  const wanted = new Set(uniqueList(wantToLearn));
  if (wanted.size === 0) return null;
  const speaks = uniqueList(peerNativeLanguages);
  return speaks.find((language) => wanted.has(language)) ?? null;
}

export function complementBoost(wantToLearn, peerNativeLanguages) {
  return complementLanguage(wantToLearn, peerNativeLanguages) ? COMPLEMENT_BOOST : 0;
}

/** 排序键：匹配度 + 语言互补加成。列表排序统一用这个函数，别各写一套。 */
export function matchRank(entry, viewer) {
  const languages = uniqueList(
    entry?.nativeLanguages ?? (entry?.nativeLanguage ? [entry.nativeLanguage] : []),
  );
  return (entry?.matchScore ?? 0) + complementBoost(viewer?.wantToLearn, languages);
}

/** 给候选人补上「互补」三个字段（徽标文案靠它，藏了这块功能就白做）。 */
export function withComplement(entry, wantToLearn, peerNativeLanguages) {
  const hit = complementLanguage(wantToLearn, peerNativeLanguages);
  return { ...entry, complement: Boolean(hit), complementLanguage: hit };
}

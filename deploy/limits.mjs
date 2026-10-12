export function createWindowLimiter({ max = 60, windowMs = 60_000, maxKeys = 2000, now = () => Date.now() } = {}) {
  const entries = new Map();
  return function allow(key) {
    const current = now();
    for (const [id, entry] of entries) if (entry.until <= current) entries.delete(id);
    let entry = entries.get(key);
    if (!entry) {
      // Deny new keys at capacity instead of evicting throttled identities.
      if (entries.size >= maxKeys) return false;
      entry = { count: 0, until: current + windowMs };
      entries.set(key, entry);
    }
    entry.count++;
    return entry.count <= max;
  };
}

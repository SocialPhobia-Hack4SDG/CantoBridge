export const DEMO_WAIT_MS = 7_000;
export const DEMO_ACCEPT_MS = 10_000;

/** One offer per queue session; real matches always take precedence. */
export function createMatchFallback() {
  let key = null;
  let offer = null;
  let dismissed = false;
  return {
    sync(state, now) {
      const next = state.runtime.queue && !state.runtime.room
        ? `${state.learnerProfile.userId}|${state.role}|${state.runtime.queue.joinedAt}` : null;
      if (next !== key) { key = next; offer = null; dismissed = false; }
      if (state.runtime.matchRequest) { offer = null; dismissed = true; }
      if (key && !dismissed && !offer && now - state.runtime.queue.joinedAt >= DEMO_WAIT_MS) {
        offer = { key, expiresAt: now + DEMO_ACCEPT_MS };
      }
      return offer;
    },
    dismiss() { dismissed = true; offer = null; },
  };
}

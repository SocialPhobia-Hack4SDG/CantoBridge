/** Silent voice interaction preview. Never accesses mediaDevices or speech APIs.
 * Transport seam: a future voice adapter can supply transcripts and play audio.
 * This demo supplies an explicitly labelled example utterance and text reply.
 */
export function createTutorSession({ api, onChange, initialState = {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let version = 0;
  let disposed = false;
  let state = { phase: 'idle', muted: false, reply: null, utterance: null, error: false, turns: 0, ...initialState };
  function update(patch) { state = { ...state, ...patch }; if (!disposed) onChange(state); }
  function cancel() { version++; if (timer !== null) clearTimer(timer); timer = null; }
  return {
    getState: () => state,
    start() { if (!disposed) update({ phase: 'listening', error: false }); },
    async finishExample(currentCard) {
      if (disposed || state.phase !== 'listening' || state.muted) return;
      cancel(); const run = version;
      const utterance = currentCard.expressions[0].cantonese;
      update({ phase: 'thinking', utterance, error: false });
      try {
        const result = await api.replyToTutor({ text: utterance, currentCard });
        if (disposed || run !== version) return;
        if (result.mode !== 'mock' || !result.reply?.cantonese || !Array.isArray(result.suggestions)) throw Error('invalid demo reply');
        update({ phase: 'speaking', reply: result, turns: state.turns + 1 });
        timer = setTimer(() => { timer = null; if (!disposed && run === version) update({ phase: 'listening' }); }, 3000);
      } catch {
        if (!disposed && run === version) update({ phase: 'listening', error: true });
      }
    },
    interrupt() { if (!disposed && state.phase === 'speaking') { cancel(); update({ phase: 'listening' }); } },
    toggleMute() { if (!disposed) update({ muted: !state.muted }); },
    resetTopic() { if (!disposed) { cancel(); update({ phase: 'listening', utterance: null, reply: null, error: false }); } },
    end() { if (!disposed) { cancel(); update({ phase: 'ended' }); } },
    dispose() { cancel(); disposed = true; },
  };
}

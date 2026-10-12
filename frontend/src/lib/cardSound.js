/**
 * Short filtered paper friction, generated locally; never requests a microphone.
 *
 * **必须优先复用通话那条 `AudioContext`**（`getContext` 由房间页从通话会话上取）。
 * 自己新建一个的代价在移动端很实在：新建 / 首次播放会重新协商音频会话，
 * 正在播放的远端人声会被打断 —— 现场表现就是「一翻话题卡声音就断了」。
 *
 * 分工要说清：**共享的那条属于通话会话，`close()` 绝不能关它**；
 * 只有「自己建的那条」（没有通话可复用时的兜底）才由这里负责释放。
 */
export function createCardSound(win = globalThis.window, { getContext = null } = {}) {
  let own = null;
  return {
    play() {
      try {
        const shared = typeof getContext === 'function' ? getContext() : null;
        // 通话结束后那条上下文会被关掉，`closed` 的要退回自己建，不能往死上下文里塞 buffer
        const context = shared && shared.state !== 'closed' ? shared : (own ??= createContext(win));
        if (!context) return false;
        if (context.state === 'suspended') void context.resume().catch(() => {});
        const duration = .13;
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
        const source = context.createBufferSource(); source.buffer = buffer;
        const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1100; filter.Q.value = .6;
        const gain = context.createGain(); const now = context.currentTime;
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.085, now + .018); gain.gain.linearRampToValueAtTime(0, now + duration);
        source.connect(filter); filter.connect(gain); gain.connect(context.destination);
        source.start(now); source.stop(now + duration);
        return true;
      } catch { return false; }
    },
    close() { try { void own?.close?.()?.catch?.(() => {}); } catch {} own = null; },
  };
}

function createContext(win) {
  const AudioContext = win?.AudioContext ?? win?.webkitAudioContext;
  if (!AudioContext) return null;
  return new AudioContext();
}

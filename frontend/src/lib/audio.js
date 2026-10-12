/**
 * 音频相关纯函数：把 AnalyserNode 的时域数据转成 0~1 的音量，以及模拟通话用的假波形。
 * 不含任何 DOM / WebRTC 依赖，便于单测。
 */

/** 从时域采样（0~255，128 为静音中点）算出 RMS 归一化音量。 */
export function levelFromWaveform(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = (samples[index] - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.max(0, Math.min(1, rms * 3.2));
}

/**
 * 模拟通话的假音量：两条不同频率的正弦叠加，再加一点抖动，
 * 保证曲线看起来像人说话（有起伏、不是直线）。
 */
export function simulatedLevel(timeMs, seed = 0) {
  const t = timeMs / 1000;
  const wobble = Math.sin(t * 1.7 + seed) * 0.18;
  const speech = 0.34 + 0.3 * Math.sin(t * 6.1 + seed) + 0.16 * Math.sin(t * 13.3 + seed * 2);
  const gate = Math.sin(t * 0.9 + seed) > -0.55 ? 1 : 0.35;
  return Math.max(0.04, Math.min(1, (speech + wobble) * gate + 0.12));
}

/** 把瞬时音量做成平滑：上升快、回落慢，视觉上更像声波。 */
export function smoothLevel(previous, next, { attack = 0.55, release = 0.14 } = {}) {
  const from = Number.isFinite(previous) ? previous : 0;
  const to = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0;
  const weight = to > from ? attack : release;
  return from + (to - from) * weight;
}

/** 把音量映射成声波柱的高度比例（不低于最小值，避免静音时整排消失）。 */
export function barHeights(level, bars = 7, minimum = 0.18) {
  const value = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const out = [];
  for (let index = 0; index < bars; index += 1) {
    const center = 1 - Math.abs(index - (bars - 1) / 2) / ((bars - 1) / 2 || 1);
    const height = minimum + value * (0.4 + 0.6 * center) * (0.85 + 0.15 * Math.sin(index * 1.7));
    out.push(Math.round(Math.min(1, height) * 100) / 100);
  }
  return out;
}
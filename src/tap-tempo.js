// Cálculo de BPM a partir de toques.

export const MIN_BPM = 20;
export const MAX_BPM = 300;

const clampBpm = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * BPM a partir de timestamps (ms) de toques. Usa os últimos `maxTaps`,
 * descarta intervalos que fogem mais de `tolerance` da mediana e tira a média do resto.
 * Devolve null com menos de 2 toques.
 */
export function bpmFromTaps(timestamps, { maxTaps = 8, tolerance = 0.3 } = {}) {
  const taps = timestamps.slice(-maxTaps);
  if (taps.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
  const med = median(intervals);
  const kept = intervals.filter((d) => Math.abs(d - med) <= med * tolerance);
  const avg = kept.reduce((a, b) => a + b, 0) / kept.length;
  return clampBpm(Math.round(60000 / avg));
}

/** Acumula toques; uma pausa longa (`resetAfter` ms) recomeça a contagem. */
export class TapTempo {
  constructor({ resetAfter = 2000, ...opts } = {}) {
    this.resetAfter = resetAfter;
    this.opts = opts;
    this.taps = [];
  }

  tap(now = performance.now()) {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > this.resetAfter) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 16) this.taps.shift();
    return bpmFromTaps(this.taps, this.opts);
  }

  reset() {
    this.taps = [];
  }
}

/** ½× / 2× para corrigir erro de oitava, respeitando os limites. */
export function scaleBpm(bpm, factor) {
  return clampBpm(Math.round(bpm * factor));
}

export { clampBpm };

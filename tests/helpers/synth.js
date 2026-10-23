// Áudio sintético para testar o reconhecimento: notas de violão (fundamental + harmônicos) e uma FFT simples.

export const SR = 44100;
export const N = 8192;

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const hz = (name, octave) => 440 * 2 ** ((NOTE[name] + 12 * (octave + 1) - 69) / 12);

// Formas abertas típicas (corda grave → aguda)
export const VOICINGS = {
  Am: [['A', 2], ['E', 3], ['A', 3], ['C', 4], ['E', 4]],
  C: [['C', 3], ['E', 3], ['G', 3], ['C', 4], ['E', 4]],
  F: [['F', 2], ['C', 3], ['F', 3], ['A', 3], ['C', 4], ['F', 4]],
  G: [['G', 2], ['B', 2], ['D', 3], ['G', 3], ['B', 3], ['G', 4]],
  Dm: [['D', 3], ['A', 3], ['D', 4], ['F', 4]],
  D: [['D', 3], ['A', 3], ['D', 4], ['F#', 4]],
  E: [['E', 2], ['B', 2], ['E', 3], ['G#', 3], ['B', 3], ['E', 4]],
  Em: [['E', 2], ['B', 2], ['E', 3], ['G', 3], ['B', 3], ['E', 4]],
  A: [['A', 2], ['E', 3], ['A', 3], ['C#', 4], ['E', 4]],
  G7: [['G', 2], ['B', 2], ['D', 3], ['G', 3], ['B', 3], ['F', 4]],
  Bm: [['B', 2], ['F#', 3], ['B', 3], ['D', 4], ['F#', 4]],
};

export function synth(name, { seconds = N / SR, noise = 0.02, seed = 1, offset = 0 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = Math.round(seconds * SR);
  const out = new Float64Array(n);
  for (const [note, oct] of VOICINGS[name]) {
    const f0 = hz(note, oct) * (1 + 0.0005 * rnd()); // leve desafinação
    for (let h = 1; h <= 6; h++) {
      const amp = 1 / h ** 0.9;
      const w = (2 * Math.PI * f0 * h) / SR;
      for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * (i + offset));
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.5 + noise * rnd();
  return out;
}

/** FFT radix-2 com janela de Hann → dB, no mesmo formato de AnalyserNode.getFloatFrequencyData. */
export function spectrumDb(x) {
  const n = N;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const db = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) db[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / n + 1e-12);
  return db;
}

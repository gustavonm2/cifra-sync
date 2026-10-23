// Reconhecimento de acordes por áudio: espectro → "chroma" (12 classes de altura) → comparação
// com os acordes da própria música. Usar só o vocabulário da música (e não todos os acordes
// possíveis) é o que torna o reconhecimento confiável.

import { chordPitchClasses } from './chords.js';

const unit = (v) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : null;
};

/**
 * Espectro em dB (como AnalyserNode.getFloatFrequencyData) → { chroma, bass } (vetores de 12, normalizados).
 * Usa picos espectrais com interpolação parabólica e descarta picos desafinados (ruído/inarmônicos).
 */
export function chromaFromSpectrum(db, sampleRate, fftSize, { minHz = 90, maxHz = 1600, floorDb = 32 } = {}) {
  const binHz = sampleRate / fftSize;
  const kmin = Math.max(2, Math.floor(minHz / binHz));
  const kmax = Math.min(db.length - 2, Math.ceil(maxHz / binHz));
  let maxDb = -Infinity;
  for (let k = kmin; k <= kmax; k++) if (db[k] > maxDb) maxDb = db[k];
  if (!Number.isFinite(maxDb)) return null;

  const chroma = new Array(12).fill(0);
  const bass = new Array(12).fill(0);
  for (let k = kmin; k <= kmax; k++) {
    const b = db[k];
    if (b < maxDb - floorDb || b < db[k - 1] || b <= db[k + 1]) continue;
    const a = db[k - 1];
    const c = db[k + 1];
    const denom = a - 2 * b + c;
    const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const freq = (k + delta) * binHz;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const nearest = Math.round(midi);
    const dev = Math.abs(midi - nearest);
    if (dev > 0.4) continue;
    const pc = ((nearest % 12) + 12) % 12;
    const w = 10 ** ((b - maxDb) / 20) * (1 - dev);
    chroma[pc] += w;
    if (freq < 270) bass[pc] += w;
  }
  const c = unit(chroma.map(Math.sqrt));
  if (!c) return null;
  const bmax = Math.max(...bass);
  return { chroma: c, bass: bmax > 0 ? bass.map((x) => x / bmax) : bass };
}

/** Modelo de um acorde: pesos por classe de altura (raiz e baixo pesam mais). */
export function chordTemplate(name) {
  const info = chordPitchClasses(name);
  if (!info) return null;
  const t = new Array(12).fill(0);
  info.pcs.forEach((pc, i) => {
    t[pc] = i === 0 ? 1 : info.intervals[i] === 7 ? 0.75 : 0.85;
  });
  t[info.bass] = Math.max(t[info.bass], 1);
  return { vec: unit(t), root: info.bass };
}

/**
 * Melhor acorde do vocabulário para um chroma. Devolve { name, score, second } ou null.
 * score ≈ semelhança (0–1); `second` é a do segundo colocado (para medir a folga).
 */
export function matchChord(frame, templates) {
  if (!frame) return null;
  let best = null;
  let second = 0;
  for (const [name, t] of templates) {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += frame.chroma[i] * t.vec[i];
    const score = 0.8 * dot + 0.2 * frame.bass[t.root];
    if (!best || score > best.score) {
      second = best ? best.score : second;
      best = { name, score };
    } else if (score > second) second = score;
  }
  return best ? { ...best, second } : null;
}

/** Vocabulário: Map nome → modelo, ignorando duplicados e o que não for acorde. */
export function buildVocabulary(names) {
  const map = new Map();
  for (const n of names) {
    if (map.has(n)) continue;
    const t = chordTemplate(n);
    if (t) map.set(n, t);
  }
  return map;
}

// ---------- microfone ----------

const FFT = 8192;
const TICK_MS = 50;
const WEAK_FRAMES = 4; // ~200 ms com o mesmo acorde → detecção "fraca" (basta para o próximo acorde)
const STRONG_FRAMES = 9; // ~450 ms → "forte" (exigida para pular acordes)
const MIN_SCORE = 0.68;
const MIN_MARGIN = 0.03;

/**
 * Escuta o microfone e avisa os acordes da música que reconhece.
 *   onChord(name, score, strength)  strength: 'weak' | 'strong' (emitido uma vez em cada nível)
 *   onLevel(rms, gate)              a cada 50 ms
 */
export class ChordListener {
  constructor({ onChord, onLevel } = {}) {
    this.onChord = onChord;
    this.onLevel = onLevel;
    this.vocab = new Map();
    this.ctx = null;
    this.stream = null;
    this.timer = null;
    this.gate = 0.01;
    this.heard = { name: null, frames: 0, weak: false, strong: false };
  }

  setVocabulary(names) {
    this.vocab = buildVocabulary(names);
    this.heard = { name: null, frames: 0, weak: false, strong: false };
  }

  get active() {
    return !!this.timer;
  }

  /** Pede o microfone (chame num gesto do usuário). Lança erro com mensagem em português. */
  async start() {
    if (this.timer) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não permite usar o microfone (precisa de HTTPS).');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      throw new Error(e?.name === 'NotAllowedError' ? 'Permissão do microfone negada. Libere nas configurações do navegador.' : 'Não consegui acessar o microfone.');
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.resume().catch(() => {});
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT;
    this.analyser.smoothingTimeConstant = 0.2;
    source.connect(this.analyser); // não conecta ao destino: sem retorno de áudio
    this.spec = new Float32Array(this.analyser.frequencyBinCount);
    this.wave = new Float32Array(FFT);
    this.noise = [];
    this.silentFrames = 0;
    this.heard = { name: null, frames: 0, weak: false, strong: false };
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  _tick() {
    this.analyser.getFloatTimeDomainData(this.wave);
    let sum = 0;
    for (let i = 0; i < this.wave.length; i++) sum += this.wave[i] * this.wave[i];
    const rms = Math.sqrt(sum / this.wave.length);

    // ruído ambiente: calibra nos primeiros ~0,6 s e fixa o limiar um pouco acima
    if (this.noise.length < 12) {
      this.noise.push(rms);
      this.gate = Math.max(0.008, Math.max(...this.noise) * 2.5);
    }
    this.onLevel?.(rms, this.gate);
    if (rms < this.gate) {
      this.heard = { name: null, frames: 0, weak: false, strong: false };
      return;
    }

    this.analyser.getFloatFrequencyData(this.spec);
    const m = matchChord(chromaFromSpectrum(this.spec, this.ctx.sampleRate, FFT), this.vocab);
    const ok = m && m.score >= MIN_SCORE && m.score - m.second >= MIN_MARGIN;
    if (!ok) {
      this.heard.frames = Math.max(0, this.heard.frames - 1);
      return;
    }
    if (m.name !== this.heard.name) this.heard = { name: m.name, frames: 1, weak: false, strong: false };
    else this.heard.frames++;
    const h = this.heard;
    if (!h.weak && h.frames >= WEAK_FRAMES) {
      h.weak = true;
      this.onChord?.(m.name, m.score, 'weak');
    }
    if (!h.strong && h.frames >= STRONG_FRAMES) {
      h.strong = true;
      this.onChord?.(m.name, m.score, 'strong');
    }
  }
}

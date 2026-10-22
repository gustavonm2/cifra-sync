// Metrônomo: a posição (em tempos) vem de um relógio próprio (performance.now), então a cifra
// anda mesmo que o navegador mantenha o áudio suspenso. Os cliques são agendados no AudioContext
// com lookahead (convertendo o tempo do relógio para o tempo do áudio), sem setInterval por clique.
// beat = anchorBeat + (agora - anchorTime) * bpm / 60

import { METERS } from './timeline.js';

const LOOKAHEAD = 0.12; // s agendados à frente
const TICK_MS = 25; // frequência do agendador

const now = () => performance.now() / 1000;

export class Metronome {
  constructor() {
    this.ctx = null;
    this.bpm = 92;
    this.meter = METERS['4/4'];
    this.sound = true;
    this.running = false;
    this.anchorTime = 0;
    this.anchorBeat = 0;
    this.pausedBeat = 0;
    this.nextClick = 0;
    this.scheduled = [];
    this.timer = null;
  }

  /** Cria/retoma o AudioContext; chame dentro de um gesto do usuário sempre que possível. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx.state === 'running';
  }

  get audioReady() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Posição atual em tempos (fracionária). */
  get beat() {
    if (!this.running) return this.pausedBeat;
    return this.anchorBeat + ((now() - this.anchorTime) * this.bpm) / 60;
  }

  _reanchor(beat) {
    this.anchorTime = now();
    this.anchorBeat = beat;
    this.nextClick = Math.ceil(beat - 1e-6);
    this._cancelScheduled();
  }

  _cancelScheduled() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const s of this.scheduled) if (s.time > t) s.stop();
    this.scheduled = this.scheduled.filter((s) => s.time <= t);
  }

  start(fromBeat = this.pausedBeat) {
    this.unlock();
    this.running = true;
    this._reanchor(fromBeat);
    if (!this.timer) this.timer = setInterval(() => this._schedule(), TICK_MS);
    this._schedule();
  }

  pause() {
    if (!this.running) return;
    this.pausedBeat = this.beat;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this._cancelScheduled();
  }

  /** Salta para um tempo sem parar. */
  setBeat(beat) {
    this.pausedBeat = beat;
    if (this.running) this._reanchor(beat);
  }

  /** Correção suave de fase (em tempos): move a posição sem salto perceptível nos cliques. */
  slew(deltaBeats) {
    if (this.running) this._reanchor(this.beat + deltaBeats);
    else this.pausedBeat += deltaBeats;
  }

  setBpm(bpm) {
    if (this.running) {
      const b = this.beat;
      this.bpm = bpm;
      this._reanchor(b);
    } else {
      this.bpm = bpm;
    }
  }

  setMeter(id) {
    this.meter = METERS[id] ?? METERS['4/4'];
  }

  _schedule() {
    if (!this.running) return;
    const t0 = now();
    for (;;) {
      const t = this.anchorTime + ((this.nextClick - this.anchorBeat) * 60) / this.bpm;
      if (t > t0 + LOOKAHEAD) break;
      if (this.sound && this.audioReady && t >= t0 - 0.02) this._click(this.ctx.currentTime + (t - t0), this.nextClick);
      this.nextClick++;
    }
  }

  _click(time, beat) {
    const inBar = ((beat % this.meter.beats) + this.meter.beats) % this.meter.beats;
    const accent = inBar === 0;
    const mid = this.meter.mid.includes(inBar);
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : mid ? 1320 : 1100;
    osc.type = 'square';
    const peak = accent ? 0.5 : mid ? 0.32 : 0.22;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
    const entry = { time, stop: () => { try { osc.stop(); } catch {} } };
    this.scheduled.push(entry);
    osc.onended = () => {
      this.scheduled = this.scheduled.filter((s) => s !== entry);
    };
  }
}

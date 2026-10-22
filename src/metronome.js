// Metrônomo com Web Audio: o relógio é o do AudioContext e os cliques são agendados
// com lookahead, então não há jitter de timers. A posição (em tempos) é contínua:
// beat = anchorBeat + (ctx.currentTime - anchorTime) * bpm / 60.

import { METERS } from './timeline.js';

const LOOKAHEAD = 0.12; // s agendados à frente
const TICK_MS = 25; // frequência do agendador

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

  /** Deve ser chamado dentro de um gesto do usuário na primeira vez. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
    return this.ctx.state === 'running';
  }

  get audioReady() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Posição atual em tempos (fracionária). */
  get beat() {
    if (!this.running || !this.ctx) return this.pausedBeat;
    return this.anchorBeat + ((this.ctx.currentTime - this.anchorTime) * this.bpm) / 60;
  }

  _reanchor(beat) {
    this.anchorTime = this.ctx.currentTime;
    this.anchorBeat = beat;
    this.nextClick = Math.ceil(beat - 1e-6);
    this._cancelScheduled();
  }

  _cancelScheduled() {
    const now = this.ctx.currentTime;
    for (const s of this.scheduled) if (s.time > now) s.stop();
    this.scheduled = this.scheduled.filter((s) => s.time <= now);
  }

  start(fromBeat = this.pausedBeat) {
    if (!this.unlock() && !this.ctx) return;
    this.running = true;
    // pequeno atraso para o primeiro clique não ser cortado
    this._reanchor(fromBeat);
    this.anchorTime += 0.04;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), TICK_MS);
    this._schedule();
  }

  pause() {
    if (!this.running) return;
    this.pausedBeat = this.beat;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) this._cancelScheduled();
  }

  /** Salta para um tempo sem parar. */
  setBeat(beat) {
    this.pausedBeat = beat;
    if (this.running) this._reanchor(beat);
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
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    for (;;) {
      const t = this.anchorTime + ((this.nextClick - this.anchorBeat) * 60) / this.bpm;
      if (t > horizon) break;
      if (t >= this.ctx.currentTime - 0.02 && this.sound) this._click(t, this.nextClick);
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

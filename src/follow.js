// Acompanhar o que o músico toca: a posição na cifra é guiada pelos acordes ouvidos.
// - O acorde seguinte ouvido avança a cifra (e ajusta a velocidade estimada).
// - Sem ouvir o acorde seguinte, a cifra espera (não foge à frente de quem toca).
// - Se o músico pular à frente (até 3 acordes), a cifra o acompanha, desde que a detecção seja "forte".

export const MIN_SPEED = 0.3;
export const MAX_SPEED = 10;
export const HOLD_FRAC = 0.6; // onde a cifra espera pelo próximo acorde (antes de a fila deslizar)
const LOOKAHEAD = 3;
const LATENCY = 0.2; // s entre o acorde começar e o detector confirmá-lo

export class Follower {
  /** names: nomes exibidos (já transpostos) de cada passo; speed: segundos por acorde (estimativa inicial). */
  constructor(names, { cur = 0, speed = 2.5, now = 0, holds = {} } = {}) {
    this.names = names;
    this.holds = holds; // acordes segurados (multiplicador > 1) não servem para medir a velocidade
    this.cur = cur;
    this.speed = speed;
    this.t0 = now;
  }

  /** Posição fracionária (índice do acorde + fração), no instante `now` (s). */
  position(now) {
    const last = this.names.length - 1;
    let elapsed = (now - this.t0) / (this.speed * (this.holds[this.cur] ?? 1));
    // acordes repetidos em sequência não podem ser distinguidos pelo som: segue o relógio
    while (elapsed >= 1 && this.cur < last && this.names[this.cur + 1] === this.names[this.cur]) {
      this.t0 += this.speed * (this.holds[this.cur] ?? 1);
      this.cur++;
      elapsed = (now - this.t0) / (this.speed * (this.holds[this.cur] ?? 1));
    }
    return this.cur + Math.min(Math.max(elapsed, 0), HOLD_FRAC);
  }

  /**
   * Um acorde foi ouvido. strength: 'weak' | 'strong'.
   * Devolve { moved, speed } (moved = quantos passos avançou; 0 = ignorado).
   */
  hear(name, strength, now) {
    const last = this.names.length - 1;
    if (this.cur >= last || this.names[this.cur] === name) return { moved: 0, speed: this.speed };
    const maxAhead = strength === 'strong' ? LOOKAHEAD : 1;
    for (let i = this.cur + 1; i <= Math.min(last, this.cur + maxAhead); i++) {
      if (this.names[i] !== name) continue;
      const skipped = i - this.cur;
      const per = (now - LATENCY - this.t0) / skipped;
      const held = (this.holds[this.cur] ?? 1) > 1; // acorde segurado: o intervalo não reflete a velocidade
      if (!held && per >= MIN_SPEED && per <= MAX_SPEED) {
        this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, 0.6 * this.speed + 0.4 * per));
      }
      this.cur = i;
      this.t0 = now - LATENCY;
      return { moved: skipped, speed: this.speed };
    }
    return { moved: 0, speed: this.speed };
  }

  /** Reposiciona (ex.: usuário tocou num acorde da fila). */
  seek(index, now) {
    this.cur = Math.max(0, Math.min(this.names.length - 1, index));
    this.t0 = now;
  }
}

/** Primeiro acorde ouvido que serve para começar: o do passo atual (weak já basta). */
export function isStartChord(names, cur, heard) {
  return names[cur] === heard;
}

// Sequência de acordes da música: cada acorde é um "passo"; a velocidade manual define
// quantos segundos cada passo dura.

/**
 * A partir dos itens do parser devolve:
 *  steps:    [{ lineIdx, chordIdx, name, section }]  (section = nome da seção no 1º acorde dela, senão null)
 *  lines:    [{ itemIdx, first }]  linhas com acordes, em ordem (first = índice do 1º passo da linha)
 *  sections: [{ name, stepIdx }]
 */
export function buildSteps(items) {
  const steps = [];
  const lines = [];
  const sections = [];
  let pending = null;

  items.forEach((it, itemIdx) => {
    if (it.kind === 'section') {
      pending = it.name;
      return;
    }
    if (it.kind !== 'line' || !it.chords.length) return;
    const lineIdx = lines.length;
    lines.push({ itemIdx, first: steps.length });
    it.chords.forEach((c, chordIdx) => {
      let section = null;
      if (pending !== null) {
        section = pending;
        sections.push({ name: pending, stepIdx: steps.length });
        pending = null;
      }
      steps.push({ lineIdx, chordIdx, name: c.name, section });
    });
  });
  return { steps, lines, sections };
}

/** Posição (fracionária) → passo atual e fração decorrida dentro dele. */
export function locate(count, pos) {
  if (!count) return null;
  const clamped = Math.min(Math.max(pos, 0), count - 1e-6);
  const cur = Math.floor(clamped);
  return { cur, frac: clamped - cur };
}

/** Multiplicadores de duração para "segurar" um acorde (pausas no fim da estrofe, notas longas). */
export const HOLD_OPTIONS = [1, 1.5, 2, 3, 4, 6];

/** Duração (s) do acorde `i`: velocidade × multiplicador (1 se não houver). */
export const durationOf = (secPerChord, holds, i) => secPerChord * (holds?.[i] ?? 1);

/**
 * Avança `pos` em `dt` segundos. `dur` é um número (segundos por acorde) ou uma função i → duração do acorde i
 * (ver timing.js). `holds` (opcional) multiplica a duração quando `dur` é número. Devolve { pos, ended }.
 */
export function advance(pos, dt, dur, count, holds = {}) {
  const durOf = typeof dur === 'function' ? dur : (i) => durationOf(dur, holds, i);
  let p = pos;
  let left = dt;
  const end = count - 1e-3;
  while (left > 1e-9) {
    const i = Math.floor(p);
    const d = durOf(i);
    const toEnd = (i + 1 - p) * d;
    if (left < toEnd) {
      p += left / d;
      left = 0;
    } else {
      left -= toEnd;
      p = i + 1;
    }
    if (p >= end) return { pos: Math.max(0, end), ended: true };
  }
  return { pos: p, ended: false };
}

export const MIN_SECONDS = 0.5;
export const MAX_SECONDS = 8;

/** Arredonda para múltiplos de 0,25 s dentro dos limites. */
export function clampSeconds(s) {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(s * 4) / 4));
}

/** Em que fração do acorde a fila começa a deslizar: nos últimos 35%, ou nos últimos 0,6 s se o acorde for longo. */
export const slideFrom = (durationSec) => 1 - Math.min(0.35, 0.6 / durationSec);

/** Suavização da passagem de um acorde ao próximo: parado até `from`, desliza até 1. */
export function slideProgress(frac, from = 0.65) {
  const t = (frac - from) / (1 - from);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

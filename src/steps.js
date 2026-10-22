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

/** Avança `pos` em `dt` segundos a `secPerChord`; devolve { pos, ended }. */
export function advance(pos, dt, secPerChord, count) {
  const next = pos + dt / secPerChord;
  if (next >= count - 1e-3) return { pos: Math.max(0, count - 1e-3), ended: true };
  return { pos: next, ended: false };
}

export const MIN_SECONDS = 0.5;
export const MAX_SECONDS = 8;

/** Arredonda para múltiplos de 0,25 s dentro dos limites. */
export function clampSeconds(s) {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(s * 4) / 4));
}

/** Suavização da passagem de um acorde ao próximo: parado até `from`, desliza até 1. */
export function slideProgress(frac, from = 0.65) {
  const t = (frac - from) / (1 - from);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Campo harmônico e simplificação de acordes.
// Simplificar = reduzir cada acorde a tríade (maior, menor ou diminuta), sem baixo invertido nem
// extensões (7, 7M, 9, 6, sus, add…), e garantir que o resultado pertença ao campo harmônico do tom.

import { parseChord, noteIndex, preferFlats } from './chords.js';

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SPELL = { maj: '', min: 'm', dim: 'dim' };
const TRIAD = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6] };

/** Qualidade da tríade de um acorde: 'maj' | 'min' | 'dim' (a raiz é a do acorde). */
export function triadOf(name) {
  const c = parseChord(name);
  if (!c) return null;
  const s = c.suffix;
  let quality = 'maj';
  if (/dim|°|º|ø|m7\(?b5\)?/.test(s)) quality = 'dim';
  else if (/^(m(?!aj)|min|-)/.test(s)) quality = 'min';
  return { root: noteIndex(c.root), quality, rootName: c.root };
}

const pcs = (root, quality) => TRIAD[quality].map((i) => (root + i) % 12);

/** Campo harmônico de um tom: lista de { root, quality } (inclui o V maior e o vii° do menor harmônico). */
export function harmonicField(tonic, mode) {
  const deg = mode === 'major'
    ? [[0, 'maj'], [2, 'min'], [4, 'min'], [5, 'maj'], [7, 'maj'], [9, 'min'], [11, 'dim']]
    : [[0, 'min'], [2, 'dim'], [3, 'maj'], [5, 'min'], [7, 'min'], [7, 'maj'], [8, 'maj'], [10, 'maj'], [11, 'dim']];
  return deg.map(([i, quality]) => ({ root: (tonic + i) % 12, quality }));
}

const inField = (field, t) => field.some((f) => f.root === t.root && f.quality === t.quality);

/**
 * Tom provável da música: o que deixa mais acordes (pesados pelas repetições) dentro do campo harmônico.
 * Empates: prefere o tom cuja tônica é o 1º acorde, depois o último. Devolve { tonic, mode, score } ou null.
 */
export function detectKey(names) {
  const triads = names.map(triadOf).filter(Boolean);
  if (!triads.length) return null;
  const first = triads[0].root;
  const last = triads[triads.length - 1].root;
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor']) {
      const field = harmonicField(tonic, mode);
      const hit = triads.filter((t) => inField(field, t)).length / triads.length;
      const tonicTriad = { root: tonic, quality: mode === 'major' ? 'maj' : 'min' };
      const bonus = (first === tonic && triads[0].quality === tonicTriad.quality ? 0.02 : 0) + (last === tonic ? 0.01 : 0)
        + (triads[0].root === tonic ? 0.005 : 0);
      const score = hit + bonus;
      if (!best || score > best.score) best = { tonic, mode, score };
    }
  }
  return best;
}

/**
 * Simplifica um acorde para o tom dado. Mantém a raiz (e a grafia) quando ela é do campo;
 * se o acorde não pertence ao campo, usa o acorde do campo com mais notas em comum.
 */
export function simplifyChord(name, key) {
  const t = triadOf(name);
  if (!t) return name;
  if (!key) return t.rootName + SPELL[t.quality];
  const field = harmonicField(key.tonic, key.mode);
  if (inField(field, t)) return t.rootName + SPELL[t.quality];

  const names = preferFlats(key.tonic, key.mode === 'minor') ? FLAT : SHARP;
  const sameRoot = field.filter((f) => f.root === t.root);
  if (sameRoot.length) {
    const f = sameRoot[0];
    return t.rootName + SPELL[f.quality];
  }
  const original = new Set(pcs(t.root, t.quality));
  let best = null;
  for (const f of field) {
    const overlap = pcs(f.root, f.quality).filter((p) => original.has(p)).length;
    const dist = Math.min((f.root - t.root + 12) % 12, (t.root - f.root + 12) % 12);
    const score = overlap * 10 - dist - (f.quality === 'dim' ? 5 : 0); // mais notas em comum; empate: raiz mais próxima; evita diminuto
    if (!best || score > best.score) best = { f, score };
  }
  return names[best.f.root] + SPELL[best.f.quality];
}

/** Simplifica uma lista de acordes (todos no mesmo tom detectado). Devolve { names, key }. */
export function simplifyAll(names) {
  const key = detectKey(names);
  return { names: names.map((n) => simplifyChord(n, key)), key };
}

/** "C maior" / "A menor" para mostrar na tela. */
export function keyName(key) {
  if (!key) return '';
  const n = (preferFlats(key.tonic, key.mode === 'minor') ? FLAT : SHARP)[key.tonic];
  return `${n} ${key.mode === 'major' ? 'maior' : 'menor'}`;
}

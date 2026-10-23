// Reconhecimento e transposição de acordes.

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const SUFFIX = String.raw`(?:maj|min|dim|aug|sus|add|m|M|\+|-|°|º|ø|Δ|\d+|[#b]\d+|\([^)\s]*\)|\*)*`;
const CHORD_RE = new RegExp(String.raw`^([A-G][#b]?)(${SUFFIX})(?:\/([A-G][#b]?|\d+))?$`);

/** Índice cromático (0–11) de uma nota como "C#", "Bb", "E". */
export function noteIndex(note) {
  const base = NATURAL[note[0]];
  if (base === undefined) return null;
  let i = base;
  if (note[1] === '#') i += 1;
  else if (note[1] === 'b') i -= 1;
  return (i + 12) % 12;
}

/** Decompõe um acorde em { root, suffix, bass } ou devolve null. */
export function parseChord(token) {
  const m = CHORD_RE.exec(token);
  if (!m) return null;
  return { root: m[1], suffix: m[2], bass: m[3] ?? null };
}

export function isChord(token) {
  return CHORD_RE.test(token);
}

/** Tons que se escrevem com bemóis (maiores: F Bb Eb Ab Db Gb; menores: D G C F Bb Eb). */
export function preferFlats(rootIndex, minor) {
  const flatMajor = [5, 10, 3, 8, 1, 6];
  const flatMinor = [2, 7, 0, 5, 10, 3];
  return (minor ? flatMinor : flatMajor).includes(rootIndex);
}

function shiftNote(note, semitones, flats) {
  const i = noteIndex(note);
  return (flats ? FLAT_NAMES : SHARP_NAMES)[(((i + semitones) % 12) + 12) % 12];
}

/** Transpõe um acorde (inclusive o baixo invertido). Não-acordes voltam intactos. */
export function transposeChord(token, semitones, flats = false) {
  const c = parseChord(token);
  if (!c || semitones % 12 === 0) return token;
  const root = shiftNote(c.root, semitones, flats);
  const bass = c.bass === null ? '' : '/' + (/^\d+$/.test(c.bass) ? c.bass : shiftNote(c.bass, semitones, flats));
  return root + c.suffix + bass;
}

/** O acorde é menor? (m / min, mas não maj / dim-sem-m) */
export function isMinor(token) {
  const c = parseChord(token);
  return !!c && /^(m(?!aj)|min)/.test(c.suffix);
}

/** Nome do tom exibido após transpor o primeiro acorde da música. */
export function keyLabel(firstChord, semitones) {
  if (!firstChord) return '—';
  const c = parseChord(firstChord);
  if (!c) return '—';
  const flats = preferFlats((noteIndex(c.root) + semitones + 12) % 12, isMinor(firstChord));
  return transposeChord(firstChord, semitones, semitones === 0 ? false : flats).replace(/\/.*$/, '');
}

/** Decide bemol/sustenido para a música transposta a partir do primeiro acorde. */
export function flatsForSong(firstChord, semitones) {
  const c = firstChord && parseChord(firstChord);
  if (!c) return false;
  return preferFlats((noteIndex(c.root) + semitones + 12) % 12, isMinor(firstChord));
}

// ---------- notas de cada acorde ----------

/**
 * Intervalos (em semitons a partir da raiz) de um acorde, a partir do sufixo.
 * Cobre tríades (maior, menor, dim, aug, sus2/sus4), sextas, sétimas (7, 7M/maj7), nonas e extensões comuns.
 */
function chordIntervals(suffix) {
  const s = suffix.replace(/\(([^)]*)\)/g, ',$1,'); // (b5), (9) → ,b5, ,9, (separa os números)
  const has = (re) => re.test(s);
  const minor = has(/^(m(?!aj)|min|-)/);
  const dim = has(/dim|°|º|ø/);
  const half = /ø|m7\(?b5\)?/.test(suffix);
  const aug = has(/aug|\+/) && !has(/^\+\d/);
  const sus2 = has(/sus2/);
  const sus4 = has(/sus4|sus(?!2)/);

  let third = minor || dim ? 3 : 4;
  if (sus2) third = 2;
  else if (sus4) third = 5;
  let fifth = dim ? 6 : aug ? 8 : 7;
  const out = new Set([0, third]);

  const maj7 = has(/maj|7M|M7|Δ/);
  const dim7 = has(/dim7|°7|º7/);
  const num = (n) => new RegExp(`(?<!add)(?<![#b\\d])${n}(?!\\d)`).test(s);

  if (has(/b5/)) fifth = 6;
  if (has(/#5/)) fifth = 8;
  out.add(fifth);

  if (half) out.add(10);
  else if (dim7) out.add(9);
  else if (maj7) out.add(11);
  else if (num(7) || num(9) || num(11) || num(13)) out.add(10);

  if (num(6) || num(13)) out.add(9);
  if (num(9) || has(/add9|add2/)) out.add(2);
  if (has(/b9/)) out.add(1);
  if (has(/#9/)) out.add(3);
  if (num(11) || has(/add11|add4/)) out.add(5);
  if (has(/#11/)) out.add(6);
  return [...out].sort((a, b) => a - b);
}

/** Classes de altura do acorde: { root, pcs: [0–11...], bass, intervals } ou null. */
export function chordPitchClasses(token) {
  const c = parseChord(token);
  if (!c) return null;
  const root = noteIndex(c.root);
  const intervals = chordIntervals(c.suffix);
  const pcs = intervals.map((i) => (root + i) % 12);
  const bass = c.bass && !/^\d+$/.test(c.bass) ? noteIndex(c.bass) : root;
  return { root, pcs, bass, intervals };
}

/** Nomes das notas do acorde, ex.: "Am" → ["A","C","E"]; "C/G" → ["G","C","E"] (baixo primeiro). */
export function chordNotes(token, flats = false) {
  const info = chordPitchClasses(token);
  if (!info) return [];
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  const notes = info.pcs.map((p) => names[p]);
  if (info.bass !== info.root) notes.unshift(names[info.bass]);
  return [...new Set(notes)];
}

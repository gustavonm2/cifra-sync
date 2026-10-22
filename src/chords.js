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

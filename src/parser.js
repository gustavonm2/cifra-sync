// Parser de cifras no formato "linha de acordes acima da letra" (Cifra Club).
import { isChord } from './chords.js';

const SECTION_NAMES =
  'intro(?:du[cç][aã]o)?|verso|primeira parte|segunda parte|terceira parte|parte|refr[aã]o|pr[eé][- ]?refr[aã]o|ponte|solo|final|outro|coro|interl[uú]dio|instrumental|bridge|chorus|verse|pre-chorus|tab';
const BRACKET_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const NAMED_RE = new RegExp(`^\\s*((?:${SECTION_NAMES})(?:\\s*\\d+)?)\\s*(:)?\\s*(.*)$`, 'i');
const FILLER_RE = /^(?:[|\-–—/\\:.*%()]+|\(?(?:x\d+|\d+x)\)?|N\.?C\.?)$/i;

/** Quebra uma linha em tokens com a coluna em que cada um começa. */
function tokenize(line) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) tokens.push({ text: m[0], col: m.index });
  return tokens;
}

/** Se a linha só tem acordes (e marcas como | ou x2), devolve os acordes com coluna; senão null. */
export function parseChordLine(line) {
  const chords = [];
  for (const t of tokenize(line)) {
    const wrapped = /^\((.+)\)$/.exec(t.text);
    if (isChord(t.text)) chords.push({ name: t.text, col: t.col });
    else if (wrapped && isChord(wrapped[1])) chords.push({ name: wrapped[1], col: t.col + 1 });
    else if (!FILLER_RE.test(t.text)) return null;
  }
  return chords.length ? chords : null;
}

function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/\t/g, '    ').replace(/\s+$/, ''));
}

/** Nome de seção reconhecido em `line`: { name, rest } ou null. */
function matchSection(line) {
  let m = BRACKET_RE.exec(line);
  if (m) return { name: m[1].trim(), rest: m[2] };
  m = NAMED_RE.exec(line);
  if (m && (m[2] || !m[3])) {
    // "Intro: Am F" ou "Refrão" sozinho; "Final feliz" (sem dois-pontos) é letra.
    return { name: m[1].trim().replace(/^./, (c) => c.toUpperCase()), rest: m[3] };
  }
  return null;
}

/**
 * Converte o texto colado em itens:
 *  { kind: 'section', name }
 *  { kind: 'line', chords: [{name, col}], lyric: string|null }   (chords vazio = só letra)
 *  { kind: 'blank' }
 */
export function parseSong(text) {
  const rows = normalize(text);
  const items = [];
  const pushBlank = () => {
    if (items.length && items[items.length - 1].kind !== 'blank') items.push({ kind: 'blank' });
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.trim()) {
      pushBlank();
      continue;
    }

    const sec = matchSection(row);
    if (sec) {
      const restChords = sec.rest.trim() ? parseChordLine(sec.rest) : null;
      if (!sec.rest.trim() || restChords) {
        items.push({ kind: 'section', name: sec.name });
        if (restChords) {
          const shift = sec.rest.length - sec.rest.trimStart().length;
          items.push({ kind: 'line', chords: restChords.map((c) => ({ ...c, col: c.col - shift })), lyric: null });
        }
        continue;
      }
    }

    const chords = parseChordLine(row);
    if (chords) {
      const next = rows[i + 1];
      const nextIsLyric = next && next.trim() && !matchSection(next) && !parseChordLine(next);
      if (nextIsLyric) {
        items.push({ kind: 'line', chords, lyric: next });
        i++;
      } else {
        items.push({ kind: 'line', chords, lyric: null });
      }
      continue;
    }

    items.push({ kind: 'line', chords: [], lyric: row });
  }

  while (items.length && items[items.length - 1].kind === 'blank') items.pop();
  return items;
}

/** Primeiro acorde da música (usado como "tom"). */
export function firstChord(items) {
  for (const it of items) if (it.kind === 'line' && it.chords.length) return it.chords[0].name;
  return null;
}

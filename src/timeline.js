// Linha do tempo da cifra em "tempos" (beats): cada linha com acordes dura
// `barsPerLine` compassos e os acordes dividem esse tempo igualmente.

export const METERS = {
  '4/4': { beats: 4, mid: [] },
  '3/4': { beats: 3, mid: [] },
  '6/8': { beats: 6, mid: [3] }, // o BPM conta colcheias; acento forte no 1, médio no 4
};

export function buildTimeline(items, meterId = '4/4', barsPerLine = 2) {
  const beatsPerBar = (METERS[meterId] ?? METERS['4/4']).beats;
  const lineBeats = beatsPerBar * barsPerLine;
  const lines = [];
  const steps = [];
  const sections = [];
  let pending = null; // seção aguardando a primeira linha com acordes

  items.forEach((it, itemIdx) => {
    if (it.kind === 'section') {
      pending = { name: it.name, itemIdx };
      return;
    }
    if (it.kind !== 'line' || !it.chords.length) return;

    const lineIdx = lines.length;
    const startBeat = lineIdx * lineBeats;
    if (pending || (!sections.length && !lineIdx)) {
      sections.push({ name: pending?.name ?? 'Início', itemIdx: pending?.itemIdx ?? itemIdx, lineIdx, startBeat });
      pending = null;
    }
    const n = it.chords.length;
    const chords = it.chords.map((c, chordIdx) => {
      const step = {
        lineIdx,
        chordIdx,
        name: c.name,
        startBeat: startBeat + (chordIdx * lineBeats) / n,
        endBeat: startBeat + ((chordIdx + 1) * lineBeats) / n,
      };
      steps.push(step);
      return step;
    });
    lines.push({ itemIdx, startBeat, endBeat: startBeat + lineBeats, chords });
  });

  return { beatsPerBar, barsPerLine, lineBeats, lines, steps, sections, totalBeats: lines.length * lineBeats };
}

/** Onde estamos no `beat` (pode ser fracionário, negativo = pré-roll). */
export function locate(tl, beat) {
  if (!tl.lines.length) return null;
  const clamped = Math.min(Math.max(beat, 0), tl.totalBeats - 1e-9);
  const lineIdx = Math.min(tl.lines.length - 1, Math.floor(clamped / tl.lineBeats));
  const line = tl.lines[lineIdx];
  let chordIdx = line.chords.findIndex((c) => clamped >= c.startBeat && clamped < c.endBeat);
  if (chordIdx < 0) chordIdx = line.chords.length - 1;
  const step = line.chords[chordIdx];
  const bar = Math.floor(clamped / tl.beatsPerBar) + 1;
  return {
    lineIdx,
    chordIdx,
    stepIdx: tl.steps.indexOf(step),
    lineProgress: Math.min(1, Math.max(0, (beat - line.startBeat) / tl.lineBeats)),
    bar,
    barsInLine: [lineIdx * tl.barsPerLine + 1, (lineIdx + 1) * tl.barsPerLine],
    totalBars: tl.totalBeats / tl.beatsPerBar,
    beatInBar: ((Math.floor(beat) % tl.beatsPerBar) + tl.beatsPerBar) % tl.beatsPerBar,
    beatsToChange: Math.max(0, Math.ceil(step.endBeat - beat - 1e-9)),
    finished: beat >= tl.totalBeats,
    section: sectionAt(tl, lineIdx),
  };
}

/** Índice da seção a que a linha pertence. */
export function sectionAt(tl, lineIdx) {
  let idx = 0;
  tl.sections.forEach((s, i) => {
    if (s.lineIdx <= lineIdx) idx = i;
  });
  return idx;
}

/** Próximos `count` acordes depois do atual. */
export function nextChords(tl, stepIdx, count = 4) {
  return tl.steps.slice(stepIdx + 1, stepIdx + 1 + count);
}

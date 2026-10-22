// Marcadores de seção: relacionam o tempo do vídeo (s) com o início de cada seção,
// corrigindo a deriva de gravações sem andamento fixo.

/** markers: { [sectionIdx]: segundos } */
export function sortedMarkers(tl, markers) {
  return Object.entries(markers ?? {})
    .map(([i, time]) => ({ sectionIdx: Number(i), time }))
    .filter((m) => tl.sections[m.sectionIdx] && Number.isFinite(m.time))
    .sort((a, b) => a.time - b.time);
}

/** Beat da cifra para um instante do vídeo. Sem marcadores, assume que a música começa em t=0. */
export function beatForVideoTime(tl, markers, bpm, t, offset = 0) {
  const list = sortedMarkers(tl, markers);
  const perSecond = bpm / 60;
  if (!list.length) return t * perSecond + offset;
  let anchor = list[0];
  for (const m of list) if (m.time <= t) anchor = m;
  return tl.sections[anchor.sectionIdx].startBeat + (t - anchor.time) * perSecond + offset;
}

/** Tempo do vídeo em que a seção começa, ou null se não foi marcada. */
export function videoTimeForSection(markers, sectionIdx) {
  const t = markers?.[sectionIdx];
  return Number.isFinite(t) ? t : null;
}

/** Seção a marcar: a primeira sem marcador; se todas estão marcadas, a atual. */
export function sectionToMark(tl, markers, currentSectionIdx) {
  const first = tl.sections.findIndex((_, i) => !Number.isFinite(markers?.[i]));
  return first >= 0 ? first : currentSectionIdx;
}

/** Inverso de beatForVideoTime: tempo do vídeo (s) correspondente a um beat da cifra. */
export function videoTimeForBeat(tl, markers, bpm, beat, offset = 0) {
  const list = sortedMarkers(tl, markers);
  const secPerBeat = 60 / bpm;
  let anchor = null;
  for (const m of list) if (tl.sections[m.sectionIdx].startBeat <= beat) anchor = m;
  anchor ??= list[0];
  if (!anchor) return Math.max(0, (beat - offset) * secPerBeat);
  return Math.max(0, anchor.time + (beat - offset - tl.sections[anchor.sectionIdx].startBeat) * secPerBeat);
}

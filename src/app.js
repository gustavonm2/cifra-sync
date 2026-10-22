import { parseSong, firstChord } from './parser.js';
import { transposeChord, keyLabel, flatsForSong } from './chords.js';
import { buildTimeline, locate, nextChords, METERS } from './timeline.js';
import { TapTempo, scaleBpm, clampBpm } from './tap-tempo.js';
import { beatForVideoTime, videoTimeForBeat, sectionToMark } from './markers.js';
import { Metronome } from './metronome.js';
import { VideoPlayer, extractVideoId } from './youtube.js';
import * as store from './storage.js';
import { DEMO_SONG } from './demo.js';
import { isCifraClubUrl } from './cifraclub.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const dom = {
  chart: $('#chart'), bpm: $('#bpm'), beats: $('#beats'), status: $('#status'), meter: $('#meter'),
  bars: $('#bars'), offset: $('#offset'), play: $('#play'), playIcon: $('#play-icon'), timeline: $('#timeline'),
  timeNow: $('#time-now'), timeTotal: $('#time-total'), nextMain: $('#next-main'), nextMini: $('#next-mini'),
  nextEta: $('#next-eta'), keyLabel: $('#key-label'), title: $('#song-title'), sub: $('#song-sub'),
  sound: $('#sound'), sync: $('#sync'), videoHost: $('#video-host'), videoEmpty: $('#video-empty'),
  videoMsg: $('#video-msg'), toast: $('#toast'),
};

// ---------- estado ----------
const metro = new Metronome();
const tapper = new TapTempo();
const settings = store.loadSettings();
let songs = store.loadSongs();
let song = null;
let items = [];
let tl = null;
let first = null;
let flats = false;
let lineEls = [];
let segEls = [];
let view = {};
let scrollTarget = 0;
let manualScrollUntil = 0;
let lastFrame = performance.now();
let lastVideoTime = 0;

const video = new VideoPlayer(dom.videoHost, {
  onState: onVideoState,
  onError: (msg) => setVideoMessage(msg),
});

// ---------- persistência ----------
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (song && songs.some((s) => s.id === song.id)) store.saveSongs(songs);
  }, 250);
}

function toast(msg, ms = 2600) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => dom.toast.classList.remove('show'), ms);
}

// ---------- carregar música ----------
function loadSong(s) {
  metro.pause();
  song = s;
  store.saveCurrentId(s.id);
  items = parseSong(s.text);
  first = firstChord(items);
  tl = null;
  rebuildTimeline();
  metro.setBpm(s.bpm);
  metro.setMeter(s.meter);
  metro.setBeat(0);
  syncControls();
  renderChart();
  renderTimeline();
  view = {};
  loadVideo();
  scrollTarget = 0;
  dom.chart.scrollTop = 0;
}

function loadVideo() {
  const id = extractVideoId(song.url);
  if (id) {
    setVideoMessage('Carregando vídeo…');
    dom.videoEmpty.hidden = false;
    video.load(id).then(() => {
      if (video.player) dom.videoEmpty.hidden = true;
    });
  } else {
    video.load(null);
    dom.videoHost.replaceChildren(dom.videoEmpty);
    dom.videoEmpty.hidden = false;
    setVideoMessage(song.url ? 'Link do YouTube não reconhecido' : 'Cole o link do YouTube em “Editar”');
  }
}
function setVideoMessage(msg) {
  dom.videoMsg.textContent = msg;
  if (!dom.videoHost.contains(dom.videoEmpty)) dom.videoHost.appendChild(dom.videoEmpty);
  dom.videoEmpty.hidden = false;
}

/** Recalcula a linha do tempo mantendo a posição relativa (linha + progresso). */
function rebuildTimeline() {
  const old = tl;
  const pos = old && metro.beat >= 0 ? locate(old, metro.beat) : null;
  tl = buildTimeline(items, song.meter, song.barsPerLine);
  flats = flatsForSong(first, song.transpose);
  if (pos && tl.lines.length) {
    const line = tl.lines[Math.min(pos.lineIdx, tl.lines.length - 1)];
    metro.setBeat(line.startBeat + pos.lineProgress * tl.lineBeats);
  }
}

// ---------- renderização ----------
function chordName(name) {
  return transposeChord(name, song.transpose, flats);
}

function buildChordLine(chords) {
  const pre = el('pre', 'chords');
  const spans = [];
  let col = 0;
  chords.forEach((c) => {
    const name = chordName(c.name);
    const at = Math.max(c.col, col ? col + 1 : 0);
    pre.append(' '.repeat(at - col));
    const span = el('span', '', name);
    pre.append(span);
    spans.push(span);
    col = at + name.length;
  });
  return { pre, spans };
}

function renderChart() {
  dom.chart.replaceChildren();
  lineEls = [];
  if (!items.length) {
    dom.chart.append(el('div', 'empty', 'Nenhuma cifra ainda. Toque em “Colar cifra”, cole o texto copiado do Cifra Club (acordes acima da letra) e salve.'));
    return;
  }
  const byItem = new Map(tl.lines.map((l, i) => [l.itemIdx, i]));
  items.forEach((it, idx) => {
    if (it.kind === 'section') return dom.chart.append(el('div', 'sec', it.name));
    if (it.kind === 'blank') return dom.chart.append(el('div', 'blank'));
    const line = el('div', it.chords.length ? 'line' : 'line plain');
    let chordEls = [];
    if (it.chords.length) {
      const built = buildChordLine(it.chords);
      chordEls = built.spans;
      line.append(built.pre);
    }
    if (it.lyric !== null) line.append(el('pre', 'lyric', it.lyric));
    if (byItem.has(idx)) {
      const badge = el('span', 'badge');
      const bar = el('div', 'bar');
      const fill = el('i');
      bar.append(fill);
      line.append(badge, bar);
      lineEls[byItem.get(idx)] = { el: line, chordEls, badge, fill, topEl: line.previousElementSibling?.classList.contains('sec') ? line.previousElementSibling : null };
    }
    dom.chart.append(line);
  });
  // topEl depende de o elemento já estar no DOM
  lineEls.forEach((l) => {
    l.topEl = l.el.previousElementSibling?.classList.contains('sec') ? l.el.previousElementSibling : null;
  });
}

function renderTimeline() {
  dom.timeline.replaceChildren();
  segEls = [];
  tl.sections.forEach((s, i) => {
    const next = tl.sections[i + 1];
    const bars = ((next ? next.startBeat : tl.totalBeats) - s.startBeat) / tl.beatsPerBar;
    const seg = el('button', 'seg');
    seg.type = 'button';
    seg.style.flexGrow = String(Math.max(1, bars));
    const track = el('span', 'track');
    const fill = el('i', 'fill');
    track.append(fill);
    const name = el('span', 'name', s.name);
    seg.append(track, name);
    seg.addEventListener('click', () => jumpToSection(i));
    dom.timeline.append(seg);
    segEls.push({ seg, fill, start: s.startBeat, len: (next ? next.startBeat : tl.totalBeats) - s.startBeat });
  });
  refreshMarkedClasses();
  const secs = tl.totalBeats * 60 / song.bpm;
  dom.timeTotal.textContent = fmt(secs);
}

function refreshMarkedClasses() {
  segEls.forEach((s, i) => {
    const t = song.markers[i];
    s.seg.classList.toggle('marked', Number.isFinite(t));
    s.seg.title = Number.isFinite(t) ? `Marcada em ${fmt(t)}` : 'Sem marcador';
  });
}

function renderBeats() {
  dom.beats.replaceChildren();
  const m = METERS[song.meter];
  for (let i = 0; i < m.beats; i++) {
    const b = el('div', 'beat' + (i === 0 ? ' accent' : ''), String(i + 1));
    dom.beats.append(b);
  }
  view.beatInBar = -2;
}

function renderNext(host, steps, mini) {
  host.replaceChildren();
  if (mini) host.append(el('span', 'now', 'Próx.'));
  for (let i = 0; i < 4; i++) {
    const s = steps[i];
    host.append(el('div', s ? 'chip' : 'chip empty-chip', s ? chordName(s.name) : '–'));
  }
}

function syncControls() {
  dom.bpm.value = song.bpm;
  dom.meter.value = song.meter;
  dom.bars.textContent = song.barsPerLine;
  dom.offset.textContent = (song.offset > 0 ? '+' : '') + song.offset;
  dom.sound.setAttribute('aria-pressed', String(settings.sound));
  dom.sound.textContent = `Som: ${settings.sound ? 'ligado' : 'desligado'}`;
  dom.sync.setAttribute('aria-pressed', String(song.sync));
  metro.sound = settings.sound;
  renderBeats();
  updateHeader();
  document.documentElement.style.setProperty('--chart-fs', settings.fontSize + 'px');
}

function updateHeader() {
  dom.title.textContent = song.title || 'Sem título';
  dom.sub.textContent = [song.artist, song.meter, `${song.bpm} BPM`].filter(Boolean).join(' · ');
  dom.keyLabel.textContent = 'Tom ' + keyLabel(first, song.transpose);
  dom.keyLabel.title = song.transpose ? `Transposto ${song.transpose > 0 ? '+' : ''}${song.transpose}` : 'Tom original';
}

// ---------- laço de animação ----------
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (song && tl) tick(dt, now);
  requestAnimationFrame(frame);
}

function tick(dt, now) {
  const beat = metro.beat;
  const loc = locate(tl, beat);
  updatePlayButton();

  const videoActive = song.sync && video.available;
  const secs = videoActive ? video.time : Math.max(0, (beat * 60) / song.bpm);
  const timeStr = fmt(secs);
  if (timeStr !== view.time) {
    view.time = timeStr;
    dom.timeNow.textContent = timeStr;
    if (videoActive && video.duration) dom.timeTotal.textContent = fmt(video.duration);
  }

  if (metro.running) {
    const idx = Math.floor(beat);
    const inBar = idx < 0 ? -1 : idx % tl.beatsPerBar;
    if (inBar !== view.beatInBar) {
      view.beatInBar = inBar;
      [...dom.beats.children].forEach((b, i) => b.classList.toggle('on', i === inBar));
    }
  } else if (view.beatInBar !== -1) {
    view.beatInBar = -1;
    [...dom.beats.children].forEach((b) => b.classList.remove('on'));
  }

  if (!loc) return;

  if (loc.lineIdx !== view.lineIdx) {
    lineEls.forEach((l, i) => {
      l.el.classList.toggle('current', i === loc.lineIdx);
      l.el.classList.toggle('past', i < loc.lineIdx);
    });
    const cur = lineEls[loc.lineIdx];
    if (cur) cur.badge.textContent = `Agora · compassos ${loc.barsInLine[0]}–${loc.barsInLine[1]}`.replace(/(\d+)–\1/, '$1');
    view.lineIdx = loc.lineIdx;
    view.stepIdx = -1;
    computeScrollTarget(loc.lineIdx);
  }
  if (loc.stepIdx !== view.stepIdx) {
    view.stepIdx = loc.stepIdx;
    const step = tl.steps[loc.stepIdx];
    const cur = lineEls[loc.lineIdx];
    cur?.chordEls.forEach((c, i) => {
      c.classList.toggle('cur', i === loc.chordIdx);
      c.classList.toggle('nxt', i === loc.chordIdx + 1);
    });
    const upcoming = nextChords(tl, loc.stepIdx, 4);
    renderNext(dom.nextMain, upcoming, false);
    renderNext(dom.nextMini, upcoming, true);
    dom.nextMini.firstChild.textContent = chordName(step.name);
    dom.nextMini.firstChild.className = 'now cur-chord';
    dom.nextMini.firstChild.style.cssText = 'font:700 22px var(--mono);color:var(--amber);text-transform:none;letter-spacing:0;margin-right:6px';
  }
  const eta = metro.running ? `troca em ${loc.beatsToChange} ${loc.beatsToChange === 1 ? 'tempo' : 'tempos'}` : '';
  if (eta !== view.eta) {
    view.eta = eta;
    dom.nextEta.textContent = eta;
  }
  const lineEl = lineEls[loc.lineIdx];
  if (lineEl) lineEl.fill.style.transform = `scaleX(${loc.lineProgress})`;

  const statusTxt = `Compasso ${loc.bar} de ${loc.totalBars} · ${song.sync && video.available ? 'sincronizado com o vídeo' : 'metrônomo livre'}`;
  if (statusTxt !== view.status) {
    view.status = statusTxt;
    dom.status.textContent = statusTxt;
  }

  segEls.forEach((s, i) => {
    s.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, (beat - s.start) / s.len))})`;
    if (i === loc.section) s.seg.classList.add('active');
    else s.seg.classList.remove('active');
  });

  if (loc.finished && metro.running && !(song.sync && video.playing)) {
    metro.pause();
    toast('Fim da cifra');
  }

  autoScroll(dt, now);
}

function computeScrollTarget(lineIdx) {
  const cur = lineEls[lineIdx];
  if (!cur) return;
  const H = dom.chart.clientHeight;
  const top = (cur.topEl ?? cur.el).offsetTop;
  const lastEl = (lineEls[Math.min(lineEls.length - 1, lineIdx + 2)] ?? cur).el;
  const bottom = lastEl.offsetTop + lastEl.offsetHeight;
  const margin = 12;
  const preferred = top - H * 0.18;
  const lo = bottom + margin - H; // mínimo para ver as 2 próximas linhas
  const hi = top - margin; // máximo para ver o início da atual
  scrollTarget = Math.max(0, lo > hi ? hi : Math.min(hi, Math.max(lo, preferred)));
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function autoScroll(dt, now) {
  if (now < manualScrollUntil) return;
  const diff = scrollTarget - dom.chart.scrollTop;
  if (Math.abs(diff) < 0.5) return;
  dom.chart.scrollTop += reduceMotion.matches ? diff : diff * (1 - Math.exp(-dt * 7));
}
for (const ev of ['wheel', 'touchstart', 'touchmove']) {
  dom.chart.addEventListener(ev, () => { manualScrollUntil = performance.now() + 2500; }, { passive: true });
}
window.addEventListener('resize', () => view.lineIdx !== undefined && computeScrollTarget(view.lineIdx));

function updatePlayButton() {
  const running = metro.running;
  if (view.running === running) return;
  view.running = running;
  dom.playIcon.setAttribute('d', running ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
  dom.play.setAttribute('aria-label', running ? 'Pausar' : 'Tocar');
}

// ---------- transporte ----------
function afterGesture() {
  if (!metro.unlock()) setTimeout(() => !metro.audioReady && toast('Toque na tela para ativar o áudio'), 400);
}

function togglePlay() {
  afterGesture();
  if (!tl.lines.length) return toast('Cole uma cifra primeiro');
  if (song.sync && video.available) {
    video.playing ? video.pause() : video.play();
    return; // o estado do player liga/desliga o metrônomo
  }
  if (song.sync) toast('Vídeo indisponível: usando metrônomo livre');
  if (metro.running) metro.pause();
  else metro.start(metro.beat >= tl.totalBeats ? 0 : metro.beat);
}

function restart() {
  if (song.sync && video.available) {
    const t = videoTimeForBeat(tl, song.markers, song.bpm, song.offset);
    video.seek(t);
    lastVideoTime = t;
    metro.setBeat(beatForVideoTime(tl, song.markers, song.bpm, t, song.offset));
  } else {
    metro.setBeat(0);
  }
  view.lineIdx = undefined;
  dom.chart.scrollTop = 0;
}

function jumpToSection(i) {
  const s = tl.sections[i];
  if (!s) return;
  const beat = s.startBeat + (song.sync ? song.offset : 0);
  if (song.sync && video.available) {
    const t = Number.isFinite(song.markers[i]) ? song.markers[i] : videoTimeForBeat(tl, song.markers, song.bpm, s.startBeat, song.offset);
    video.seek(t);
    lastVideoTime = t;
  }
  metro.setBeat(beat);
  manualScrollUntil = 0;
}

function markSection() {
  if (!video.available) return toast('Carregue um vídeo para marcar seções');
  if (!tl.sections.length) return toast('Esta cifra não tem seções');
  const cur = locate(tl, metro.beat)?.section ?? 0;
  const idx = sectionToMark(tl, song.markers, cur);
  const t = video.time;
  song.markers[idx] = Math.round(t * 100) / 100;
  refreshMarkedClasses();
  metro.setBeat(tl.sections[idx].startBeat + song.offset);
  manualScrollUntil = 0;
  persist();
  const nextIdx = tl.sections.findIndex((_, i) => !Number.isFinite(song.markers[i]));
  toast(`${tl.sections[idx].name} marcada em ${fmt(t)}` + (nextIdx >= 0 ? ` · próxima: ${tl.sections[nextIdx].name}` : ''));
}

function nudgeOffset(d) {
  song.offset += d;
  dom.offset.textContent = (song.offset > 0 ? '+' : '') + song.offset;
  metro.setBeat(metro.beat + d);
  persist();
}

// ---------- sincronização com o vídeo ----------
function videoBeat() {
  return beatForVideoTime(tl, song.markers, song.bpm, video.time, song.offset);
}

function onVideoState(state) {
  if (!song?.sync || !tl) return;
  if (state === 'playing') {
    afterGesture();
    metro.start(videoBeat());
  } else if (state === 'paused' || state === 'ended') {
    metro.pause();
    metro.setBeat(videoBeat());
  }
  lastVideoTime = video.time;
}

setInterval(() => {
  if (!song?.sync || !video.available || !tl) return;
  const t = video.time;
  const target = beatForVideoTime(tl, song.markers, song.bpm, t, song.offset);
  if (video.playing) {
    if (!metro.running) metro.start(target);
    else if (Math.abs(metro.beat - target) > 0.75) metro.setBeat(target); // deriva ou seek
  } else if (Math.abs(t - lastVideoTime) > 0.4) {
    metro.setBeat(target); // seek com o vídeo pausado
    manualScrollUntil = 0;
  }
  lastVideoTime = t;
}, 200);

// ---------- controles ----------
function setBpm(v) {
  if (!Number.isFinite(v)) return;
  song.bpm = clampBpm(Math.round(v));
  dom.bpm.value = song.bpm;
  metro.setBpm(song.bpm);
  dom.timeTotal.textContent = fmt(tl.totalBeats * 60 / song.bpm);
  updateHeader();
  persist();
}
dom.bpm.addEventListener('change', () => setBpm(parseFloat(dom.bpm.value) || song.bpm));
dom.bpm.addEventListener('input', () => {
  const v = parseInt(dom.bpm.value, 10);
  if (v >= 20 && v <= 300) setBpm(v);
});
$('#tap').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doTap();
});
function doTap() {
  metro.unlock();
  const bpm = tapper.tap();
  if (bpm) setBpm(bpm);
}
$('#tap').addEventListener('keydown', (e) => (e.key === 'Enter') && doTap());
$('#bpm-half').addEventListener('click', () => setBpm(scaleBpm(song.bpm, 0.5)));
$('#bpm-double').addEventListener('click', () => setBpm(scaleBpm(song.bpm, 2)));

dom.meter.addEventListener('change', () => {
  song.meter = dom.meter.value;
  metro.setMeter(song.meter);
  rebuildTimeline();
  renderBeats();
  renderChart();
  renderTimeline();
  view = { running: view.running };
  updateHeader();
  persist();
});

function setBars(n) {
  song.barsPerLine = Math.min(4, Math.max(1, n));
  dom.bars.textContent = song.barsPerLine;
  rebuildTimeline();
  renderChart();
  renderTimeline();
  view = { running: view.running };
  persist();
}
$('#bars-down').addEventListener('click', () => setBars(song.barsPerLine - 1));
$('#bars-up').addEventListener('click', () => setBars(song.barsPerLine + 1));
$('#off-down').addEventListener('click', () => nudgeOffset(-1));
$('#off-up').addEventListener('click', () => nudgeOffset(1));

function setTranspose(d) {
  song.transpose = Math.max(-11, Math.min(11, song.transpose + d));
  flats = flatsForSong(first, song.transpose);
  renderChart();
  updateHeader();
  view = { running: view.running, beatInBar: view.beatInBar, time: view.time };
  persist();
}
$('#key-down').addEventListener('click', () => setTranspose(-1));
$('#key-up').addEventListener('click', () => setTranspose(1));

dom.sound.addEventListener('click', toggleSound);
function toggleSound() {
  settings.sound = !settings.sound;
  metro.sound = settings.sound;
  dom.sound.setAttribute('aria-pressed', String(settings.sound));
  dom.sound.textContent = `Som: ${settings.sound ? 'ligado' : 'desligado'}`;
  store.saveSettings(settings);
}

dom.sync.addEventListener('click', () => {
  if (!song.sync && !video.available) return toast('Cole um link do YouTube em “Editar” e aguarde o vídeo carregar');
  song.sync = !song.sync;
  dom.sync.setAttribute('aria-pressed', String(song.sync));
  persist();
  if (song.sync) {
    afterGesture();
    metro.pause();
    lastVideoTime = video.time;
    metro.setBeat(videoBeat());
    toast('Sincronizado: o play do vídeo controla a cifra');
  }
});

dom.play.addEventListener('click', togglePlay);
$('#restart').addEventListener('click', restart);
$('#mark').addEventListener('click', markSection);
$('#panel-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('panel-open');
  $('#panel-toggle').setAttribute('aria-expanded', String(open));
});

function setFont(d) {
  settings.fontSize = Math.max(16, Math.min(44, settings.fontSize + d));
  document.documentElement.style.setProperty('--chart-fs', settings.fontSize + 'px');
  store.saveSettings(settings);
  requestAnimationFrame(() => view.lineIdx !== undefined && computeScrollTarget(view.lineIdx));
}
$('#font-up').addEventListener('click', () => setFont(2));
$('#font-down').addEventListener('click', () => setFont(-2));

// desbloqueia o áudio no primeiro toque em qualquer lugar da página
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => metro.unlock(), { once: false, passive: true });

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, dialog[open]')) return;
  const k = e.key;
  const handled = {
    ' ': togglePlay, r: restart, R: restart, t: doTap, T: doTap, m: toggleSound, M: toggleSound,
    ArrowLeft: () => nudgeOffset(-1), ArrowRight: () => nudgeOffset(1),
    ArrowUp: () => setBpm(song.bpm + 1), ArrowDown: () => setBpm(song.bpm - 1),
  }[k];
  if (handled) {
    e.preventDefault();
    handled();
  }
});

// ---------- editor ----------
const dlgEdit = $('#dlg-edit');
let editing = null;

function openEditor(target) {
  editing = target; // null = nova música
  $('#edit-heading').textContent = target ? 'Editar música' : 'Colar cifra';
  $('#f-title').value = target?.title ?? '';
  $('#f-artist').value = target?.artist ?? '';
  $('#f-url').value = target?.url ?? '';
  $('#f-text').value = target?.text ?? '';
  $('#clear-markers').hidden = !target;
  updateParseInfo();
  dlgEdit.showModal();
}

function updateParseInfo() {
  const parsed = parseSong($('#f-text').value);
  const t = buildTimeline(parsed, '4/4', 1);
  const secs = parsed.filter((i) => i.kind === 'section').length;
  $('#parse-info').textContent = t.lines.length
    ? `Detectado: ${t.lines.length} linhas de acordes, ${t.steps.length} acordes, ${secs} seções.`
    : $('#f-text').value.trim() ? 'Nenhuma linha de acordes encontrada — confira se os acordes estão em linhas próprias.' : '';
}
$('#f-text').addEventListener('input', updateParseInfo);

// ---------- importar do Cifra Club (via /api/cifra) ----------
async function importFromCifraClub(url) {
  const info = $('#parse-info');
  const btn = $('#btn-import');
  if (!isCifraClubUrl(url)) {
    info.textContent = 'Cole um link no formato cifraclub.com.br/artista/musica/';
    return;
  }
  if ($('#f-text').value.trim() && !confirm('Substituir a cifra que já está na caixa pela importada?')) return;
  btn.disabled = true;
  info.textContent = 'Buscando a cifra…';
  try {
    const r = await fetch('api/cifra?url=' + encodeURIComponent(url.trim()));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Não foi possível importar. Copie e cole o texto da cifra.');
    $('#f-text').value = data.text;
    if (data.title) $('#f-title').value = data.title;
    if (data.artist) $('#f-artist').value = data.artist;
    $('#f-cc').value = '';
    updateParseInfo();
  } catch (e) {
    info.textContent = e instanceof TypeError ? 'Sem conexão com o servidor: a importação precisa de internet e do deploy com /api.' : e.message;
  } finally {
    btn.disabled = false;
  }
}
$('#btn-import').addEventListener('click', () => importFromCifraClub($('#f-cc').value));
$('#f-cc').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); importFromCifraClub($('#f-cc').value); }
});
// colar só o link na caixa da cifra também importa
$('#f-text').addEventListener('paste', (e) => {
  const pasted = (e.clipboardData?.getData('text') ?? '').trim();
  if (pasted && !pasted.includes('\n') && isCifraClubUrl(pasted)) {
    e.preventDefault();
    $('#f-text').value = '';
    importFromCifraClub(pasted);
  }
});

$('#form-edit').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const text = $('#f-text').value;
  const url = $('#f-url').value.trim();
  if (url && !extractVideoId(url)) toast('Não reconheci esse link do YouTube');
  const target = editing ?? store.blankSong();
  const sectionsBefore = editing ? buildTimeline(parseSong(editing.text)).sections.length : 0;
  Object.assign(target, {
    title: $('#f-title').value.trim() || 'Sem título',
    artist: $('#f-artist').value.trim(),
    url,
    text,
  });
  if (editing && buildTimeline(parseSong(text)).sections.length !== sectionsBefore) target.markers = {};
  if (!songs.includes(target)) songs.unshift(target);
  store.saveSongs(songs);
  loadSong(target);
});

$('#clear-markers').addEventListener('click', () => {
  if (!editing) return;
  editing.markers = {};
  if (editing === song) refreshMarkedClasses();
  store.saveSongs(songs);
  toast('Marcadores removidos');
});

$('#btn-new').addEventListener('click', () => openEditor(null));
$('#btn-edit').addEventListener('click', () => openEditor(song));

// ---------- biblioteca ----------
const dlgLib = $('#dlg-library');
function renderLibrary() {
  const list = $('#library-list');
  list.replaceChildren();
  if (!songs.length) list.append(el('li', 'empty', 'Nenhuma música salva.'));
  songs.forEach((s) => {
    const li = el('li', s.id === song?.id ? 'current' : '');
    const meta = el('div', 'meta');
    meta.append(el('b', '', s.title || 'Sem título'), el('small', '', [s.artist, `${s.bpm} BPM`].filter(Boolean).join(' · ')));
    const open = el('button', 'btn primary', 'Abrir');
    open.type = 'button';
    open.addEventListener('click', () => { dlgLib.close(); loadSong(s); });
    const edit = el('button', 'btn', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => { dlgLib.close(); openEditor(s); });
    const del = el('button', 'btn danger icon', '🗑');
    del.type = 'button';
    del.setAttribute('aria-label', `Excluir ${s.title}`);
    del.addEventListener('click', () => {
      if (!confirm(`Excluir “${s.title}” da biblioteca?`)) return;
      songs = songs.filter((x) => x !== s);
      store.saveSongs(songs);
      if (s === song) loadSong(songs[0] ?? makeDemo());
      renderLibrary();
    });
    li.append(meta, open, edit, del);
    list.append(li);
  });
}
$('#btn-library').addEventListener('click', () => { renderLibrary(); dlgLib.showModal(); });
$('#lib-new').addEventListener('click', () => { dlgLib.close(); openEditor(null); });

// ---------- início ----------
function makeDemo() {
  const s = store.blankSong(DEMO_SONG);
  songs.unshift(s);
  store.saveSongs(songs);
  return s;
}

function boot() {
  if (!songs.length) makeDemo();
  const current = songs.find((s) => s.id === store.loadCurrentId()) ?? songs[0];
  loadSong(current);
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

import { parseSong, firstChord } from './parser.js';
import { transposeChord, keyLabel, flatsForSong } from './chords.js';
import { buildSteps, locate, advance, clampSeconds, slideProgress, MIN_SECONDS, MAX_SECONDS } from './steps.js';
import * as store from './storage.js';
import { DEMO_SONG } from './demo.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmtSeconds = (s) => String(s).replace('.', ',') + ' s';

const dom = {
  chart: $('#chart'), track: $('#track'), play: $('#play'), playIcon: $('#play-icon'),
  rng: $('#rng'), speedVal: $('#speed-val'), meta: $('#meta'), toast: $('#toast'),
};

// ---------- estado ----------
const settings = store.loadSettings();
let songs = store.loadSongs();
let song = null;
let items = [];
let seq = { steps: [], lines: [], sections: [] };
let first = null;
let flats = false;
let chips = [];
let lineEls = [];
let lefts = [];
let pos = 0; // índice do acorde atual + fração do tempo dentro dele
let playing = false;
let view = {};
let lastFrame = performance.now();
let scrollTarget = 0;
let manualScrollUntil = 0;
let wakeLock = null;

// ---------- persistência ----------
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (song && songs.includes(song)) store.saveSongs(songs);
  }, 250);
}

function toast(msg, ms = 2800) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => dom.toast.classList.remove('show'), ms);
}

// ---------- carregar música ----------
function loadSong(s) {
  setPlaying(false);
  song = s;
  store.saveCurrentId(s.id);
  items = parseSong(s.text);
  first = firstChord(items);
  seq = buildSteps(items);
  pos = 0;
  setSpeed(s.speed, false);
  build();
}

function build() {
  flats = flatsForSong(first, song.transpose);
  renderChart();
  renderRibbon();
  updateHeader();
  view = {};
  dom.chart.scrollTop = 0;
  scrollTarget = 0;
  measure();
}

const chordName = (name) => transposeChord(name, song.transpose, flats);

function buildChordLine(chords) {
  const pre = el('pre', 'chords');
  const spans = [];
  let col = 0;
  for (const c of chords) {
    const name = chordName(c.name);
    const at = Math.max(c.col, col ? col + 1 : 0);
    pre.append(' '.repeat(at - col));
    const span = el('span', '', name);
    pre.append(span);
    spans.push(span);
    col = at + name.length;
  }
  return { pre, spans };
}

function renderChart() {
  dom.chart.replaceChildren();
  lineEls = [];
  if (!items.length) {
    dom.chart.append(el('div', 'empty', 'Nenhuma cifra ainda. Toque em “Colar cifra”, cole o texto copiado do Cifra Club (acordes acima da letra) e salve.'));
    return;
  }
  const lineByItem = new Map(seq.lines.map((l, i) => [l.itemIdx, i]));
  items.forEach((it, idx) => {
    if (it.kind === 'section') return dom.chart.append(el('div', 'sech', it.name));
    if (it.kind === 'blank') return dom.chart.append(el('div', 'blank'));
    const timed = lineByItem.has(idx);
    const line = el('div', timed ? 'line' : 'line plain');
    let spans = [];
    if (it.chords.length) {
      const built = buildChordLine(it.chords);
      spans = built.spans;
      line.append(built.pre);
    }
    if (it.lyric !== null) line.append(el('pre', 'lyric', it.lyric));
    if (timed) {
      const lineIdx = lineByItem.get(idx);
      line.addEventListener('click', () => jump(seq.lines[lineIdx].first));
      lineEls[lineIdx] = { el: line, spans };
    }
    dom.chart.append(line);
  });
}

function renderRibbon() {
  dom.track.replaceChildren();
  chips = seq.steps.map((st, i) => {
    const chip = el('button', 'chip', chordName(st.name));
    chip.type = 'button';
    if (st.section) chip.append(el('span', 'sec', st.section));
    const fill = el('span', 'fill');
    fill.append(el('i'));
    chip.append(fill);
    chip.addEventListener('click', () => jump(i));
    dom.track.append(chip);
    return chip;
  });
}

function measure() {
  const anchor = parseFloat(getComputedStyle(dom.track).paddingLeft) || 0;
  lefts = chips.map((c) => c.offsetLeft - anchor);
}

function updateHeader() {
  $('#song-title').textContent = song.title || 'Sem título';
  $('#song-sub').textContent = [song.artist, `${fmtSeconds(song.speed)} por acorde`].filter(Boolean).join(' · ');
  $('#key-label').textContent = 'Tom ' + keyLabel(first, song.transpose);
  $('#key-label').title = song.transpose ? `Transposto ${song.transpose > 0 ? '+' : ''}${song.transpose}` : 'Tom original';
}

// ---------- laço de animação ----------
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (song && seq.steps.length) tick(dt, now);
  requestAnimationFrame(frame);
}

function tick(dt, now) {
  if (playing) {
    const r = advance(pos, dt, song.speed, seq.steps.length);
    pos = r.pos;
    if (r.ended) {
      setPlaying(false);
      toast('Fim da cifra');
    }
  }
  const { cur, frac } = locate(seq.steps.length, pos);

  // a fila fica parada no acorde e desliza para o próximo no fim do tempo dele
  const a = lefts[cur] ?? 0;
  const b = lefts[cur + 1] ?? a;
  dom.track.style.transform = `translateX(${-(a + (b - a) * slideProgress(frac))}px)`;

  if (cur !== view.cur) {
    view.cur = cur;
    chips.forEach((c, i) => {
      c.classList.toggle('cur', i === cur);
      c.classList.toggle('next', i === cur + 1);
      c.classList.toggle('past', i < cur);
    });
    const st = seq.steps[cur];
    lineEls.forEach((l, i) => {
      l.el.classList.toggle('current', i === st.lineIdx);
      l.el.classList.toggle('past', i < st.lineIdx);
    });
    lineEls[st.lineIdx]?.spans.forEach((s, i) => {
      s.classList.toggle('cur', i === st.chordIdx);
      s.classList.toggle('nxt', i === st.chordIdx + 1);
    });
    dom.meta.textContent = `${cur + 1} / ${seq.steps.length}`;
    computeScrollTarget(st.lineIdx);
  }
  const fill = chips[cur]?.querySelector('.fill i');
  if (fill) fill.style.transform = `scaleX(${frac})`;

  if (now > manualScrollUntil) {
    const diff = scrollTarget - dom.chart.scrollTop;
    if (Math.abs(diff) > 0.5) dom.chart.scrollTop += reduceMotion.matches ? diff : diff * (1 - Math.exp(-dt * 7));
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Mantém a linha atual e as duas seguintes visíveis. */
function computeScrollTarget(lineIdx) {
  const cur = lineEls[lineIdx];
  if (!cur) return;
  const prev = cur.el.previousElementSibling;
  const top = (prev?.classList.contains('sech') ? prev : cur.el).offsetTop;
  const H = dom.chart.clientHeight;
  const lastEl = (lineEls[Math.min(lineEls.length - 1, lineIdx + 2)] ?? cur).el;
  const bottom = lastEl.offsetTop + lastEl.offsetHeight;
  const hi = top - 12; // no máximo: início da linha (e da seção) visível
  const lo = bottom + 12 - H; // no mínimo: as 2 próximas linhas visíveis
  const preferred = top - H * 0.18;
  scrollTarget = Math.max(0, lo > hi ? hi : Math.min(hi, Math.max(lo, preferred)));
}
for (const ev of ['wheel', 'touchstart', 'touchmove']) {
  dom.chart.addEventListener(ev, () => { manualScrollUntil = performance.now() + 2500; }, { passive: true });
}

// ---------- controles ----------
function setPlaying(p) {
  playing = p;
  dom.playIcon.setAttribute('d', p ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
  dom.play.setAttribute('aria-label', p ? 'Pausar' : 'Tocar');
  keepAwake(p);
}

/** Mantém a tela acesa enquanto a cifra anda (suporte de partitura). */
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}

function jump(i) {
  if (!seq.steps.length) return;
  pos = Math.max(0, Math.min(seq.steps.length - 1, i));
  manualScrollUntil = 0;
  view.cur = -1;
}
const stepBy = (d) => jump(Math.floor(pos) + d);

function togglePlay() {
  if (!seq.steps.length) return toast('Cole uma cifra primeiro');
  if (!playing && pos >= seq.steps.length - 0.01) jump(0); // só reinicia se a cifra já terminou
  setPlaying(!playing);
}

function setSpeed(v, save = true) {
  const s = clampSeconds(v);
  song.speed = s;
  dom.rng.value = s;
  dom.speedVal.textContent = fmtSeconds(s);
  document.querySelectorAll('.presets .btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === s));
  if (save) {
    updateHeader();
    persist();
  }
}

function setTranspose(d) {
  song.transpose = Math.max(-11, Math.min(11, song.transpose + d));
  const keep = pos;
  build();
  pos = keep;
  persist();
}

function setFont(d) {
  const now = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 28;
  settings.fontSize = Math.max(16, Math.min(44, (settings.fontSize ?? now) + d));
  document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  store.saveSettings(settings);
  requestAnimationFrame(() => {
    measure();
    view.cur = -1;
  });
}

dom.play.addEventListener('click', togglePlay);
$('#prev').addEventListener('click', () => stepBy(-1));
$('#next').addEventListener('click', () => stepBy(1));
$('#speed-down').addEventListener('click', () => setSpeed(song.speed + 0.25)); // − = mais lento
$('#speed-up').addEventListener('click', () => setSpeed(song.speed - 0.25)); // + = mais rápido
dom.rng.addEventListener('input', () => setSpeed(Number(dom.rng.value)));
document.querySelectorAll('.presets .btn').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.s))));
$('#key-down').addEventListener('click', () => setTranspose(-1));
$('#key-up').addEventListener('click', () => setTranspose(1));
$('#font-up').addEventListener('click', () => setFont(2));
$('#font-down').addEventListener('click', () => setFont(-2));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, dialog[open]')) return;
  if (e.key === ' ' && e.target.closest?.('button')) return; // espaço no botão focado aciona o próprio botão
  const action = {
    ' ': togglePlay,
    ArrowRight: () => stepBy(1),
    ArrowLeft: () => stepBy(-1),
    ArrowUp: () => setSpeed(song.speed - 0.25),
    ArrowDown: () => setSpeed(song.speed + 0.25),
  }[e.key];
  if (action) {
    e.preventDefault();
    action();
  }
});
window.addEventListener('resize', () => {
  measure();
  view.cur = -1;
});
document.fonts?.ready.then(() => { measure(); view.cur = -1; });

// ---------- editor ----------
const dlgEdit = $('#dlg-edit');
let editing = null; // null = nova música

function openEditor(target) {
  editing = target;
  $('#edit-heading').textContent = target ? 'Editar música' : 'Colar cifra';
  $('#f-title').value = target?.title ?? '';
  $('#f-artist').value = target?.artist ?? '';
  $('#f-text').value = target?.text ?? '';
  updateParseInfo();
  dlgEdit.showModal();
}

function updateParseInfo() {
  const text = $('#f-text').value;
  const parsed = buildSteps(parseSong(text));
  const sections = parseSong(text).filter((i) => i.kind === 'section').length;
  $('#parse-info').textContent = parsed.steps.length
    ? `Detectado: ${parsed.lines.length} linhas de acordes, ${parsed.steps.length} acordes, ${sections} seções.`
    : text.trim() ? 'Nenhuma linha de acordes encontrada — confira se os acordes estão em linhas próprias.' : '';
}
$('#f-text').addEventListener('input', updateParseInfo);

// colar só um link do Cifra Club na caixa: a página não pode ser lida pelo app, então orienta o favorito
$('#f-text').addEventListener('paste', (e) => {
  const pasted = (e.clipboardData?.getData('text') ?? '').trim();
  if (pasted && !pasted.includes('\n') && /^https?:\/\/(www\.|m\.)?cifraclub\.com(\.br)?\//i.test(pasted)) {
    e.preventDefault();
    $('#parse-info').textContent = 'Links não podem ser lidos pelo app. Abra a cifra no Cifra Club e clique no favorito “Enviar ao Cifra Sync” (acima), ou copie o texto da cifra e cole aqui.';
  }
});

// ---------- favorito de importação (roda no navegador, na página do Cifra Club) ----------
function bookmarkletHref() {
  const code = `(()=>{var p=document.querySelector('pre');if(!p){alert('Não encontrei a cifra nesta página.');return}`
    + `var t=function(s){var e=document.querySelector(s);return e?e.innerText.trim():''};`
    + `var d=JSON.stringify({title:t('h1')||document.title,artist:t('h2'),text:p.innerText});`
    + `var b=btoa(String.fromCharCode.apply(null,new TextEncoder().encode(d)));`
    + `window.open('${location.origin}/#import='+encodeURIComponent(b),'_blank')})()`;
  return 'javascript:' + encodeURIComponent(code);
}
$('#bookmarklet').setAttribute('href', bookmarkletHref());
$('#bookmarklet').addEventListener('click', (e) => {
  e.preventDefault();
  toast('Arraste o botão para a barra de favoritos, não clique');
});

/** Abre o editor com a cifra enviada pelo favorito (#import=base64(JSON utf-8)). */
function importFromHash() {
  const m = /^#import=(.+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const bin = atob(decodeURIComponent(m[1]));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('vazio');
    openEditor(null);
    $('#f-title').value = String(data.title ?? '').slice(0, 200);
    $('#f-artist').value = String(data.artist ?? '').slice(0, 200);
    $('#f-text').value = data.text;
    updateParseInfo();
  } catch {
    toast('Não consegui ler a cifra enviada pelo favorito');
  }
}

$('#form-edit').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const target = editing ?? store.blankSong();
  Object.assign(target, {
    title: $('#f-title').value.trim() || 'Sem título',
    artist: $('#f-artist').value.trim(),
    text: $('#f-text').value,
  });
  if (!songs.includes(target)) songs.unshift(target);
  store.saveSongs(songs);
  loadSong(target);
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
    const li = el('li', s === song ? 'current' : '');
    const meta = el('div', 'meta');
    meta.append(el('b', '', s.title || 'Sem título'), el('small', '', [s.artist, `${fmtSeconds(s.speed)} por acorde`].filter(Boolean).join(' · ')));
    const open = el('button', 'btn primary', 'Abrir');
    open.type = 'button';
    open.addEventListener('click', () => { dlgLib.close(); loadSong(s); });
    const edit = el('button', 'btn', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => { dlgLib.close(); openEditor(s); });
    const del = el('button', 'btn icon', '🗑');
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
  if (settings.fontSize) document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  if (!songs.length) makeDemo();
  loadSong(songs.find((s) => s.id === store.loadCurrentId()) ?? songs[0]);
  requestAnimationFrame(frame);
  importFromHash();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

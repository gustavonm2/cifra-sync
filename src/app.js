import { parseSong, firstChord } from './parser.js';
import { transposeChord, flatsForSong, chordNotes } from './chords.js';
import { genresOf, PRESET_GENRES } from './library.js';
import { simplifyAll, keyName } from './harmony.js';
import { buildSteps, locate, advance, clampSeconds, slideProgress, slideFrom, HOLD_OPTIONS } from './steps.js';
import { ChordListener } from './audio.js';
import { Follower } from './follow.js';
import { durationsFromStarts, isValidTiming, durationFn } from './timing.js';
import { Library, CloudClient } from './library.js';
import { createLibraryUI } from './library-ui.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
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
const lib = new Library({
  io: store,
  cloud: new CloudClient({ url: SUPABASE_URL, key: SUPABASE_KEY }),
  onChange: () => { libUI?.refresh(); updateCloudDot(); },
});
let libUI = null;
let run = null; // playlist em execução: { id, index }
let recording = false; // gravando a duração de cada acorde (seguindo o áudio)
let durOf = () => 2.5; // duração (s) do acorde i
let song = null;
let items = [];
let seq = { steps: [], lines: [], sections: [] };
let first = null;
let flats = false;
let simp = null; // Map acorde original → simplificado (quando "Simplificar" está ligado)
let songKey = null; // tom detectado, usado na simplificação
let chips = [];
let lineEls = [];
let lefts = [];
let pos = 0; // índice do acorde atual + fração do tempo dentro dele
let playing = false;
let view = {};
let lastFrame = performance.now();
let scrollTarget = 0;
let shownX = 0;
let manualScrollUntil = 0;
let wakeLock = null;
let phase = 'idle'; // 'idle' | 'starting' | 'counting' | 'arming' | 'playing'
let countdownEnd = 0;
let follower = null;
let listener = null;
let lastSoundAt = 0;
const nowSec = () => performance.now() / 1000;
const SILENCE_PAUSE = 6; // s sem tocar (seguindo o áudio) → espera você voltar

// ---------- persistência ----------
/** Marca a música atual como alterada: salva no aparelho e sincroniza com a nuvem. */
function persist() {
  if (song) lib.touchSong(song);
}

/** Duração de cada acorde: andamento gravado (se válido), senão velocidade × "segurar". */
function refreshDur() {
  const timing = song && isValidTiming(song.timing, seq.steps.length) ? song.timing : null;
  durOf = durationFn({ speed: song?.speed ?? 2.5, holds: song?.holds ?? {}, timing });
  refreshTimingCard();
}

function toast(msg, ms = 2800) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => dom.toast.classList.remove('show'), ms);
}

// ---------- carregar música ----------
function loadSong(s) {
  stopAll();
  song = s;
  store.saveCurrentId(s.id);
  items = parseSong(s.text);
  first = firstChord(items);
  seq = buildSteps(items);
  pos = 0;
  setSpeed(s.speed, false);
  build();
  refreshDur();
  updateRunBar();
}

function buildSimplification() {
  simp = null;
  songKey = null;
  const names = [...new Set(seq.steps.map((st) => st.name))];
  if (!names.length) return;
  const all = simplifyAll(seq.steps.map((st) => st.name));
  songKey = all.key;
  if (song.simplified) simp = new Map(seq.steps.map((st, i) => [st.name, all.names[i]]));
}

function build() {
  buildSimplification();
  flats = flatsForSong(first, song.transpose);
  renderChart();
  renderRibbon();
  renderChordList();
  listener?.setVocabulary(displayNames());
  follower = null;
  updateHeader();
  view = {};
  dom.chart.scrollTop = 0;
  scrollTarget = 0;
  measure();
}

const chordName = (name) => transposeChord(simp?.get(name) ?? name, song.transpose, flats);

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
    if ((song.holds[i] ?? 1) > 1) chip.append(el('span', 'hold', `×${song.holds[i]}`.replace('.', ',')));
    const fill = el('span', 'fill');
    fill.append(el('i'));
    chip.append(fill);
    chip.addEventListener('click', () => jump(i));
    dom.track.append(chip);
    return chip;
  });
}

const displayNames = () => seq.steps.map((st) => chordName(st.name));
let chordButtons = new Map();

/** Caixa lateral: cada acorde diferente da música, com as notas dele; clicar pula para a 1ª vez em que aparece. */
function renderChordList() {
  const list = $('#chord-list');
  list.replaceChildren();
  chordButtons = new Map();
  const names = displayNames();
  const unique = [...new Set(names)];
  $('#chord-count').textContent = unique.length ? `${unique.length} acordes` : '';
  unique.forEach((name) => {
    const count = names.filter((n) => n === name).length;
    const b = el('button', 'cc');
    b.type = 'button';
    b.append(el('b', '', name), el('small', '', `×${count}`), el('span', 'notes', chordNotes(name, flats).join(' · ')));
    b.addEventListener('click', () => jump(names.indexOf(name)));
    list.append(b);
    chordButtons.set(name, b);
  });
}

function measure() {
  const anchor = parseFloat(getComputedStyle(dom.track).paddingLeft) || 0;
  lefts = chips.map((c) => c.offsetLeft - anchor);
}

function updateHeader() {
  $('#song-title').textContent = song.title || 'Sem título';
  $('#song-sub').textContent = [song.artist, song.genre, `${fmtSeconds(song.speed)} por acorde`, song.simplified ? 'simplificada' : ''].filter(Boolean).join(' · ');
  $('#key-label').textContent = 'Tom ' + (first ? chordName(first).replace(/\/.*$/, '') : '—');
  $('#key-label').title = (song.transpose ? `Transposto ${song.transpose > 0 ? '+' : ''}${song.transpose / 2} tom` : 'Tom original') + (songKey ? ` · campo de ${keyName(songKey)}` : '');
  $('#simplify').setAttribute('aria-pressed', String(!!song.simplified));
}

// ---------- laço de animação ----------
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (song && seq.steps.length) tick(dt, now);
  requestAnimationFrame(frame);
}

function tick(dt, now) {
  if (phase === 'counting') updateCountdown();
  if (playing) {
    if (follower) {
      pos = Math.min(follower.position(nowSec()), seq.steps.length - 1e-3);
      if (nowSec() - lastSoundAt > SILENCE_PAUSE) waitForPlayer('Parei de ouvir você.');
      else if (follower.cur >= seq.steps.length - 1 && nowSec() - follower.t0 > follower.speed * 1.2) finish();
    } else {
      const r = advance(pos, dt, durOf, seq.steps.length);
      pos = r.pos;
      if (r.ended) finish();
    }
  }
  const { cur, frac } = locate(seq.steps.length, pos);

  // a fila fica parada no acorde e desliza para o próximo no fim do tempo dele;
  // o deslocamento mostrado persegue o alvo, suavizando pulos (clique, acorde ouvido)
  const a = lefts[cur] ?? 0;
  const b = lefts[cur + 1] ?? a;
  const target = a + (b - a) * slideProgress(frac, slideFrom(durOf(cur)));
  shownX += (target - shownX) * (1 - Math.exp(-dt * 16));
  if (Math.abs(target - shownX) < 0.3) shownX = target;
  dom.track.style.transform = `translateX(${-shownX}px)`;

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
    const names = displayNames();
    chordButtons.forEach((btn, name) => {
      btn.classList.toggle('cur', name === names[cur]);
      btn.classList.toggle('next', name === names[cur + 1] && name !== names[cur]);
    });
    chordButtons.get(names[cur])?.scrollIntoView?.({ block: 'nearest' });
    refreshHoldCard();
    computeScrollTarget(st.lineIdx);
  }
  if (follower) {
    const txt = `~${fmtSeconds(follower.speed.toFixed(1))}`; // velocidade que o app está medindo no seu toque
    if (txt !== view.speedTxt) {
      view.speedTxt = txt;
      dom.speedVal.textContent = txt;
    }
  } else if (view.speedTxt) {
    view.speedTxt = null;
    dom.speedVal.textContent = fmtSeconds(song.speed);
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
  dom.playIcon.setAttribute('d', p || phase !== 'idle' ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
  dom.play.setAttribute('aria-label', p || phase !== 'idle' ? 'Pausar' : 'Tocar');
  keepAwake(p || phase !== 'idle');
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
  follower?.seek(Math.floor(pos), nowSec());
  manualScrollUntil = 0;
  view.cur = -1;
}
const stepBy = (d) => jump(Math.floor(pos) + d);

// ---------- início: direto, contagem ou ouvindo o primeiro acorde ----------
const needsMic = () => settings.start === 'listen' || settings.follow;

function ensureListener() {
  if (listener) return listener;
  listener = new ChordListener({
    onChord: (name, score, strength) => {
      $('#heard').textContent = `${name} · ${Math.round(score * 100)}%`;
      if (phase === 'arming') {
        if (name === displayNames()[Math.floor(pos)]) startRunning(true);
      } else if (phase === 'playing' && follower) {
        follower.hear(name, strength, nowSec());
      }
    },
    onLevel: (rms, gate) => {
      const w = Math.min(1, rms / 0.15) * 100 + '%';
      const hot = rms >= gate;
      for (const id of ['#meter-i', '#ov-meter-i']) {
        $(id).style.width = w;
        $(id).classList.toggle('hot', hot);
      }
      if (hot) lastSoundAt = nowSec();
    },
  });
  listener.setVocabulary(displayNames());
  return listener;
}

async function startMic() {
  try {
    await ensureListener().start();
    lastSoundAt = nowSec();
    $('#mic').hidden = false;
    return true;
  } catch (e) {
    toast(e.message, 5000);
    return false;
  }
}

function stopMic() {
  listener?.stop();
  $('#mic').hidden = true;
  $('#heard').textContent = 'ouvindo…';
}

function showOverlay({ label, big = null, chord = null, sub = '', mic = false, now = false }) {
  $('#ov-label').textContent = label;
  $('#ov-big').hidden = big === null;
  $('#ov-big').textContent = big ?? '';
  $('#ov-chord').hidden = chord === null;
  $('#ov-chord').textContent = chord ?? '';
  $('#ov-sub').textContent = sub;
  $('#ov-mic').hidden = !mic;
  $('#ov-now').hidden = !now;
  $('#overlay').hidden = false;
}
const hideOverlay = () => { $('#overlay').hidden = true; };

async function begin() {
  if (!seq.steps.length) return toast('Cole uma cifra primeiro');
  if (pos >= seq.steps.length - 0.01) jump(0);
  phase = 'starting'; // bloqueia novo play enquanto o microfone é aberto
  setPlaying(false);
  if (needsMic() && !(await startMic())) {
    if (settings.start === 'listen') return stopAll();
    toast('Seguindo sem o microfone: velocidade manual.');
  }
  if (phase !== 'starting') return; // cancelado enquanto pedia o microfone
  if (settings.start === 'count') {
    phase = 'counting';
    countdownEnd = performance.now() + settings.countSec * 1000;
    showOverlay({ label: 'Prepare-se', big: String(settings.countSec), chord: displayNames()[Math.floor(pos)], sub: 'A cifra começa quando chegar a zero.', now: true });
  } else if (settings.start === 'listen') {
    phase = 'arming';
    showOverlay({ label: 'Toque para começar', chord: displayNames()[Math.floor(pos)], sub: 'A cifra começa quando eu ouvir esse acorde.', mic: true, now: true });
  } else {
    startRunning(false);
  }
  if (phase !== 'playing') setPlaying(false); // atualiza o ícone nos modos de espera
}

function updateCountdown() {
  const left = (countdownEnd - performance.now()) / 1000;
  if (left <= 0) return startRunning(false);
  const n = String(Math.ceil(left));
  if ($('#ov-big').textContent !== n) $('#ov-big').textContent = n;
}

/** Começa a andar. heard = true quando o acorde foi ouvido (já passaram ~0,2 s do início dele). */
function startRunning(heard) {
  hideOverlay();
  phase = 'playing';
  const idx = Math.floor(pos);
  if (settings.follow) {
    follower = new Follower(displayNames(), { cur: idx, speed: song.speed, now: nowSec() - (heard ? 0.2 : 0), holds: song.holds });
  } else {
    follower = null;
    pos = idx + (heard ? 0.2 / song.speed : 0);
    stopMic(); // sem seguir o áudio, o microfone só serviu para ouvir o 1º acorde
  }
  recording = !!follower && settings.record;
  lastSoundAt = nowSec();
  setPlaying(true);
}

/** Parou de tocar: pausa e espera o acorde atual para continuar. */
function waitForPlayer(why) {
  recording = false; // parou no meio: a gravação em andamento é descartada
  if (follower) song.speed = clampSeconds(follower.speed);
  follower = null;
  setPlaying(false);
  phase = 'arming';
  showOverlay({ label: why, chord: displayNames()[Math.floor(pos)], sub: 'Toque esse acorde para continuar.', mic: true, now: true });
  setPlaying(false);
}

function finish() {
  const next = run && run.index < lib.playlistSongs(run.id).length - 1 ? lib.playlistSongs(run.id)[run.index + 1] : null;
  const saved = recording ? finalizeRecording(true) : false;
  stopAll();
  toast(saved ? 'Andamento gravado e salvo na música.' : next ? `Fim da cifra · próxima: ${next.title} (▶)` : 'Fim da cifra');
}

/** Transforma o que foi ouvido (início de cada acorde) em andamento salvo na música. */
function finalizeRecording(finished) {
  recording = false;
  const f = follower;
  if (!f) return false;
  const last = seq.steps.length - 1;
  const endTime = finished && f.cur >= last ? f.starts[last] + f.speed : null;
  const timing = durationsFromStarts(f.starts, seq.steps.length, endTime);
  if (!timing || !isValidTiming(timing, seq.steps.length)) {
    toast('Gravação incompleta: o andamento não foi salvo. Toque a música inteira, sem pular.', 5000);
    return false;
  }
  song.timing = timing;
  setSpeed(timing.base, false);
  persist();
  refreshDur();
  return true;
}

function stopAll() {
  if (recording && follower) finalizeRecording(false);
  recording = false;
  if (follower) {
    setSpeed(follower.speed);
    follower = null;
  }
  phase = 'idle';
  hideOverlay();
  stopMic();
  setPlaying(false);
}

function togglePlay() {
  if (phase !== 'idle') return stopAll();
  begin();
}

function setSpeed(v, save = true) {
  const s = clampSeconds(v);
  song.speed = s;
  if (follower) follower.speed = s;
  dom.rng.value = s;
  dom.speedVal.textContent = fmtSeconds(s);
  document.querySelectorAll('.presets .btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === s));
  refreshDur();
  if (save) {
    updateHeader();
    persist();
  }
}

// ---------- segurar acordes ----------
const holdLabel = (m) => (m === 1 ? 'normal' : `×${String(m).replace('.', ',')}`);

function refreshHoldCard() {
  const i = Math.floor(pos);
  const st = seq.steps[i];
  if (!st) return;
  $('#hold-chord').textContent = `${chordName(st.name)} · ${i + 1}`;
  $('#hold-val').textContent = holdLabel(song.holds[i] ?? 1);
}

function setHold(i, value) {
  if (value === 1) delete song.holds[i];
  else song.holds[i] = value;
  const chip = chips[i];
  chip?.querySelector('.hold')?.remove();
  if (chip && value > 1) chip.prepend(el('span', 'hold', holdLabel(value)));
  refreshHoldCard();
  refreshDur();
  persist();
}

function stepHold(d) {
  const i = Math.floor(pos);
  if (!seq.steps[i]) return;
  const k = HOLD_OPTIONS.indexOf(song.holds[i] ?? 1);
  setHold(i, HOLD_OPTIONS[Math.max(0, Math.min(HOLD_OPTIONS.length - 1, (k < 0 ? 0 : k) + d))]);
}
$('#hold-down').addEventListener('click', () => stepHold(-1));
$('#hold-up').addEventListener('click', () => stepHold(1));

/** Muda o tom em semitons (±1 = meio tom, ±2 = 1 tom), mantendo a posição e o seguimento do áudio. */
function setTranspose(d) {
  song.transpose = Math.max(-11, Math.min(11, song.transpose + d));
  rebuildKeepingPosition();
  persist();
}

function rebuildKeepingPosition() {
  const keep = pos;
  const was = follower;
  build();
  pos = keep;
  if (was) follower = new Follower(displayNames(), { cur: Math.floor(keep), speed: was.speed, now: nowSec() - (keep % 1) * was.speed, holds: song.holds });
}

function toggleSimplify() {
  song.simplified = !song.simplified;
  rebuildKeepingPosition();
  persist();
  toast(song.simplified
    ? `Acordes simplificados${songKey ? ` (campo de ${keyName(songKey)})` : ''}.`
    : 'Acordes originais.');
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
$('#ov-cancel').addEventListener('click', stopAll);
$('#ov-now').addEventListener('click', () => startRunning(false));
$('#side-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('side-open');
  $('#side-toggle').setAttribute('aria-expanded', String(open));
});

const HINTS = {
  now: 'A cifra começa a andar assim que você der play.',
  count: 'Contagem regressiva antes de a cifra começar a andar.',
  listen: 'Dê play e toque o primeiro acorde: a cifra começa quando o app ouvir (usa o microfone).',
};
function renderStartControls() {
  document.querySelectorAll('[data-start]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.start === settings.start)));
  $('#count-row').hidden = settings.start !== 'count';
  $('#count-val').textContent = settings.countSec + ' s';
  $('#follow').setAttribute('aria-pressed', String(settings.follow));
  $('#record').setAttribute('aria-pressed', String(settings.record));
  $('#record').hidden = !settings.follow;
  $('#start-hint').textContent = HINTS[settings.start] + (settings.follow ? ' Depois, a cifra acompanha o que você toca e ajusta a velocidade sozinha.' : '');
}
document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
  settings.start = b.dataset.start;
  store.saveSettings(settings);
  renderStartControls();
}));
function stepCount(d) {
  const opts = [3, 5, 10, 15];
  const i = Math.max(0, Math.min(opts.length - 1, opts.indexOf(settings.countSec) + d));
  settings.countSec = opts[i];
  store.saveSettings(settings);
  renderStartControls();
}
$('#count-down').addEventListener('click', () => stepCount(-1));
$('#count-up').addEventListener('click', () => stepCount(1));
$('#record').addEventListener('click', () => {
  settings.record = !settings.record;
  store.saveSettings(settings);
  renderStartControls();
});
$('#follow').addEventListener('click', () => {
  settings.follow = !settings.follow;
  store.saveSettings(settings);
  renderStartControls();
  if (settings.follow && !navigator.mediaDevices?.getUserMedia) toast('Este navegador não permite usar o microfone aqui (precisa de HTTPS).', 5000);
});
renderStartControls();

// altura da barra inferior (usada pela gaveta no celular)
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', $('.bar').offsetHeight + 'px')).observe($('.bar'));
$('#prev').addEventListener('click', () => stepBy(-1));
$('#next').addEventListener('click', () => stepBy(1));
$('#speed-down').addEventListener('click', () => setSpeed(song.speed + 0.25)); // − = mais lento
$('#speed-up').addEventListener('click', () => setSpeed(song.speed - 0.25)); // + = mais rápido
dom.rng.addEventListener('input', () => setSpeed(Number(dom.rng.value)));
document.querySelectorAll('.presets .btn').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.s))));
$('#key-m2').addEventListener('click', () => setTranspose(-2));
$('#key-m1').addEventListener('click', () => setTranspose(-1));
$('#key-p1').addEventListener('click', () => setTranspose(1));
$('#key-p2').addEventListener('click', () => setTranspose(2));
$('#simplify').addEventListener('click', toggleSimplify);
$('#font-up').addEventListener('click', () => setFont(2));
$('#font-down').addEventListener('click', () => setFont(-2));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, dialog[open]')) return;
  if (e.key === 'Escape' && phase !== 'idle') return stopAll();
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
  $('#f-genre').value = target?.genre ?? '';
  fillGenreOptions();
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

function fillGenreOptions() {
  const dl = $('#genre-list');
  dl.replaceChildren();
  [...new Set([...genresOf(lib.visibleSongs), ...PRESET_GENRES])].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((g) => {
    const o = el('option');
    o.value = g;
    dl.append(o);
  });
}

$('#form-edit').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const fields = {
    title: $('#f-title').value.trim() || 'Sem título',
    artist: $('#f-artist').value.trim(),
    genre: $('#f-genre').value.trim(),
    text: $('#f-text').value,
  };
  let target = editing;
  if (target) {
    const before = buildSteps(parseSong(target.text)).steps.length;
    Object.assign(target, fields);
    if (buildSteps(parseSong(target.text)).steps.length !== before) {
      target.holds = {}; // os índices dos acordes mudaram
      target.timing = null;
    }
    lib.touchSong(target);
  } else {
    target = lib.addSong(fields);
  }
  loadSong(target);
});

$('#btn-new').addEventListener('click', () => openEditor(null));
$('#btn-edit').addEventListener('click', () => openEditor(song));

// ---------- biblioteca e playlists ----------
const dlgLib = $('#dlg-library');
libUI = createLibraryUI({
  lib,
  dlg: dlgLib,
  body: $('#lib-body'),
  currentSongId: () => song?.id,
  onOpenSong: (s) => { run = null; dlgLib.close(); loadSong(s); },
  onEditSong: (s) => { dlgLib.close(); openEditor(s); },
  onNewSong: () => { dlgLib.close(); openEditor(null); },
  onPlayPlaylist: (id) => { dlgLib.close(); playPlaylist(id, 0); },
  onCodeChanged: () => {
    // a música aberta pode não existir na biblioteca do código novo
    if (!lib.song(song.id)) loadSong(lib.visibleSongs[0] ?? lib.addSong(DEMO_SONG));
  },
});
$('#btn-library').addEventListener('click', () => libUI.open('list'));

function updateCloudDot() {
  const dot = $('#cloud-dot');
  if (!dot) return;
  const { state } = lib.status;
  dot.dataset.state = lib.cloudOn ? state : 'off';
  dot.title = { ok: 'Sincronizado com a nuvem', syncing: 'Sincronizando…', offline: 'Sem internet: salvo neste aparelho', error: 'Erro na nuvem: ' + lib.status.message, idle: 'Nuvem pronta', off: 'Só neste aparelho' }[dot.dataset.state];
}

/** Toca uma playlist a partir da música `index`. */
function playPlaylist(id, index) {
  const songs = lib.playlistSongs(id);
  if (!songs.length) return toast('Esta playlist está vazia.');
  run = { id, index: Math.max(0, Math.min(songs.length - 1, index)) };
  loadSong(songs[run.index]);
}

function runStep(d) {
  if (!run) return;
  const songs = lib.playlistSongs(run.id);
  const i = run.index + d;
  if (i < 0 || i >= songs.length) return toast(d > 0 ? 'Fim da playlist.' : 'Início da playlist.');
  playPlaylist(run.id, i);
}

function updateRunBar() {
  const bar = $('#run');
  if (!run || !lib.playlist(run.id)) {
    run = null;
    bar.hidden = true;
    return;
  }
  const p = lib.playlist(run.id);
  const songs = lib.playlistSongs(run.id);
  const idx = songs.findIndex((s) => s.id === song.id);
  if (idx < 0) {
    run = null;
    bar.hidden = true;
    return;
  }
  run.index = idx;
  bar.hidden = false;
  $('#run-info').textContent = `${p.name} · ${idx + 1}/${songs.length}`;
  $('#run-prev').disabled = idx === 0;
  $('#run-next').disabled = idx === songs.length - 1;
}
$('#run-prev').addEventListener('click', () => runStep(-1));
$('#run-next').addEventListener('click', () => runStep(1));
$('#run-stop').addEventListener('click', () => { run = null; updateRunBar(); });

// ---------- andamento gravado ----------
function refreshTimingCard() {
  const info = $('#timing-info');
  if (!info) return;
  const ok = song && isValidTiming(song.timing, seq.steps.length);
  if (ok) {
    info.textContent = `Gravado: ${seq.steps.length} acordes, média de ${fmtSeconds(song.timing.base)}. A cifra repete esse tempo; a velocidade acelera ou desacelera tudo na mesma proporção.`;
  } else if (song?.timing) {
    info.textContent = 'O andamento gravado não combina mais com esta cifra (ela foi alterada). Grave de novo.';
  } else {
    info.textContent = 'Nenhum andamento gravado. Ative “Gravar o andamento ao tocar” e “Seguir o meu áudio”, toque a música inteira uma vez, e o tempo de cada acorde fica salvo com a música.';
  }
  $('#timing-clear').hidden = !song?.timing;
}
$('#timing-clear').addEventListener('click', () => {
  if (!song.timing || !confirm('Apagar o andamento gravado desta música?')) return;
  song.timing = null;
  persist();
  refreshDur();
});

// ---------- início ----------
function boot() {
  if (settings.fontSize) document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  if (!lib.visibleSongs.length) lib.addSong(DEMO_SONG);
  loadSong(lib.song(lib.resolveId(store.loadCurrentId())) ?? lib.visibleSongs[0]);
  updateCloudDot();
  lib.sync();
  addEventListener('online', () => lib.sync());
  requestAnimationFrame(frame);
  importFromHash();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

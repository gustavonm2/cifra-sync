// Persistência em localStorage, com fallback em memória se o acesso falhar.

const memory = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw);
  } catch {}
  return memory.has(key) ? memory.get(key) : fallback;
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const SONGS = 'cifrasync.songs';
const CURRENT = 'cifrasync.current';
const SETTINGS = 'cifrasync.settings';

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function blankSong(over = {}) {
  return {
    id: newId(),
    title: '',
    artist: '',
    text: '',
    url: '',
    bpm: 92,
    transpose: 0,
    barsPerLine: 2,
    meter: '4/4',
    offset: 0,
    markers: {},
    sync: false,
    ...over,
  };
}

export const loadSongs = () => read(SONGS, []).map((s) => blankSong(s));
export const saveSongs = (songs) => write(SONGS, songs);
export const loadCurrentId = () => read(CURRENT, null);
export const saveCurrentId = (id) => write(CURRENT, id);
export const loadSettings = () => ({ sound: true, fontSize: 28, ...read(SETTINGS, {}) });
export const saveSettings = (s) => write(SETTINGS, s);

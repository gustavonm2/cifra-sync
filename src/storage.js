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

/** Música com todos os campos; campos antigos (bpm, marcadores…) de versões anteriores são ignorados. */
export function blankSong(over = {}) {
  return {
    id: over.id ?? newId(),
    title: over.title ?? '',
    artist: over.artist ?? '',
    text: over.text ?? '',
    transpose: Number.isFinite(over.transpose) ? over.transpose : 0,
    speed: Number.isFinite(over.speed) ? over.speed : 2.5, // segundos por acorde
  };
}

export const loadSongs = () => read(SONGS, []).map((s) => blankSong(s));
export const saveSongs = (songs) => write(SONGS, songs);
export const loadCurrentId = () => read(CURRENT, null);
export const saveCurrentId = (id) => write(CURRENT, id);
export const loadSettings = () => ({ fontSize: null, start: 'count', countSec: 3, follow: false, ...read(SETTINGS, {}) });
export const saveSettings = (s) => write(SETTINGS, s);

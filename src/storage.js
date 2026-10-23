// Persistência em localStorage, com fallback em memória se o acesso falhar.

const memory = new Map();

export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw);
  } catch {}
  return memory.has(key) ? memory.get(key) : fallback;
}

export function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const KEYS = {
  songs: 'cifrasync.songs',
  playlists: 'cifrasync.playlists',
  current: 'cifrasync.current',
  settings: 'cifrasync.settings',
  code: 'cifrasync.library-code',
  meta: 'cifrasync.sync-meta',
};

export const loadRawSongs = () => read(KEYS.songs, []);
export const saveRawSongs = (v) => write(KEYS.songs, v);
export const loadRawPlaylists = () => read(KEYS.playlists, []);
export const saveRawPlaylists = (v) => write(KEYS.playlists, v);
export const loadCurrentId = () => read(KEYS.current, null);
export const saveCurrentId = (id) => write(KEYS.current, id);
export const loadCode = () => read(KEYS.code, null);
export const saveCode = (c) => write(KEYS.code, c);
export const loadMeta = () => read(KEYS.meta, {});
export const saveMeta = (m) => write(KEYS.meta, m);
export const loadSettings = () => ({ fontSize: null, start: 'count', countSec: 3, follow: false, record: false, ...read(KEYS.settings, {}) });
export const saveSettings = (s) => write(KEYS.settings, s);

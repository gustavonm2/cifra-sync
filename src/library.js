// Biblioteca: músicas (com estilo e andamento), playlists e sincronização com a nuvem.
// Local primeiro: tudo funciona offline e é guardado no aparelho; quando há conexão e um código de
// biblioteca, as alterações pendentes (dirty) sobem e o que mudou na nuvem desce.

import { CloudClient, CloudError, isUuid, newUuid, songToRow, songFromRow, playlistToRow, playlistFromRow, mergeRemote } from './cloud.js';

export const PRESET_GENRES = ['Sertanejo', 'MPB', 'Rock', 'Pop', 'Gospel', 'Samba', 'Pagode', 'Forró', 'Blues', 'Jazz', 'Infantil'];

const clamp = (n, lo, hi, fb) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb);
const str = (v, max) => String(v ?? '').slice(0, max);

/** Normaliza uma música guardada (inclusive formatos antigos, com id curto e campos de BPM). */
export function normalizeSong(raw) {
  const legacy = !isUuid(raw.id);
  const t = raw.timing;
  return {
    id: legacy ? newUuid() : raw.id,
    legacyId: legacy ? raw.id : undefined,
    title: str(raw.title, 200),
    artist: str(raw.artist, 200),
    genre: str(raw.genre, 60),
    text: str(raw.text, 100000),
    transpose: Math.round(clamp(raw.transpose, -11, 11, 0)),
    speed: clamp(raw.speed, 0.25, 10, 2.5),
    simplified: !!raw.simplified,
    holds: raw.holds && typeof raw.holds === 'object' && !Array.isArray(raw.holds) ? raw.holds : {},
    timing: t && Number.isFinite(t.base) && Array.isArray(t.durations) ? t : null,
    updatedAt: raw.updatedAt ?? null,
    dirty: legacy ? true : raw.dirty ?? true,
    rev: raw.rev ?? 0,
    deleted: !!raw.deleted,
  };
}

export function normalizePlaylist(raw) {
  return {
    id: isUuid(raw.id) ? raw.id : newUuid(),
    name: str(raw.name, 100) || 'Playlist',
    genre: str(raw.genre, 60),
    songIds: Array.isArray(raw.songIds) ? raw.songIds.filter(isUuid).slice(0, 500) : [],
    updatedAt: raw.updatedAt ?? null,
    dirty: raw.dirty ?? true,
    rev: raw.rev ?? 0,
    deleted: !!raw.deleted,
  };
}

// ---------- funções puras de apoio à tela ----------

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Estilos em uso, ordenados; com `withPresets`, inclui os sugeridos. */
export function genresOf(songs, { withPresets = false } = {}) {
  const set = new Set(songs.map((s) => s.genre.trim()).filter(Boolean));
  if (withPresets) PRESET_GENRES.forEach((g) => set.add(g));
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Filtra por estilo (vazio = todos) e por texto (título, artista, estilo); ordena por título. */
export function filterSongs(songs, { genre = '', query = '' } = {}) {
  const q = norm(query.trim());
  return songs
    .filter((s) => (!genre || s.genre === genre) && (!q || norm(`${s.title} ${s.artist} ${s.genre}`).includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

/** Move o item de `from` para `to` (índices), devolvendo uma cópia. */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

// ---------- biblioteca ----------

export class Library {
  /**
   * io: { loadRawSongs, saveRawSongs, loadRawPlaylists, saveRawPlaylists, loadCode, saveCode, loadMeta, saveMeta }
   * cloud: CloudClient (ou null para só local)
   */
  constructor({ io, cloud = null, onChange = () => {}, autoSyncMs = 1500 }) {
    this.io = io;
    this.cloud = cloud;
    this.onChange = onChange;
    this.autoSyncMs = autoSyncMs;
    this.songs = io.loadRawSongs().map(normalizeSong);
    this.playlists = io.loadRawPlaylists().map(normalizePlaylist);
    this.idMap = new Map(this.songs.filter((s) => s.legacyId).map((s) => [s.legacyId, s.id]));
    this.meta = io.loadMeta() ?? {};
    this.code = io.loadCode();
    if (!this.code) {
      this.code = newUuid();
      io.saveCode(this.code);
    }
    this.status = { state: cloud?.configured ? 'idle' : 'off', message: '', at: null };
    this.syncing = false;
    this.timer = null;
    this.save();
  }

  // --- persistência local ---
  save() {
    this.io.saveRawSongs(this.songs);
    this.io.saveRawPlaylists(this.playlists);
    this.io.saveMeta(this.meta);
  }

  changed() {
    this.save();
    this.onChange();
    this.scheduleSync();
  }

  /** Id atual de uma música (ids antigos curtos viram uuid na migração). */
  resolveId(id) {
    return this.idMap.get(id) ?? id;
  }

  // --- músicas ---
  get visibleSongs() {
    return this.songs.filter((s) => !s.deleted);
  }
  get visiblePlaylists() {
    return this.playlists.filter((p) => !p.deleted);
  }
  song(id) {
    return this.songs.find((s) => s.id === id && !s.deleted) ?? null;
  }
  playlist(id) {
    return this.playlists.find((p) => p.id === id && !p.deleted) ?? null;
  }

  addSong(fields = {}) {
    const s = normalizeSong({ id: newUuid(), ...fields, dirty: true });
    this.songs.unshift(s);
    this.changed();
    return s;
  }

  /** Marca uma música alterada (o app muda o objeto e chama isto). */
  touchSong(s) {
    s.dirty = true;
    s.rev++;
    this.changed();
  }

  removeSong(id) {
    const s = this.song(id);
    if (!s) return;
    s.deleted = true;
    s.dirty = true;
    s.rev++;
    for (const p of this.visiblePlaylists) {
      if (p.songIds.includes(id)) {
        p.songIds = p.songIds.filter((x) => x !== id);
        p.dirty = true;
        p.rev++;
      }
    }
    this.changed();
  }

  // --- playlists ---
  addPlaylist(name, genre = '') {
    const p = normalizePlaylist({ id: newUuid(), name, genre, songIds: [], dirty: true });
    this.playlists.unshift(p);
    this.changed();
    return p;
  }

  updatePlaylist(id, patch) {
    const p = this.playlist(id);
    if (!p) return null;
    if (patch.name !== undefined) p.name = str(patch.name, 100) || p.name;
    if (patch.genre !== undefined) p.genre = str(patch.genre, 60);
    p.dirty = true;
    p.rev++;
    this.changed();
    return p;
  }

  removePlaylist(id) {
    const p = this.playlist(id);
    if (!p) return;
    p.deleted = true;
    p.dirty = true;
    p.rev++;
    this.changed();
  }

  addToPlaylist(playlistId, songId) {
    const p = this.playlist(playlistId);
    if (!p || !this.song(songId) || p.songIds.includes(songId) || p.songIds.length >= 500) return false;
    p.songIds.push(songId);
    p.dirty = true;
    p.rev++;
    this.changed();
    return true;
  }

  removeFromPlaylist(playlistId, songId) {
    const p = this.playlist(playlistId);
    if (!p || !p.songIds.includes(songId)) return;
    p.songIds = p.songIds.filter((x) => x !== songId);
    p.dirty = true;
    p.rev++;
    this.changed();
  }

  moveInPlaylist(playlistId, from, to) {
    const p = this.playlist(playlistId);
    if (!p) return;
    p.songIds = moveItem(p.songIds, from, to);
    p.dirty = true;
    p.rev++;
    this.changed();
  }

  /** Músicas da playlist, em ordem, ignorando ids que não existem mais. */
  playlistSongs(playlistId) {
    const p = this.playlist(playlistId);
    return p ? p.songIds.map((id) => this.song(id)).filter(Boolean) : [];
  }

  // --- nuvem ---
  get cloudOn() {
    return !!this.cloud?.configured;
  }

  setStatus(state, message = '') {
    this.status = { state, message, at: Date.now() };
    this.onChange();
  }

  scheduleSync(ms = this.autoSyncMs) {
    if (!this.cloudOn) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), ms);
    this.timer.unref?.(); // não segura o processo (testes em Node)
  }

  /** Troca o código da biblioteca. merge = true mantém as músicas daqui (sobem para o novo código). */
  useCode(code, { merge }) {
    if (!isUuid(code)) throw new CloudError('Código inválido. Ele tem o formato 8-4-4-4-12 (letras e números).');
    this.code = code.toLowerCase();
    this.io.saveCode(this.code);
    this.meta = {};
    if (merge) {
      // o id é único no banco todo: as músicas e playlists daqui viram cópias (ids novos) na biblioteca nova
      const remap = new Map();
      for (const x of [...this.songs, ...this.playlists]) {
        const id = newUuid();
        remap.set(x.id, id);
        x.id = id;
        x.dirty = true;
        x.updatedAt = null;
        x.rev++;
      }
      for (const p of this.playlists) p.songIds = p.songIds.map((id) => remap.get(id) ?? id);
      this.idMap = new Map();
    } else {
      this.songs = [];
      this.playlists = [];
    }
    this.changed();
  }

  async sync() {
    if (!this.cloudOn || this.syncing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.setStatus('offline', 'Sem internet: salvo só neste aparelho.');
    this.syncing = true;
    clearTimeout(this.timer);
    this.setStatus('syncing');
    try {
      await this._push('songs', 'songs', songToRow);
      await this._push('playlists', 'playlists', playlistToRow);
      await this._pull('songs', 'songs', songFromRow);
      await this._pull('playlists', 'playlists', playlistFromRow);
      this.meta.lastSync = new Date().toISOString();
      this.save();
      this.setStatus('ok');
    } catch (e) {
      this.setStatus(e.message.startsWith('Sem conexão') ? 'offline' : 'error', e.message);
    } finally {
      this.syncing = false;
    }
  }

  async _push(table, prop, toRow) {
    const dirty = this[prop].filter((i) => i.dirty);
    if (!dirty.length) return;
    const snapshot = new Map(dirty.map((i) => [i.id, i.rev]));
    const saved = await this.cloud.push(table, dirty.map((i) => toRow(i, this.code)), this.code);
    for (const row of saved) {
      const item = this[prop].find((i) => i.id === row.id);
      if (!item) continue;
      item.updatedAt = row.updated_at;
      if (item.rev === snapshot.get(row.id)) {
        item.dirty = false;
        if (item.deleted) this[prop] = this[prop].filter((i) => i !== item); // apagado e já na nuvem: some daqui
      }
    }
    this.save();
  }

  async _pull(table, prop, fromRow) {
    const key = `since_${table}`;
    const rows = await this.cloud.pull(table, this.code, this.meta[key]);
    if (!rows.length) return;
    const { items, changed } = mergeRemote(this[prop], rows, fromRow);
    this[prop] = items;
    this.meta[key] = rows.reduce((max, r) => (Date.parse(r.updated_at) > Date.parse(max) ? r.updated_at : max), rows[0].updated_at);
    if (changed) this.onChange();
    this.save();
  }
}

export { CloudClient };

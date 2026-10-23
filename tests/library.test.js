import test from 'node:test';
import assert from 'node:assert/strict';
import { Library, normalizeSong, normalizePlaylist, genresOf, filterSongs, moveItem, PRESET_GENRES } from '../src/library.js';
import { CloudClient, isUuid } from '../src/cloud.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

const memIO = (seed = {}) => {
  const d = { songs: seed.songs ?? [], playlists: seed.playlists ?? [], code: seed.code ?? null, meta: seed.meta ?? {} };
  return {
    d,
    loadRawSongs: () => structuredClone(d.songs), saveRawSongs: (v) => { d.songs = structuredClone(v); },
    loadRawPlaylists: () => structuredClone(d.playlists), saveRawPlaylists: (v) => { d.playlists = structuredClone(v); },
    loadCode: () => d.code, saveCode: (c) => { d.code = c; }, loadMeta: () => structuredClone(d.meta), saveMeta: (m) => { d.meta = structuredClone(m); },
  };
};
const mk = (srv, io = memIO()) => {
  const cloud = new CloudClient({ url: 'https://x.supabase.co', key: 'K', fetchImpl: srv.fetchImpl });
  return new Library({ io, cloud, autoSyncMs: 1e9 });
};

test('músicas antigas (id curto, bpm) são migradas para uuid e marcadas para subir', () => {
  const lib = new Library({ io: memIO({ songs: [{ id: 'k3j2a1', title: 'Antiga', text: 'Am F', bpm: 120, transpose: 2, url: 'x', markers: { 0: 3 }, speed: 2.5 }] }) });
  const s = lib.visibleSongs[0];
  assert.equal(isUuid(s.id), true);
  assert.equal(lib.resolveId('k3j2a1'), s.id);
  assert.equal(s.dirty, true);
  assert.equal(s.genre, '');
  assert.equal(s.timing, null);
  assert.equal('bpm' in s, false);
  assert.equal(isUuid(lib.code), true);
});

test('normalizeSong limita valores', () => {
  const s = normalizeSong({ id: 'x', speed: 99, transpose: 50, title: 'a'.repeat(500), holds: [1] });
  assert.equal(s.speed, 10);
  assert.equal(s.transpose, 11);
  assert.equal(s.title.length, 200);
  assert.deepEqual(s.holds, {});
  assert.equal(normalizePlaylist({ id: 'zz', songIds: ['nao-uuid'] }).songIds.length, 0);
});

test('estilos e filtro por estilo/busca (sem acento)', () => {
  const songs = [
    { title: 'Vida Vazia', artist: 'Bruno & Marrone', genre: 'Sertanejo' },
    { title: 'Tempo Perdido', artist: 'Legião Urbana', genre: 'Rock' },
    { title: 'Aquarela', artist: 'Toquinho', genre: 'MPB' },
    { title: 'Sem estilo', artist: '', genre: '' },
  ];
  assert.deepEqual(genresOf(songs), ['MPB', 'Rock', 'Sertanejo']);
  assert.ok(genresOf(songs, { withPresets: true }).length >= PRESET_GENRES.length);
  assert.deepEqual(filterSongs(songs, { genre: 'Rock' }).map((s) => s.title), ['Tempo Perdido']);
  assert.deepEqual(filterSongs(songs, { query: 'legiao' }).map((s) => s.title), ['Tempo Perdido']);
  assert.deepEqual(filterSongs(songs, { query: 'ÁQUA' }).map((s) => s.title), ['Aquarela']);
  assert.deepEqual(filterSongs(songs).map((s) => s.title), ['Aquarela', 'Sem estilo', 'Tempo Perdido', 'Vida Vazia']);
});

test('moveItem', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], 0, 5), ['a', 'b']);
});

test('playlists: criar, adicionar, ordenar, remover música e excluir', () => {
  const lib = new Library({ io: memIO() });
  const a = lib.addSong({ title: 'A', text: 'Am' });
  const b = lib.addSong({ title: 'B', text: 'C' });
  const c = lib.addSong({ title: 'C', text: 'G' });
  const p = lib.addPlaylist('Domingo', 'Sertanejo');
  assert.equal(lib.addToPlaylist(p.id, a.id), true);
  lib.addToPlaylist(p.id, b.id); lib.addToPlaylist(p.id, c.id);
  assert.equal(lib.addToPlaylist(p.id, a.id), false); // sem duplicar
  assert.equal(lib.addToPlaylist(p.id, 'inexistente'), false);
  lib.moveInPlaylist(p.id, 2, 0);
  assert.deepEqual(lib.playlistSongs(p.id).map((s) => s.title), ['C', 'A', 'B']);
  lib.removeFromPlaylist(p.id, a.id);
  assert.deepEqual(lib.playlistSongs(p.id).map((s) => s.title), ['C', 'B']);
  lib.updatePlaylist(p.id, { name: 'Domingo à tarde', genre: 'MPB' });
  assert.equal(lib.playlist(p.id).name, 'Domingo à tarde');
  lib.removeSong(b.id); // some da playlist também
  assert.deepEqual(lib.playlistSongs(p.id).map((s) => s.title), ['C']);
  lib.removePlaylist(p.id);
  assert.equal(lib.visiblePlaylists.length, 0);
  assert.equal(lib.visibleSongs.length, 2);
});

test('sincronização: envia o que está pendente e baixa em outro aparelho (andamento junto)', async () => {
  const srv = fakeSupabase();
  const io1 = memIO();
  const lib1 = mk(srv, io1);
  const s = lib1.addSong({ title: 'Vida Vazia', artist: 'Bruno & Marrone', genre: 'Sertanejo', text: 'Am F\nletra', speed: 1.75, simplified: true, holds: { 1: 3 }, timing: { base: 2, durations: [2, 3] }, transpose: 2 });
  const p = lib1.addPlaylist('Sertanejo', 'Sertanejo'); lib1.addToPlaylist(p.id, s.id);
  await lib1.sync();
  assert.equal(lib1.status.state, 'ok');
  assert.equal(lib1.songs.every((x) => !x.dirty), true);
  assert.equal(srv.tables.songs.size, 1);

  // segundo aparelho com o MESMO código
  const lib2 = mk(srv, memIO({ code: lib1.code }));
  await lib2.sync();
  const got = lib2.visibleSongs[0];
  assert.equal(got.title, 'Vida Vazia');
  assert.equal(got.genre, 'Sertanejo');
  assert.equal(got.speed, 1.75);
  assert.equal(got.simplified, true);
  assert.deepEqual(got.holds, { 1: 3 });
  assert.deepEqual(got.timing, { base: 2, durations: [2, 3] });
  assert.equal(got.transpose, 2);
  assert.deepEqual(lib2.playlistSongs(lib2.visiblePlaylists[0].id).map((x) => x.title), ['Vida Vazia']);

  // outro código não enxerga nada
  const lib3 = mk(srv, memIO({ code: '22222222-2222-4222-8222-222222222222' }));
  await lib3.sync();
  assert.equal(lib3.visibleSongs.length, 0);
});

test('sincronização: edição, exclusão e andamento gravado se propagam', async () => {
  const srv = fakeSupabase();
  const lib1 = mk(srv);
  const s = lib1.addSong({ title: 'X', text: 'Am' });
  await lib1.sync();
  const lib2 = mk(srv, memIO({ code: lib1.code }));
  await lib2.sync();
  assert.equal(lib2.visibleSongs.length, 1);

  const s2 = lib2.song(s.id);
  s2.timing = { base: 2, durations: [2] }; s2.title = 'X editada';
  lib2.touchSong(s2);
  await lib2.sync();
  await lib1.sync();
  assert.equal(lib1.song(s.id).title, 'X editada');
  assert.deepEqual(lib1.song(s.id).timing, { base: 2, durations: [2] });

  lib1.removeSong(s.id);
  await lib1.sync();
  assert.equal(lib1.songs.length, 0); // some do aparelho depois de subir
  await lib2.sync();
  assert.equal(lib2.visibleSongs.length, 0);
});

test('alteração local pendente não é sobrescrita pela nuvem; offline não perde nada', async () => {
  const srv = fakeSupabase();
  const lib1 = mk(srv);
  const s = lib1.addSong({ title: 'Original', text: 'Am' });
  await lib1.sync();
  const lib2 = mk(srv, memIO({ code: lib1.code }));
  await lib2.sync();
  const mine = lib2.song(s.id); mine.title = 'Minha edição offline'; lib2.touchSong(mine); // ainda não sincronizou
  const theirs = lib1.song(s.id); theirs.title = 'Edição remota'; lib1.touchSong(theirs); await lib1.sync();
  await lib2.sync(); // empurra a dela por cima (última gravação vence) e não perde a edição local
  assert.equal(lib2.song(s.id).title, 'Minha edição offline');
  await lib1.sync();
  assert.equal(lib1.song(s.id).title, 'Minha edição offline');

  const off = new Library({ io: memIO(), cloud: new CloudClient({ url: 'https://x.supabase.co', key: 'K', fetchImpl: fakeSupabase({ failWith: true }).fetchImpl }), autoSyncMs: 1e9 });
  off.addSong({ title: 'Sem rede', text: 'C' });
  await off.sync();
  assert.equal(off.status.state, 'offline');
  assert.equal(off.songs[0].dirty, true); // continua pendente
  assert.equal(off.visibleSongs.length, 1);
});

test('trocar o código: juntar mantém as músicas daqui e sobe para o código novo', async () => {
  const srv = fakeSupabase();
  const lib = mk(srv);
  const a = lib.addSong({ title: 'Local', text: 'Am' });
  const pl = lib.addPlaylist('Lista', ''); lib.addToPlaylist(pl.id, a.id);
  await lib.sync();
  const antigoId = a.id;
  const novo = '33333333-3333-4333-8333-333333333333';
  assert.throws(() => lib.useCode('abc', { merge: true }), /Código inválido/);
  lib.useCode(novo, { merge: true });
  await lib.sync();
  const rows = [...srv.tables.songs.values()].filter((r) => r.library_id === novo);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].id, antigoId); // cópia com id novo
  assert.deepEqual([...srv.tables.playlists.values()].find((r) => r.library_id === novo).song_ids, [rows[0].id]); // playlist aponta para a cópia
  assert.notEqual(srv.tables.songs.get(antigoId).library_id, novo); // a original continua na biblioteca antiga
  lib.useCode('44444444-4444-4444-8444-444444444444', { merge: false });
  assert.equal(lib.songs.length, 0);
});

test('erro de tabela ausente aparece com instrução clara', async () => {
  const lib = mk({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ message: 'relation "public.songs" does not exist' }) }) });
  lib.addSong({ title: 'a', text: 'Am' });
  await lib.sync();
  assert.equal(lib.status.state, 'error');
  assert.match(lib.status.message, /schema\.sql/);
});

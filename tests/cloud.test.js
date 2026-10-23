import test from 'node:test';
import assert from 'node:assert/strict';
import { isUuid, newUuid, songToRow, songFromRow, playlistToRow, playlistFromRow, mergeRemote, CloudClient, CloudError } from '../src/cloud.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

const LIB = '11111111-1111-4111-8111-111111111111';
const song = (over = {}) => ({ id: newUuid(), title: 'Vida Vazia', artist: 'Bruno & Marrone', genre: 'Sertanejo', text: 'Am F', transpose: 2, speed: 2.25, simplified: true, holds: { 3: 2 }, timing: { base: 2, durations: [2, 3] }, updatedAt: null, dirty: true, rev: 1, deleted: false, ...over });

test('uuid: gera e valida', () => {
  assert.equal(isUuid(newUuid()), true);
  assert.equal(isUuid('abc'), false);
  assert.equal(isUuid(null), false);
});

test('música ↔ linha: todos os campos de andamento viajam', () => {
  const s = song();
  const row = songToRow(s, LIB);
  assert.equal(row.library_id, LIB);
  assert.equal(row.simplified, true);
  assert.deepEqual(row.holds, { 3: 2 });
  assert.deepEqual(row.timing, { base: 2, durations: [2, 3] });
  assert.equal(row.deleted_at, null);
  const back = songFromRow({ ...row, updated_at: '2026-01-01T00:00:01+00:00' });
  assert.equal(back.title, s.title);
  assert.equal(back.genre, 'Sertanejo');
  assert.equal(back.simplified, true);
  assert.deepEqual(back.timing, s.timing);
  assert.equal(back.dirty, false);
  assert.ok(songToRow({ ...s, deleted: true }, LIB).deleted_at);
});

test('linhas incompletas ou estranhas viram valores seguros', () => {
  const s = songFromRow({ id: newUuid(), holds: [1, 2], speed: null, transpose: 'x' });
  assert.deepEqual(s.holds, {});
  assert.equal(s.speed, 2.5);
  assert.equal(s.transpose, 0);
  assert.equal(s.timing, null);
});

test('playlist ↔ linha mantém a ordem das músicas', () => {
  const ids = [newUuid(), newUuid(), newUuid()];
  const p = { id: newUuid(), name: 'Domingo', genre: 'MPB', songIds: ids, deleted: false };
  const row = playlistToRow(p, LIB);
  assert.deepEqual(row.song_ids, ids);
  assert.deepEqual(playlistFromRow({ ...row, updated_at: 'x' }).songIds, ids);
  assert.deepEqual(playlistFromRow({ id: p.id, song_ids: null }).songIds, []);
});

test('mergeRemote: nova, mais nova, igual, apagada e alteração local pendente', () => {
  const a = song({ id: 'a', dirty: false, updatedAt: '2026-01-01T00:00:05+00:00', title: 'A velha' });
  const b = song({ id: 'b', dirty: true, updatedAt: '2026-01-01T00:00:05+00:00', title: 'B local' });
  const c = song({ id: 'c', dirty: false, updatedAt: '2026-01-01T00:00:05+00:00', title: 'C' });
  const d = song({ id: 'd', dirty: false, updatedAt: '2026-01-01T00:00:05+00:00', title: 'D' });
  const row = (id, title, at, extra = {}) => ({ ...songToRow(song({ id, title }), LIB), updated_at: at, ...extra });
  const rows = [
    row('a', 'A nova', '2026-01-01T00:00:09+00:00'), // mais nova → substitui
    row('b', 'B remota', '2026-01-01T00:00:09+00:00'), // local pendente → mantém local
    row('c', 'C', '2026-01-01T00:00:05+00:00'), // igual → nada
    row('d', 'D', '2026-01-01T00:00:09+00:00', { deleted_at: '2026-01-01T00:00:09+00:00' }), // apagada → remove
    row('e', 'E nova', '2026-01-01T00:00:03+00:00'), // desconhecida → adiciona
    row('f', 'F apagada', '2026-01-01T00:00:03+00:00', { deleted_at: '2026-01-01T00:00:03+00:00' }), // apagada e desconhecida → ignora
  ];
  const { items, changed } = mergeRemote([a, b, c, d], rows, songFromRow);
  const byId = Object.fromEntries(items.map((i) => [i.id, i.title]));
  assert.deepEqual(byId, { a: 'A nova', b: 'B local', c: 'C', e: 'E nova' });
  assert.equal(changed, true);
  assert.equal(mergeRemote([c], [row('c', 'C', '2026-01-01T00:00:05+00:00')], songFromRow).changed, false);
});

test('CloudClient: envia o código no cabeçalho e só vê a própria biblioteca', async () => {
  const srv = fakeSupabase();
  const cli = new CloudClient({ url: 'https://x.supabase.co/', key: 'K', fetchImpl: srv.fetchImpl });
  const saved = await cli.push('songs', [songToRow(song({ id: newUuid() }), LIB)], LIB);
  assert.equal(saved.length, 1);
  assert.ok(saved[0].updated_at);
  assert.equal((await cli.pull('songs', LIB)).length, 1);
  assert.equal((await cli.pull('songs', '22222222-2222-4222-8222-222222222222')).length, 0);
  await assert.rejects(() => cli.push('songs', [songToRow(song(), LIB)], '22222222-2222-4222-8222-222222222222'), CloudError); // RLS
  const since = saved[0].updated_at;
  assert.equal((await cli.pull('songs', LIB, since)).length, 0); // nada mais novo
});

test('CloudClient: lotes de 50 e erros claros', async () => {
  const srv = fakeSupabase();
  const cli = new CloudClient({ url: 'https://x.supabase.co', key: 'K', fetchImpl: srv.fetchImpl });
  const rows = Array.from({ length: 120 }, () => songToRow(song({ id: newUuid() }), LIB));
  const out = await cli.push('songs', rows, LIB);
  assert.equal(out.length, 120);
  assert.equal(srv.calls.filter((c) => c.method === 'POST').length, 3);
  await assert.rejects(() => cli.pull('tabela_inexistente', LIB), /tabelas ainda não foram criadas/);
  const off = new CloudClient({ url: 'https://x.supabase.co', key: 'K', fetchImpl: fakeSupabase({ failWith: true }).fetchImpl });
  await assert.rejects(() => off.pull('songs', LIB), /Sem conexão/);
});

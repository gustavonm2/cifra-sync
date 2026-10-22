import test from 'node:test';
import assert from 'node:assert/strict';
import { isChord, parseChord, transposeChord, keyLabel, flatsForSong } from '../src/chords.js';

test('reconhece acordes comuns e complexos', () => {
  for (const c of ['Am', 'F#m7', 'C/G', 'Dsus4', 'Bb', 'G7M', 'Cadd9', 'E7(9)', 'F#m7(b5)', 'A', 'Bm7/F#', 'C7/9', 'Gdim', 'D+']) {
    assert.ok(isChord(c), c);
  }
});

test('rejeita palavras da letra', () => {
  for (const w of ['Amor', 'gente', 'Na', 'beira', 'Dó', 'e', 'Meu', 'Fim', '']) assert.equal(isChord(w), false, w);
});

test('parseChord separa raiz, sufixo e baixo', () => {
  assert.deepEqual(parseChord('F#m7/C#'), { root: 'F#', suffix: 'm7', bass: 'C#' });
  assert.deepEqual(parseChord('Am'), { root: 'A', suffix: 'm', bass: null });
});

test('transpõe com sustenidos e bemóis', () => {
  assert.equal(transposeChord('C', 2, false), 'D');
  assert.equal(transposeChord('C', 1, false), 'C#');
  assert.equal(transposeChord('C', 1, true), 'Db');
  assert.equal(transposeChord('Am7', 3, false), 'Cm7');
  assert.equal(transposeChord('G', 5, false), 'C');
  assert.equal(transposeChord('B', 1, false), 'C');
});

test('transposição dá a volta e aceita negativos', () => {
  assert.equal(transposeChord('A', 12), 'A');
  assert.equal(transposeChord('C', -1, false), 'B');
  assert.equal(transposeChord('C', -2, true), 'Bb');
  assert.equal(transposeChord('Dm', -14, false), 'Cm');
});

test('transpõe o baixo invertido junto', () => {
  assert.equal(transposeChord('C/G', 2, false), 'D/A');
  assert.equal(transposeChord('Am/E', 1, true), 'Bbm/F');
  assert.equal(transposeChord('F#m7/C#', -2, false), 'Em7/B');
  assert.equal(transposeChord('C7/9', 2), 'D7/9');
});

test('equivalentes enarmônicos de entrada funcionam', () => {
  assert.equal(transposeChord('Bb', 2, false), 'C');
  assert.equal(transposeChord('Eb', 1, false), 'E');
  assert.equal(transposeChord('Db', 0, false), 'Db');
});

test('tom e preferência de bemóis', () => {
  assert.equal(keyLabel('Am', 0), 'Am');
  assert.equal(keyLabel('C', 5), 'F');
  assert.equal(keyLabel('C', 10), 'Bb');
  assert.equal(keyLabel('G', 1), 'Ab');
  assert.equal(keyLabel('G', 4), 'B');
  assert.equal(keyLabel(null, 0), '—');
  assert.equal(flatsForSong('C', 5), true);
  assert.equal(flatsForSong('C', 7), false);
});

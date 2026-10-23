import test from 'node:test';
import assert from 'node:assert/strict';
import { triadOf, harmonicField, detectKey, simplifyChord, simplifyAll, keyName } from '../src/harmony.js';

const C = { tonic: 0, mode: 'major' };

test('tríade de cada acorde', () => {
  assert.deepEqual(triadOf('Am7'), { root: 9, quality: 'min', rootName: 'A' });
  assert.equal(triadOf('G7M').quality, 'maj');
  assert.equal(triadOf('G7').quality, 'maj');
  assert.equal(triadOf('Dsus4').quality, 'maj');
  assert.equal(triadOf('Cadd9').quality, 'maj');
  assert.equal(triadOf('Bm7(b5)').quality, 'dim');
  assert.equal(triadOf('F#dim7').quality, 'dim');
  assert.equal(triadOf('Cmaj7').quality, 'maj');
  assert.equal(triadOf('Cm6').quality, 'min');
  assert.equal(triadOf('Bb').rootName, 'Bb');
  assert.equal(triadOf('xyz'), null);
});

test('campo harmônico de Dó maior e Lá menor', () => {
  const f = harmonicField(0, 'major').map((x) => `${x.root}${x.quality}`);
  assert.deepEqual(f, ['0maj', '2min', '4min', '5maj', '7maj', '9min', '11dim']);
  const m = harmonicField(9, 'minor');
  assert.ok(m.some((x) => x.root === 4 && x.quality === 'maj')); // E maior (V do menor harmônico)
  assert.ok(m.some((x) => x.root === 0 && x.quality === 'maj')); // C maior (III)
});

test('detecta o tom pelos acordes', () => {
  assert.deepEqual(detectKey(['C', 'G', 'Am', 'F', 'C', 'G', 'C']), { ...C, score: detectKey(['C', 'G', 'Am', 'F', 'C', 'G', 'C']).score });
  const k = detectKey(['Am', 'Dm', 'E7', 'Am']);
  assert.equal(k.tonic, 9);
  assert.equal(k.mode, 'minor');
  assert.equal(detectKey(['G', 'C', 'D', 'G']).tonic, 7);
  assert.equal(detectKey([]), null);
  assert.equal(detectKey(['xyz']), null);
});

test('simplifica: remove sétima, nona, sexta, sus, add e baixo invertido', () => {
  assert.equal(simplifyChord('Am7', C), 'Am');
  assert.equal(simplifyChord('G7M', C), 'G');
  assert.equal(simplifyChord('Cmaj7', C), 'C');
  assert.equal(simplifyChord('G7', C), 'G');
  assert.equal(simplifyChord('Cadd9', C), 'C');
  assert.equal(simplifyChord('Dm7(9)', C), 'Dm');
  assert.equal(simplifyChord('C/E', C), 'C');
  assert.equal(simplifyChord('F7M/C', C), 'F');
  assert.equal(simplifyChord('Em7', C), 'Em');
  assert.equal(simplifyChord('Bm7(b5)', C), 'Bdim');
});

test('simplifica sem sair do campo: sus e dominantes secundários viram o acorde do campo', () => {
  assert.equal(simplifyChord('Dsus4', C), 'Dm'); // D no campo de C é menor
  assert.equal(simplifyChord('E7', C), 'Em'); // E7 (dominante de Am) → Em, do campo
  assert.equal(simplifyChord('A7', C), 'Am');
  assert.equal(simplifyChord('D7', C), 'Dm');
  assert.equal(simplifyChord('Csus2', C), 'C');
});

test('acorde de raiz fora do campo vira o acorde do campo com mais notas em comum', () => {
  const r = simplifyChord('Bb', C); // Bb D F: Dm (D F A) tem 2 notas em comum
  assert.equal(r, 'Dm');
  const f = simplifyChord('F#dim', C);
  assert.ok(['Bdim', 'Dm', 'Am', 'Em', 'G', 'C'].includes(r) && f.length > 0);
  const field = new Set(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  for (const n of ['Bb', 'Eb', 'Ab7M', 'F#m7', 'C#dim', 'Db', 'Gb']) assert.ok(field.has(simplifyChord(n, C)), `${n} → ${simplifyChord(n, C)}`);
});

test('toda a saída fica dentro do campo do tom detectado', () => {
  const song = ['Am7', 'Dm7', 'G7', 'Cmaj7', 'Fmaj7', 'Bm7(b5)', 'E7', 'Am7', 'D7', 'G7M', 'C/E', 'Dsus4', 'Em7', 'A7'];
  const { names, key } = simplifyAll(song);
  assert.equal(names.length, song.length);
  const field = harmonicField(key.tonic, key.mode);
  for (const n of names) {
    const t = triadOf(n);
    assert.ok(field.some((f) => f.root === t.root && f.quality === t.quality), `${n} fora do campo de ${keyName(key)}`);
    assert.ok(/^[A-G][#b]?(m|dim)?$/.test(n), `${n} não é tríade simples`);
  }
});

test('músicas já simples não mudam; sem tom detectado só reduz', () => {
  assert.deepEqual(simplifyAll(['C', 'G', 'Am', 'F']).names, ['C', 'G', 'Am', 'F']);
  assert.equal(simplifyChord('Am7', null), 'Am');
  assert.equal(simplifyChord('xyz', C), 'xyz');
});

test('grafia de bemol é mantida; nome do tom', () => {
  const key = detectKey(['Bb', 'F', 'Gm', 'Eb']);
  assert.equal(keyName(key).endsWith('maior') || keyName(key).endsWith('menor'), true);
  assert.equal(simplifyChord('Bb7M', key), 'Bb');
  assert.equal(keyName({ tonic: 10, mode: 'major' }), 'Bb maior');
  assert.equal(keyName({ tonic: 9, mode: 'minor' }), 'A menor');
});

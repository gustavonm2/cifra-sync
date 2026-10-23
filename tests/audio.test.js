import test from 'node:test';
import assert from 'node:assert/strict';
import { chromaFromSpectrum, matchChord, buildVocabulary, chordTemplate } from '../src/audio.js';
import { synth, spectrumDb, SR, N, VOICINGS } from './helpers/synth.js';

const detect = (samples, vocab) => matchChord(chromaFromSpectrum(spectrumDb(samples), SR, N), vocab);
const SONG = buildVocabulary(['Am', 'F', 'C', 'G', 'Dm', 'E', 'Em', 'D', 'A', 'G7', 'Bm']);

test('modelo de acorde: raiz e notas', () => {
  const t = chordTemplate('Am');
  assert.equal(t.root, 9);
  assert.ok(t.vec[9] > 0 && t.vec[0] > 0 && t.vec[4] > 0);
  assert.equal(t.vec[1], 0);
  assert.equal(chordTemplate('xyz'), null);
});

test('reconhece cada acorde tocado (vocabulário com 11 acordes)', () => {
  for (const name of Object.keys(VOICINGS)) {
    const m = detect(synth(name, { seed: 7 }), SONG);
    assert.equal(m.name, name, `${name} reconhecido como ${m.name} (${m.score.toFixed(2)} vs ${m.second.toFixed(2)})`);
    assert.ok(m.score >= 0.68, `${name}: score ${m.score.toFixed(2)}`);
  }
});

test('continua certo com ruído de fundo forte', () => {
  for (const name of ['Am', 'F', 'C', 'G', 'Dm', 'E']) {
    const m = detect(synth(name, { noise: 0.08, seed: 3 }), SONG);
    assert.equal(m.name, name, `${name} → ${m.name}`);
  }
});

test('volume baixo não muda o resultado', () => {
  const quiet = synth('F', { seed: 5 }).map((v) => v * 0.05);
  assert.equal(detect(quiet, SONG).name, 'F');
});

test('acordes parecidos de música pequena: Am × C e Em × G', () => {
  const small = buildVocabulary(['Am', 'C', 'Em', 'G']);
  assert.equal(detect(synth('Am'), small).name, 'Am');
  assert.equal(detect(synth('C'), small).name, 'C');
  assert.equal(detect(synth('Em'), small).name, 'Em');
  assert.equal(detect(synth('G'), small).name, 'G');
});

test('silêncio ou ruído puro não gera acorde confiante', () => {
  const noise = synth('Am', { seed: 9 }).map((_, i) => Math.sin(i * 12.9898) * 0.05 * Math.cos(i * 0.0007));
  const m = detect(noise, SONG);
  assert.ok(!m || m.score < 0.68 || m.score - m.second < 0.03, `ruído virou ${m?.name} ${m?.score.toFixed(2)}`);
  assert.equal(chromaFromSpectrum(new Float32Array(N / 2).fill(-Infinity), SR, N), null);
});

test('buildVocabulary ignora duplicados e não-acordes', () => {
  const v = buildVocabulary(['Am', 'Am', 'xyz', 'C/G']);
  assert.deepEqual([...v.keys()], ['Am', 'C/G']);
});

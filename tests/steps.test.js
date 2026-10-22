import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSong } from '../src/parser.js';
import { buildSteps, locate, advance, clampSeconds, slideProgress } from '../src/steps.js';

const items = parseSong(`[Intro]
Am F C G

[Verso]
Am        F
Letra um
C   G
Letra dois
Solo sem acordes

[Refrão]
F G
Outra`);

test('passos: um por acorde, em ordem, atravessando linhas e seções', () => {
  const { steps, lines, sections } = buildSteps(items);
  assert.deepEqual(steps.map((s) => s.name), ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G']);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((l) => l.first), [0, 4, 6, 8]);
  assert.deepEqual(sections, [{ name: 'Intro', stepIdx: 0 }, { name: 'Verso', stepIdx: 4 }, { name: 'Refrão', stepIdx: 8 }]);
});

test('o nome da seção fica só no primeiro acorde dela', () => {
  const { steps } = buildSteps(items);
  assert.deepEqual(steps.filter((s) => s.section).map((s) => [s.name, s.section]), [['Am', 'Intro'], ['Am', 'Verso'], ['F', 'Refrão']]);
});

test('cada passo conhece linha e posição dentro da linha', () => {
  const { steps } = buildSteps(items);
  assert.deepEqual([steps[5].lineIdx, steps[5].chordIdx], [1, 1]);
  assert.deepEqual([steps[9].lineIdx, steps[9].chordIdx], [3, 1]);
});

test('letra sem acordes e música sem acordes não geram passos', () => {
  assert.equal(buildSteps(parseSong('só letra\noutra linha')).steps.length, 0);
  assert.equal(buildSteps([]).steps.length, 0);
});

test('sem seções, nenhum rótulo', () => {
  const { steps, sections } = buildSteps(parseSong('Am F\nletra'));
  assert.equal(sections.length, 0);
  assert.ok(steps.every((s) => s.section === null));
});

test('locate separa o passo atual da fração', () => {
  assert.deepEqual(locate(10, 3.25), { cur: 3, frac: 0.25 });
  assert.equal(locate(10, -2).cur, 0);
  assert.equal(locate(10, 99).cur, 9);
  assert.equal(locate(0, 1), null);
});

test('advance anda dt/segundos-por-acorde e para no último acorde', () => {
  assert.deepEqual(advance(0, 1, 2, 10), { pos: 0.5, ended: false });
  assert.deepEqual(advance(2, 0.5, 0.5, 10), { pos: 3, ended: false });
  const r = advance(9.5, 1, 1, 10);
  assert.equal(r.ended, true);
  assert.ok(r.pos < 10 && r.pos > 9.99);
});

test('clampSeconds: múltiplos de 0,25 entre 0,5 e 8', () => {
  assert.equal(clampSeconds(2.6), 2.5);
  assert.equal(clampSeconds(0.1), 0.5);
  assert.equal(clampSeconds(99), 8);
  assert.equal(clampSeconds(1.875), 2);
});

test('slideProgress: parado, desliza no fim, termina em 1', () => {
  assert.equal(slideProgress(0), 0);
  assert.equal(slideProgress(0.65), 0);
  assert.ok(slideProgress(0.8) > 0 && slideProgress(0.8) < 1);
  assert.equal(slideProgress(1), 1);
  assert.ok(slideProgress(0.9) > slideProgress(0.8));
});

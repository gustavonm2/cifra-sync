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

import { slideFrom, durationOf, HOLD_OPTIONS } from '../src/steps.js';
import { Follower } from '../src/follow.js';

test('advance respeita acordes segurados (multiplicador de duração)', () => {
  const holds = { 1: 3 }; // o acorde 1 dura 3× mais
  let r = advance(1, 3, 1, 5, holds); // 3 s dentro de um acorde de 3 s → chega ao acorde 2
  assert.ok(Math.abs(r.pos - 2) < 1e-9);
  r = advance(1, 1.5, 1, 5, holds);
  assert.ok(Math.abs(r.pos - 1.5) < 1e-9); // metade do acorde segurado
  r = advance(0, 2.5, 1, 5, holds); // 1 s no acorde 0 + 1,5 s no acorde 1 (metade)
  assert.ok(Math.abs(r.pos - 1.5) < 1e-9);
});

test('advance atravessa vários acordes de uma vez e para no fim', () => {
  assert.ok(Math.abs(advance(0, 2.5, 1, 10).pos - 2.5) < 1e-9);
  const r = advance(8, 100, 1, 10, { 8: 2 });
  assert.equal(r.ended, true);
  assert.ok(r.pos < 10 && r.pos > 9.99);
});

test('durationOf e opções de segurar', () => {
  assert.equal(durationOf(2, { 3: 2 }, 3), 4);
  assert.equal(durationOf(2, { 3: 2 }, 4), 2);
  assert.equal(durationOf(2, undefined, 0), 2);
  assert.deepEqual(HOLD_OPTIONS, [1, 1.5, 2, 3, 4, 6]);
});

test('a fila só desliza no fim: 35% em acordes curtos, 0,6 s em acordes longos', () => {
  assert.ok(Math.abs(slideFrom(1) - 0.65) < 1e-9);
  assert.ok(Math.abs(slideFrom(4) - 0.85) < 1e-9); // 0,6 s de 4 s = 15%
  assert.ok(slideFrom(10) > slideFrom(4));
});

test('seguindo o áudio, acorde segurado não distorce a velocidade medida', () => {
  const names = ['Am', 'F', 'C', 'G'];
  const holds = { 1: 3 };
  const f = new Follower(names, { speed: 2, now: 0, cur: 1, holds });
  f.hear('C', 'weak', 6.2); // F durou 6 s por ser segurado (3 × 2 s)
  assert.equal(f.speed, 2);
  assert.equal(f.cur, 2);
  const g = new Follower(names, { speed: 2, now: 0, cur: 1, holds: {} });
  g.hear('C', 'weak', 6.2); // sem hold, os mesmos 6 s indicariam lentidão
  assert.ok(g.speed > 2);
});

test('acordes repetidos seguem o relógio usando a duração segurada', () => {
  const f = new Follower(['Am', 'C', 'C', 'G'], { speed: 1, now: 0, cur: 1, holds: { 1: 2 } });
  assert.ok(f.position(1.9) < 2); // o 1º C dura 2 s
  assert.ok(f.position(2.2) >= 2);
});

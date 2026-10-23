import test from 'node:test';
import assert from 'node:assert/strict';
import { durationsFromStarts, isValidTiming, durationFn } from '../src/timing.js';
import { advance } from '../src/steps.js';
import { Follower } from '../src/follow.js';

test('durações a partir dos instantes de início', () => {
  const t = durationsFromStarts([0, 2, 4, 8, 9], 5, 11);
  assert.deepEqual(t.durations, [2, 2, 4, 1, 2]);
  assert.equal(t.base, 2.2);
});

test('acordes sem instante (pulados) dividem o intervalo igualmente', () => {
  const starts = []; starts[0] = 0; starts[3] = 6; starts[4] = 8;
  const t = durationsFromStarts(starts, 5, 10);
  assert.deepEqual(t.durations, [2, 2, 2, 2, 2]);
});

test('último acorde sem fim conhecido fica sem medida (null)', () => {
  const t = durationsFromStarts([0, 2, 4, 6], 4, null);
  assert.deepEqual(t.durations, [2, 2, 2, null]);
  assert.equal(t.base, 2);
});

test('gravação incompleta ou inválida é recusada', () => {
  assert.equal(durationsFromStarts([0], 10, 5), null); // só 1 acorde medido
  const few = []; few[0] = 0; few[1] = 2;
  assert.equal(durationsFromStarts(few, 10, 4), null); // < 50% do total
  assert.equal(durationsFromStarts([0, 3, 2, 6], 4, 8), null); // tempo voltou
});

test('isValidTiming confere formato e tamanho', () => {
  assert.equal(isValidTiming({ base: 2, durations: [2, null, 3] }, 3), true);
  assert.equal(isValidTiming({ base: 2, durations: [2, null, 3] }, 4), false);
  assert.equal(isValidTiming({ base: 0, durations: [1] }, 1), false);
  assert.equal(isValidTiming({ base: 2, durations: [-1] }, 1), false);
  assert.equal(isValidTiming(null, 3), false);
});

test('durationFn usa o andamento gravado, escalado pela velocidade', () => {
  const timing = { base: 2, durations: [2, 4, null, 1] };
  const f = durationFn({ speed: 2, holds: { 2: 3 }, timing });
  assert.deepEqual([0, 1, 2, 3].map(f), [2, 4, 6, 1]); // índice 2 sem medida: speed × hold
  const slower = durationFn({ speed: 3, holds: {}, timing }); // 1,5× mais lento
  assert.deepEqual([0, 1, 3].map(slower), [3, 6, 1.5]);
  const off = durationFn({ speed: 2, holds: { 1: 2 }, timing, useTiming: false });
  assert.deepEqual([0, 1].map(off), [2, 4]);
  assert.equal(durationFn({ speed: 2 })(5), 2);
});

test('advance aceita função de duração (andamento gravado)', () => {
  const f = durationFn({ speed: 2, timing: { base: 2, durations: [1, 3, 1] } });
  let r = advance(0, 2, f, 3);
  assert.ok(Math.abs(r.pos - 1.333333) < 1e-5); // 1 s no 1º + 1 s (1/3) do 2º
  r = advance(0, 100, f, 3);
  assert.equal(r.ended, true);
});

test('Follower registra o início de cada acorde', () => {
  const f = new Follower(['Am', 'F', 'C', 'G'], { speed: 2, now: 10 });
  assert.equal(f.starts[0], 10);
  f.hear('F', 'weak', 12.3);
  assert.ok(Math.abs(f.starts[1] - 12.1) < 1e-9);
  f.hear('G', 'strong', 17); // pulou o C
  assert.ok(Math.abs(f.starts[3] - 16.8) < 1e-9);
  assert.equal(f.starts[2], undefined);
  const t = durationsFromStarts(f.starts, 4, 19);
  assert.ok(t && t.durations.every((d) => d > 0));
});

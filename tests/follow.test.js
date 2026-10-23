import test from 'node:test';
import assert from 'node:assert/strict';
import { Follower, isStartChord, HOLD_FRAC } from '../src/follow.js';

const NAMES = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'C', 'G'];

test('começa parado no acorde inicial e progride com o tempo até esperar', () => {
  const f = new Follower(NAMES, { speed: 2, now: 10 });
  assert.equal(f.position(10), 0);
  assert.ok(Math.abs(f.position(11) - 0.5) < 1e-9);
  assert.equal(f.position(30), HOLD_FRAC); // não foge à frente: espera o próximo acorde
});

test('ouvir o próximo acorde avança e re-ancora descontando a latência do detector (0,2 s)', () => {
  const f = new Follower(NAMES, { speed: 2, now: 0 });
  const r = f.hear('F', 'weak', 2.2);
  assert.equal(r.moved, 1);
  assert.equal(f.cur, 1);
  assert.ok(Math.abs(f.position(2.2 + 1) - 1.6) < 1e-6); // (3,2 − 2,0) / 2 s = 0,6 do acorde
});

test('estima a velocidade de quem toca (suavizada)', () => {
  const f = new Follower(NAMES, { speed: 2, now: 0 });
  f.hear('F', 'weak', 1.2); // acordes a cada ~1 s
  assert.ok(f.speed < 2 && f.speed > 1.2, `velocidade ${f.speed}`);
  const antes = f.speed;
  f.hear('C', 'weak', 2.2);
  assert.ok(f.speed < antes);
  assert.ok(f.speed > 0.9);
});

test('acorde atual ou desconhecido é ignorado', () => {
  const f = new Follower(NAMES, { now: 0 });
  assert.equal(f.hear('Am', 'strong', 1).moved, 0);
  assert.equal(f.hear('Dm', 'strong', 1).moved, 0);
  assert.equal(f.cur, 0);
});

test('pular acordes exige detecção forte e vai até 3 à frente', () => {
  const f = new Follower(NAMES, { now: 0 });
  assert.equal(f.hear('C', 'weak', 3).moved, 0);
  assert.equal(f.hear('C', 'strong', 3).moved, 2);
  assert.equal(f.cur, 2);
  const g = new Follower(NAMES, { now: 0 });
  assert.equal(g.hear('Am', 'strong', 1).moved, 0);
  const h = new Follower(['Am', 'F', 'C', 'G', 'D', 'E'], { now: 0 });
  assert.equal(h.hear('D', 'strong', 5).moved, 0); // 4 à frente: longe demais
});

test('pulo de 2 acordes divide o intervalo entre eles ao estimar a velocidade', () => {
  const f = new Follower(NAMES, { speed: 3, now: 0 });
  f.hear('C', 'strong', 2.2); // 2 acordes em 2 s ≈ 1 s cada
  assert.ok(f.speed < 3 && f.speed > 1.5);
});

test('acordes repetidos em sequência seguem o relógio (o som não distingue)', () => {
  const f = new Follower(NAMES, { speed: 1, now: 0, cur: 6 }); // C C
  assert.ok(f.position(0.5) < 7);
  assert.ok(f.position(1.2) >= 7);
  assert.equal(f.cur, 7);
});

test('intervalo implausível não corrompe a velocidade', () => {
  const f = new Follower(NAMES, { speed: 2, now: 0 });
  f.hear('F', 'weak', 100); // depois de uma pausa enorme
  assert.equal(f.speed, 2);
  assert.equal(f.cur, 1);
});

test('último acorde não avança; seek reposiciona', () => {
  const f = new Follower(['Am', 'F'], { now: 0, cur: 1 });
  assert.equal(f.hear('Am', 'strong', 1).moved, 0);
  f.seek(0, 5);
  assert.equal(f.cur, 0);
  assert.equal(f.position(5), 0);
});

test('isStartChord compara com o acorde do passo atual', () => {
  assert.equal(isStartChord(NAMES, 0, 'Am'), true);
  assert.equal(isStartChord(NAMES, 1, 'Am'), false);
});

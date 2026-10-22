import test from 'node:test';
import assert from 'node:assert/strict';
import { bpmFromTaps, TapTempo, scaleBpm } from '../src/tap-tempo.js';

const taps = (interval, n, start = 0) => Array.from({ length: n }, (_, i) => start + i * interval);

test('menos de 2 toques → null', () => {
  assert.equal(bpmFromTaps([]), null);
  assert.equal(bpmFromTaps([1000]), null);
});

test('intervalos regulares', () => {
  assert.equal(bpmFromTaps(taps(500, 5)), 120);
  assert.equal(bpmFromTaps(taps(652, 6)), 92);
});

test('descarta outliers (toque perdido / duplo)', () => {
  // 500ms, mas com um toque perdido (1000) e um toque duplo (100)
  const t = [0, 500, 1000, 2000, 2500, 2600, 3100, 3600];
  assert.equal(bpmFromTaps(t), 120);
});

test('usa apenas os últimos 8 toques', () => {
  const lento = taps(1000, 6); // 60 bpm
  const rapido = taps(500, 8, 6000); // 120 bpm
  assert.equal(bpmFromTaps([...lento, ...rapido]), 120);
});

test('limites 20–300', () => {
  assert.equal(bpmFromTaps(taps(100, 4)), 300);
  assert.equal(bpmFromTaps(taps(5000, 3)), 20);
});

test('TapTempo reinicia depois de uma pausa longa', () => {
  const t = new TapTempo({ resetAfter: 2000 });
  assert.equal(t.tap(0), null);
  assert.equal(t.tap(600), 100);
  assert.equal(t.tap(1200), 100);
  assert.equal(t.tap(10000), null); // pausa → recomeça
  assert.equal(t.tap(10500), 120);
});

test('½× e 2× respeitam os limites', () => {
  assert.equal(scaleBpm(92, 2), 184);
  assert.equal(scaleBpm(92, 0.5), 46);
  assert.equal(scaleBpm(200, 2), 300);
  assert.equal(scaleBpm(30, 0.5), 20);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSong } from '../src/parser.js';
import { buildTimeline, locate, nextChords } from '../src/timeline.js';
import { beatForVideoTime, sectionToMark } from '../src/markers.js';

const items = parseSong(`[Intro]
Am F C G

[Verso]
Am        F
Letra um
C   G
Letra dois

[Refrão]
F G
Outra`);

test('seções e linhas na linha do tempo', () => {
  const tl = buildTimeline(items, '4/4', 2);
  assert.equal(tl.lines.length, 4);
  assert.deepEqual(tl.sections.map((s) => [s.name, s.startBeat]), [['Intro', 0], ['Verso', 8], ['Refrão', 24]]);
  assert.equal(tl.totalBeats, 32);
  assert.equal(tl.steps.length, 10);
});

test('acordes dividem a linha igualmente', () => {
  const tl = buildTimeline(items, '4/4', 2);
  const l = locate(tl, 3.9);
  assert.equal(l.lineIdx, 0);
  assert.equal(l.stepIdx, 1); // F ocupa os beats 2–4
  assert.equal(locate(tl, 4).stepIdx, 2);
  assert.equal(locate(tl, 4).beatsToChange, 2);
});

test('progresso, compassos e fim', () => {
  const tl = buildTimeline(items, '3/4', 1);
  const l = locate(tl, 4.5);
  assert.equal(l.lineIdx, 1);
  assert.equal(l.bar, 2);
  assert.equal(l.beatInBar, 1);
  assert.ok(Math.abs(l.lineProgress - 0.5) < 1e-9);
  assert.equal(locate(tl, 999).finished, true);
  assert.equal(locate(tl, -2).lineIdx, 0);
});

test('compassos por linha mudam a duração', () => {
  assert.equal(buildTimeline(items, '4/4', 1).totalBeats, 16);
  assert.equal(buildTimeline(items, '6/8', 4).totalBeats, 4 * 6 * 4);
});

test('próximos acordes atravessam linhas', () => {
  const tl = buildTimeline(items, '4/4', 2);
  const next = nextChords(tl, 3, 4).map((s) => s.name);
  assert.deepEqual(next, ['Am', 'F', 'C', 'G']);
  assert.equal(nextChords(tl, 9, 4).length, 0);
});

test('marcadores re-ancoram a cifra no tempo do vídeo', () => {
  const tl = buildTimeline(items, '4/4', 2);
  const bpm = 120; // 2 beats/s
  assert.equal(beatForVideoTime(tl, {}, bpm, 10), 20);
  const markers = { 0: 4, 1: 20 }; // Intro em 4s, Verso em 20s
  assert.equal(beatForVideoTime(tl, markers, bpm, 4), 0);
  assert.equal(beatForVideoTime(tl, markers, bpm, 6), 4);
  assert.equal(beatForVideoTime(tl, markers, bpm, 20), 8); // pula p/ início do Verso
  assert.equal(beatForVideoTime(tl, markers, bpm, 21, 1), 11);
  assert.equal(sectionToMark(tl, markers, 1), 2);
  assert.equal(sectionToMark(tl, { 0: 1, 1: 2, 2: 3 }, 1), 1);
});

import { videoTimeForBeat } from '../src/markers.js';

test('videoTimeForBeat inverte beatForVideoTime dentro da duração nominal da seção', () => {
  const tl = buildTimeline(items, '4/4', 2);
  const markers = { 0: 4, 1: 20 };
  for (const t of [4, 5.5, 20, 33]) {
    assert.ok(Math.abs(videoTimeForBeat(tl, markers, 120, beatForVideoTime(tl, markers, 120, t, 1), 1) - t) < 1e-9);
  }
  assert.equal(videoTimeForBeat(tl, {}, 120, 20), 10);
  assert.equal(videoTimeForBeat(tl, markers, 120, 8), 20); // início do Verso → marcador do Verso
});

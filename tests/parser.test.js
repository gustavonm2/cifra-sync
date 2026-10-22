import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSong, parseChordLine, firstChord } from '../src/parser.js';

const SAMPLE = `[Intro] Am  F  C  G

[Primeira Parte]
Am            F          C   G
Na beira da estrada o sol vai caindo

C         G         Am        F
E a gente canta sem pensar no amanhã

[Refrão]
C     G      F C       Am
Cante junto, o tempo é nosso
`;

test('linha de acordes: colunas preservadas', () => {
  assert.deepEqual(parseChordLine('Am            F          C   G'), [
    { name: 'Am', col: 0 },
    { name: 'F', col: 14 },
    { name: 'C', col: 25 },
    { name: 'G', col: 29 },
  ]);
});

test('linha de letra não é linha de acorde', () => {
  assert.equal(parseChordLine('Na beira da estrada o sol vai caindo'), null);
  assert.equal(parseChordLine('E a gente canta'), null);
  assert.equal(parseChordLine('Amor'), null);
});

test('marcas como | e x2 são toleradas', () => {
  const c = parseChordLine('| Am  F | C  G | x2');
  assert.deepEqual(c.map((x) => x.name), ['Am', 'F', 'C', 'G']);
  assert.equal(parseChordLine('| x2 |'), null);
});

test('seções, pares acorde/letra e acordes na linha da seção', () => {
  const items = parseSong(SAMPLE);
  const sections = items.filter((i) => i.kind === 'section').map((i) => i.name);
  assert.deepEqual(sections, ['Intro', 'Primeira Parte', 'Refrão']);

  const lines = items.filter((i) => i.kind === 'line');
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].chords.map((c) => c.name), ['Am', 'F', 'C', 'G']);
  assert.equal(lines[0].lyric, null);
  assert.equal(lines[1].lyric, 'Na beira da estrada o sol vai caindo');
  assert.equal(lines[1].chords[1].col, 14);
  assert.equal(firstChord(items), 'Am');
});

test('seção sem colchetes: "Refrão:" e "Intro: Am F"', () => {
  const items = parseSong('Intro: Am F\nRefrão:\nC G\nvida que segue');
  assert.deepEqual(items.map((i) => i.kind), ['section', 'line', 'section', 'line']);
  assert.equal(items[0].name, 'Intro');
  assert.deepEqual(items[1].chords.map((c) => c.name), ['Am', 'F']);
  assert.equal(items[3].lyric, 'vida que segue');
});

test('"Final feliz" sem dois-pontos continua sendo letra', () => {
  const items = parseSong('Final feliz pra nós');
  assert.deepEqual(items, [{ kind: 'line', chords: [], lyric: 'Final feliz pra nós' }]);
});

test('linha de acordes seguida de outra linha de acordes não consome a próxima', () => {
  const items = parseSong('Am F\nC G\nletra');
  assert.equal(items.length, 2);
  assert.equal(items[0].lyric, null);
  assert.equal(items[1].lyric, 'letra');
});

test('normaliza CRLF, nbsp e tabs; remove brancos finais', () => {
  const items = parseSong('Am\u00a0\u00a0F\r\nOlá\r\n\r\n\r\n\r\n');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].chords, [{ name: 'Am', col: 0 }, { name: 'F', col: 4 }]);
});

test('caracteres invisíveis e espaços Unicode não quebram a detecção de acordes', () => {
  const casos = ['​G6\nA solidão entrou', ' ​  G6​\nA solidão entrou', 'G6­\nA solidão entrou', '  G6　\nA solidão entrou', 'G​6\nA solidão entrou'];
  for (const c of casos) {
    const lines = parseSong(c).filter((i) => i.kind === 'line');
    assert.equal(lines.length, 1, JSON.stringify(c));
    assert.deepEqual(lines[0].chords.map((x) => x.name), ['G6'], JSON.stringify(c));
    assert.equal(lines[0].lyric, 'A solidão entrou');
  }
});

test('espaços Unicode largos mantêm a coluna do acorde', () => {
  const [l] = parseSong('Am  F\nletra aqui').filter((i) => i.kind === 'line');
  assert.deepEqual(l.chords, [{ name: 'Am', col: 0 }, { name: 'F', col: 4 }]);
});

import { isTabLine } from '../src/parser.js';

test('reconhece linhas de tablatura', () => {
  for (const t of ['e|-----0---3-----|', 'B|--1---1-----|', 'G|-----0h2---|', 'E|---------3---|', '|--5h7--|', 'D ---0---2---', 'A|-2-2-----2/4---|']) {
    assert.equal(isTabLine(t), true, t);
  }
  for (const t of ['Am F - G', 'Na beira da estrada', 'Am | F | C', '', '- - -', 'E a gente']) assert.equal(isTabLine(t), false, t);
});

test('tablaturas são descartadas junto com a seção que só tinha tablatura', () => {
  const items = parseSong(`[Intro] Am F

[Tab - Solo]
e|-----0---3-----|
B|--1---1-----1--|
G|-----0-----2---|
D|---2-----------|
A|--0------------|
E|---------------|

[Verso]
Am        F
Letra um`);
  assert.deepEqual(items.filter((i) => i.kind === 'section').map((i) => i.name), ['Intro', 'Verso']);
  assert.ok(!JSON.stringify(items).includes('---'));
  assert.equal(items.filter((i) => i.kind === 'line').length, 2);
});

test('tablatura entre acorde e letra não vira a letra do acorde', () => {
  const items = parseSong('Am F\ne|---0---|\nLetra');
  const lines = items.filter((i) => i.kind === 'line');
  assert.equal(lines[0].lyric, null);
  assert.equal(lines[1].lyric, 'Letra');
});

test('seções com tablatura no meio mantêm acordes e letra', () => {
  const items = parseSong('[Solo]\nAm F\ne|--0--|\nB|--1--|\nPalavra');
  assert.equal(items.filter((i) => i.kind === 'line').length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCifraUrl, isCifraClubUrl, extractCifra } from '../src/cifraclub.js';
import { parseSong } from '../src/parser.js';

const HTML = `<html><head><title>TEMPO PERDIDO - Legião Urbana</title>
<meta property="og:title" content="TEMPO PERDIDO - Legi&atilde;o Urbana (cifra para violão e guitarra)"></head><body>
<h1 class="t1">Tempo Perdido</h1><h2 class="t3"><a href="/legiao-urbana/">Legião Urbana</a></h2>
<div class="cifra_cnt"><pre>[Intro] <b>Em</b>  <b>D</b>  <b>C</b>

[Primeira Parte]
<b>Em</b>            <b>D</b>
Todos os dias quando acordo&amp;
<b>C</b>      <b>G/B</b>
N&atilde;o tenho mais o tempo que passou</pre></div></body></html>`;

test('aceita só URLs do Cifra Club com artista/música', () => {
  assert.equal(normalizeCifraUrl('https://www.cifraclub.com.br/legiao-urbana/tempo-perdido/?utm=x#a').href, 'https://www.cifraclub.com.br/legiao-urbana/tempo-perdido/');
  assert.equal(normalizeCifraUrl('http://m.cifraclub.com.br/a/b/').hostname, 'www.cifraclub.com.br');
  assert.ok(isCifraClubUrl('cifraclub.com/a/b') === false); // sem protocolo
  for (const bad of ['https://evil.com/a/b', 'https://cifraclub.com.br.evil.com/a/b', 'https://www.cifraclub.com.br/legiao-urbana/', 'file:///etc/passwd', 'http://127.0.0.1/a/b', '', 'abc']) {
    assert.equal(normalizeCifraUrl(bad), null, bad);
  }
});

test('extrai título, artista e texto sem tags nem entidades', () => {
  const { title, artist, text } = extractCifra(HTML);
  assert.equal(title, 'Tempo Perdido');
  assert.equal(artist, 'Legião Urbana');
  assert.match(text, /^\[Intro\] Em {2}D {2}C\n/);
  assert.match(text, /Todos os dias quando acordo&\n/);
  assert.match(text, /Não tenho mais/);
  assert.ok(!text.includes('<'));
});

test('o texto extraído passa pelo parser como cifra', () => {
  const items = parseSong(extractCifra(HTML).text);
  assert.deepEqual(items.filter((i) => i.kind === 'section').map((i) => i.name), ['Intro', 'Primeira Parte']);
  const lines = items.filter((i) => i.kind === 'line');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[2].chords.map((c) => c.name), ['C', 'G/B']);
});

test('título/artista via og:title quando faltam h1/h2', () => {
  const r = extractCifra('<meta property="og:title" content="Wonderwall - Oasis (cifra)"><pre>Em7 G</pre>');
  assert.equal(r.title, 'Wonderwall');
  assert.equal(r.artist, 'Oasis');
});

test('erros claros', () => {
  assert.throws(() => extractCifra('<html>nada</html>'), /Não encontrei/);
  assert.throws(() => extractCifra('<pre>  \n </pre>'), /vazia/);
});

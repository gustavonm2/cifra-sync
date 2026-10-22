// Extração de cifra a partir do HTML de uma página do Cifra Club (função pura, usada pela API).

const HOST_RE = /^(?:www\.|m\.)?cifraclub\.com(?:\.br)?$/i;

/** Valida e normaliza a URL: só cifraclub, caminho /artista/musica/. Devolve URL ou null. */
export function normalizeCifraUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!HOST_RE.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  u.protocol = 'https:';
  u.search = '';
  u.hash = '';
  u.hostname = u.hostname.replace(/^m\./i, 'www.');
  return u;
}

export function isCifraClubUrl(input) {
  return normalizeCifraUrl(input) !== null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ' };
// vogais acentuadas: &aacute; &eacute; &atilde; &ocirc; ... (e maiúsculas)
for (const [v, forms] of Object.entries({ a: 'áàâãä', e: 'éèêë', i: 'íìîï', o: 'óòôõö', u: 'úùûü' })) {
  ['acute', 'grave', 'circ', 'tilde', 'uml'].forEach((k, n) => {
    if (forms[n] && !(v !== 'a' && v !== 'o' && k === 'tilde')) {
      ENTITIES[v + k] = forms[n];
      ENTITIES[v.toUpperCase() + k] = forms[n].toUpperCase();
    }
  });
}
function decode(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s) => s.replace(/<[^>]*>/g, '');

function meta(html, prop) {
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return m ? decode(m[1]).trim() : '';
}

/** { title, artist, text } ou lança Error com mensagem em português. */
export function extractCifra(html) {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  if (!pre) throw new Error('Não encontrei a cifra nessa página.');
  const text = decode(
    stripTags(pre[1].replace(/<br\s*\/?>/gi, '\n')),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\s+$/g, '');
  if (!text) throw new Error('A cifra veio vazia.');

  let title = '';
  let artist = '';
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) title = decode(stripTags(h1[1])).trim();
  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  if (h2) artist = decode(stripTags(h2[1])).trim();

  if (!title || !artist) {
    // og:title costuma ser "MÚSICA - Artista (cifra para violão e guitarra)"
    const og = meta(html, 'og:title') || decode(stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ?? [])[1] ?? ''));
    const m = /^(.*?)\s+-\s+(.*?)(?:\s*\(.*\))?(?:\s*\|.*)?$/.exec(og.trim());
    if (m) {
      title ||= m[1].trim();
      artist ||= m[2].trim();
    }
  }
  return { title, artist, text };
}

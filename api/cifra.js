// Função serverless (Vercel) que busca uma página do Cifra Club e devolve { title, artist, text }.
// Necessária porque o navegador não pode ler o Cifra Club diretamente (CORS).
import { normalizeCifraUrl, extractCifra } from '../src/cifraclub.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=86400' : 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const raw = req.query?.url ?? new URL(req.url, 'http://x').searchParams.get('url');
  const url = normalizeCifraUrl(raw);
  if (!url) return send(res, 400, { error: 'Cole um link do Cifra Club no formato cifraclub.com.br/artista/musica/' });

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!normalizeCifraUrl(r.url)) return send(res, 502, { error: 'O Cifra Club redirecionou para outro endereço.' });
    if (r.status === 403 || r.status === 429) return send(res, 502, { error: 'O Cifra Club bloqueou a busca automática. Copie e cole o texto da cifra.' });
    if (!r.ok) return send(res, 502, { error: `O Cifra Club respondeu ${r.status}. Confira o link.` });
    const html = await r.text();
    send(res, 200, extractCifra(html));
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    send(res, 502, { error: timeout ? 'O Cifra Club demorou demais para responder.' : e.message || 'Falha ao buscar a cifra.' });
  }
}

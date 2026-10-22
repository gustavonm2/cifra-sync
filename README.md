# Cifra Sync

Leitor de cifras para violão. Cole a cifra (formato Cifra Club, acordes acima da letra) e o app mostra a cifra rolando, com uma **fila horizontal de acordes** que atravessa a tela e anda na **velocidade que você escolher**. Pensado para tablet ou celular no suporte de partitura.

HTML + CSS + JavaScript puro (módulos ES), sem build e sem dependências. Tudo fica no `localStorage`. Instalável como PWA e funciona offline.

## Rodar

```bash
npm start          # servidor estático em http://localhost:8080
# ou: npx serve .  /  python3 -m http.server 8080
```

Use `http://` (não `file://`): o service worker exige. Para instalar no tablet, sirva por HTTPS (a Vercel já serve) e use "Adicionar à tela inicial".

## Testar

```bash
npm test           # node --test (Node 18+), sem dependências
```

Cobrem o parser de cifras (`tests/parser.test.js`), acordes e transposição (`tests/chords.test.js`) e a sequência de acordes e a velocidade (`tests/steps.test.js`).

## Como usar

1. **Colar cifra** → título, artista e o texto. O app mostra quantas linhas de acordes e seções detectou. Tablaturas (`e|---0---|`) são ignoradas.
2. **Play** (ou `Espaço`). A fila de acordes fica parada no acorde atual (âmbar, com barra de progresso) e desliza para o próximo no fim do tempo dele. A cifra rola de modo que a linha atual e as duas seguintes fiquem visíveis.
3. **Velocidade manual:** segundos por acorde (0,5 a 8), pelos botões − / +, pelo slider ou por **Lento / Normal / Rápido**. Cada acorde dura o mesmo tempo. A velocidade fica salva por música.
4. **Passo manual:** ⏮ / ⏭ (ou `←` / `→`) voltam e avançam um acorde. Tocar num acorde da fila, ou numa linha da cifra, pula para lá.
5. **Tom − / +** transpõe todos os acordes, inclusive o baixo (`C/G`), com sustenidos ou bemóis conforme o tom de destino.
6. **A− / A+** mudam o tamanho da letra. A tela fica acesa enquanto a cifra anda (onde o navegador permite).
7. **Biblioteca:** salva e abre músicas (título, artista, cifra, tom, velocidade).

### Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | play / pause |
| `←` `→` | acorde anterior / próximo |
| `↑` `↓` | mais rápido / mais lento |

## Importar do Cifra Club

O Cifra Club recusa buscas automáticas vindas de servidores, então o app não busca o link por conta própria. Em **Colar cifra**, arraste o botão **Enviar ao Cifra Sync** para a barra de favoritos (Cmd/Ctrl+Shift+B mostra a barra). Depois, com a cifra aberta no Cifra Club, clique no favorito: ele lê a página no seu navegador e abre o Cifra Sync com título, artista e cifra preenchidos (via `#import=` na URL; nada passa por servidor). Sem barra de favoritos (celular), copie o texto da cifra e cole na caixa.

Use apenas para sua cifra pessoal: o conteúdo pertence ao Cifra Club e aos autores.

## Estrutura

```
index.html  manifest.webmanifest  sw.js  vercel.json
src/
  parser.js    texto → seções e linhas (acordes com coluna + letra); ignora tablaturas
  chords.js    reconhecimento e transposição de acordes
  steps.js     sequência de acordes, posição, avanço no tempo e curva de passagem
  storage.js   localStorage (com fallback em memória)
  demo.js      música de exemplo
  app.js       interface e laço de animação
styles/app.css   fonts/ (JetBrains Mono, local)   icons/   scripts/   tests/
```

## Notas de projeto

- A posição é um número contínuo (índice do acorde + fração do tempo dele), atualizado a cada quadro de animação; não há áudio, vídeo nem BPM.
- O texto colado passa por normalização (nbsp, espaços Unicode e caracteres invisíveis são tratados) antes de reconhecer as linhas de acordes.
- **Limites:** seções repetidas ("Refrão 2x") não são expandidas, cada seção aparece uma vez como na cifra colada; linhas só com letra não entram na fila de acordes.

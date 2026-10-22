# Cifra Sync

Leitor de cifras para violão: cole a cifra (formato Cifra Club, acordes acima da letra) e, se quiser, o link de um vídeo do YouTube. O app rola a cifra no ritmo de um metrônomo, destaca o acorde atual e mostra os próximos 4 acordes em blocos grandes.

HTML + CSS + JavaScript puro (módulos ES), sem build e sem dependências. Tudo fica no `localStorage`. Funciona como PWA offline (exceto o vídeo).

## Rodar

```bash
npm start          # servidor estático em http://localhost:8080
# ou: npx serve .  /  python3 -m http.server 8080
```

Use sempre `http://` (não `file://`): o service worker e o player do YouTube exigem isso. Para instalar no tablet/celular, sirva por HTTPS (qualquer hospedagem estática) e use "Adicionar à tela inicial".

## Testar

```bash
npm test           # node --test (Node 18+), sem dependências
```

Cobrem o parser de cifras (`tests/parser.test.js`), acordes e transposição (`tests/chords.test.js`), tap tempo (`tests/tap-tempo.test.js`) linha do tempo/marcadores (`tests/timeline.test.js`) e extração do Cifra Club (`tests/cifraclub.test.js`).

## Importar do Cifra Club

O Cifra Club recusa buscas automáticas vindas de servidores, então o app não busca o link por conta própria. Em **Colar cifra**, arraste o botão **Enviar ao Cifra Sync** para a barra de favoritos (Cmd/Ctrl+Shift+B mostra a barra). Depois, com a cifra aberta no Cifra Club, clique no favorito: ele lê a página no seu navegador e abre o Cifra Sync com título, artista e cifra preenchidos (via `#import=` na URL; nada passa por servidor). Sem barra de favoritos (celular), copie o texto da cifra e cole na caixa.

Use apenas para sua cifra pessoal: o conteúdo pertence ao Cifra Club e aos autores.

## Como usar

1. **Colar cifra** → título, artista, URL do YouTube e o texto. O app mostra quantas linhas de acordes e seções detectou.
2. Ajuste o **BPM** (campo, **Tap tempo**, ½× / 2×), o **compasso** (4/4, 3/4, 6/8) e os **compassos por linha** (1–4). Cada linha com acordes dura esse número de compassos; os acordes dividem o tempo da linha igualmente.
3. **Play** (ou `Espaço`). A linha atual fica destacada com barra de progresso, o acorde atual em âmbar e os próximos 4 no painel.
4. **Tom − / +** transpõe todos os acordes, inclusive o baixo (`C/G`), com sustenidos/bemóis conforme o tom de destino.
5. **Ajuste (batidas)** ou `←` / `→` deslocam a cifra ±1 batida para alinhar com a gravação.

### Sincronizar com o vídeo

1. Cole a URL do YouTube e espere o player aparecer.
2. Ative **Sincronizar com o vídeo**: o play/pause/seek do vídeo passam a controlar o metrônomo e a cifra.
3. **Calibrar** (o app mostra essa dica enquanto faltar algo): ajuste o BPM com **Tap tempo** batendo no ritmo da música; depois use **Marcar seção** no instante exato em que a música começa. Sem essa marcação o app supõe que a música começa em 0:00 do vídeo, e a batida do metrônomo fica defasada. O **Ajuste fino (ms)** desloca a cifra em passos de 20 ms para encaixar o clique na batida.
4. **Marcar seção**: no instante em que cada seção começa no vídeo, toque no botão. Ele marca a primeira seção ainda sem marcador (depois, a atual, para corrigir). Os marcadores recalculam a posição da cifra a partir de cada seção, corrigindo a deriva de gravações sem andamento fixo.
5. A linha do tempo embaixo é clicável: pula a cifra (e o vídeo, se sincronizado) para a seção. `Editar → Limpar marcadores` zera tudo.

Nenhum áudio é baixado: o vídeo é só o player embutido da IFrame API.

### Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | play / pause |
| `R` | reiniciar |
| `T` | tap tempo |
| `M` | liga/desliga o som do clique |
| `←` `→` | offset −1 / +1 batida |
| `↑` `↓` | BPM +1 / −1 |

## Estrutura

```
index.html  manifest.webmanifest  sw.js
src/
  parser.js      texto → seções e linhas (acordes com coluna + letra)
  chords.js      reconhecimento e transposição de acordes
  tap-tempo.js   BPM por toques (mediana, descarte de outliers), ½×/2×
  timeline.js    linhas/acordes em tempos; localiza a posição; próximos acordes
  metronome.js   Web Audio com lookahead; posição contínua em tempos
  markers.js     marcadores de seção ↔ tempo do vídeo
  youtube.js     IFrame API e extração do ID do vídeo
  storage.js     localStorage (com fallback em memória)
  app.js         interface e laço de animação
styles/app.css   fonts/ (JetBrains Mono, local)   icons/   scripts/   tests/
```

## Notas de projeto

- **Metrônomo:** a posição da cifra vem de um relógio próprio (`performance.now`), então ela anda mesmo que o navegador mantenha o áudio suspenso (o que acontece quando o play é apertado dentro do player do YouTube). Os cliques são agendados no `AudioContext` ~120 ms à frente por um agendador de 25 ms, convertendo o tempo do relógio para o do áudio.
- **6/8:** o BPM conta colcheias (6 tempos por compasso, acento forte no 1 e médio no 4).
- **Áudio no navegador:** o `AudioContext` só roda após um toque na página. Se o vídeo for iniciado direto no player do YouTube sem nenhum toque prévio, o app avisa para tocar na tela.
- **Sincronia:** a posição vem do tempo do vídeo + marcadores. Pequenas diferenças são corrigidas aos poucos (sem pular o clique); diferenças maiores que ~0,75 batida (seek, mudança de seção) saltam.
- **Tablaturas:** linhas como `e|---0---3--|` são descartadas ao interpretar a cifra, junto com seções que só tinham tablatura.
- **Limites da v1:** seções repetidas ("Refrão 2x") não são expandidas — cada seção aparece uma vez, como na cifra colada; linhas só com letra (sem acordes) não consomem tempo; ao mudar o BPM no modo sincronizado, a cifra se realinha ao vídeo em até ~0,75 batida.

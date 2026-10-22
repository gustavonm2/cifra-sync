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

Em **Colar cifra**, cole o link (`https://www.cifraclub.com.br/artista/musica/`) no campo "Importar" e toque em **Importar**; colar só o link direto na caixa da cifra também funciona. Título, artista e cifra são preenchidos e você revisa antes de salvar.

O navegador não pode ler o Cifra Club diretamente (CORS), então a busca passa por `api/cifra.js`, uma função serverless da Vercel (também atendida por `npm start` em `/api/cifra`). Ela só aceita links de `cifraclub.com(.br)` e não guarda nada. Se o site bloquear a busca automática ou mudar o HTML, o app mostra o erro e o caminho de copiar/colar continua funcionando. Sem o deploy (por exemplo, hospedagem puramente estática), só o copiar/colar funciona. Use apenas para sua cifra pessoal: o conteúdo pertence ao Cifra Club e aos autores.

## Como usar

1. **Colar cifra** → título, artista, URL do YouTube e o texto. O app mostra quantas linhas de acordes e seções detectou.
2. Ajuste o **BPM** (campo, **Tap tempo**, ½× / 2×), o **compasso** (4/4, 3/4, 6/8) e os **compassos por linha** (1–4). Cada linha com acordes dura esse número de compassos; os acordes dividem o tempo da linha igualmente.
3. **Play** (ou `Espaço`). A linha atual fica destacada com barra de progresso, o acorde atual em âmbar e os próximos 4 no painel.
4. **Tom − / +** transpõe todos os acordes, inclusive o baixo (`C/G`), com sustenidos/bemóis conforme o tom de destino.
5. **Ajuste (batidas)** ou `←` / `→` deslocam a cifra ±1 batida para alinhar com a gravação.

### Sincronizar com o vídeo

1. Cole a URL do YouTube e espere o player aparecer.
2. Ative **Sincronizar com o vídeo**: o play/pause/seek do vídeo passam a controlar o metrônomo e a cifra.
3. **Marcar seção**: no instante em que cada seção começa no vídeo, toque no botão. Ele marca a primeira seção ainda sem marcador (depois, a atual, para corrigir). Os marcadores recalculam a posição da cifra a partir de cada seção, corrigindo a deriva de gravações sem andamento fixo.
4. A linha do tempo embaixo é clicável: pula a cifra (e o vídeo, se sincronizado) para a seção. `Editar → Limpar marcadores` zera tudo.

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
api/cifra.js     função serverless: busca a página do Cifra Club
src/
  cifraclub.js   valida o link e extrai título/artista/cifra do HTML
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

- **Metrônomo:** o relógio é o do `AudioContext`; os cliques são agendados ~120 ms à frente por um agendador de 25 ms. A posição da cifra é calculada continuamente a partir do relógio de áudio (não por contagem de timers), então não há jitter nem deriva entre clique e tela.
- **6/8:** o BPM conta colcheias (6 tempos por compasso, acento forte no 1 e médio no 4).
- **Áudio no navegador:** o `AudioContext` só roda após um toque na página. Se o vídeo for iniciado direto no player do YouTube sem nenhum toque prévio, o app avisa para tocar na tela.
- **Limites da v1:** seções repetidas ("Refrão 2x") não são expandidas — cada seção aparece uma vez, como na cifra colada; linhas só com letra (sem acordes) não consomem tempo; ao mudar o BPM no modo sincronizado, a cifra se realinha ao vídeo em até ~0,75 batida.

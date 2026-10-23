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

Cobrem o parser de cifras (`tests/parser.test.js`), acordes, transposição e notas dos acordes (`tests/chords.test.js`), a sequência de acordes e a velocidade (`tests/steps.test.js`), o reconhecimento de acordes por áudio com violão sintético (`tests/audio.test.js`) e a lógica de acompanhar o que você toca (`tests/follow.test.js`).

## Como usar

1. **Colar cifra** → título, artista e o texto. O app mostra quantas linhas de acordes e seções detectou. Tablaturas (`e|---0---|`) são ignoradas.
2. **Como começar** (caixa na lateral direita):
   - **Direto:** a cifra anda assim que você dá play.
   - **Contagem:** 3, 5, 10 ou 15 s de contagem regressiva para você se preparar (padrão: 3 s).
   - **Ouvir acorde:** dê play e toque o primeiro acorde; a cifra começa quando o app o ouvir (usa o microfone). Há um botão "Começar agora" se preferir.
3. **Seguir o meu áudio** (opcional, usa o microfone): depois de começar, a cifra acompanha o que você toca. Quando o app ouve o próximo acorde, ele avança; se você demora, a cifra espera; se você pula 1 a 3 acordes, ela acompanha. A velocidade (segundos por acorde) é estimada pelo seu toque e fica salva ao parar. Se você parar de tocar por 6 s, ela pausa e espera você voltar ao acorde atual.
4. **Play** (ou `Espaço`). A fila de acordes fica parada no acorde atual (âmbar, com barra de progresso) e desliza para o próximo no fim do tempo dele. A cifra rola de modo que a linha atual e as duas seguintes fiquem visíveis. `Esc` cancela a contagem ou a escuta.
5. **Velocidade manual:** segundos por acorde (0,5 a 8), pelos botões − / +, pelo slider ou por **Lento / Normal / Rápido**. Cada acorde dura o mesmo tempo. Fica salva por música.
6. **Passo manual:** ⏮ / ⏭ (ou `←` / `→`) voltam e avançam um acorde. Tocar num acorde da fila, da caixa lateral ou numa linha da cifra pula para lá.
7. **Acordes da música** (caixa lateral): cada acorde diferente, com as notas que o formam (ex.: `Am` → A · C · E), quantas vezes aparece e o acorde atual em destaque. Tocar num deles pula para a primeira vez em que aparece. No celular fica na gaveta **Painel**.
8. **Tom − / +** transpõe todos os acordes, inclusive o baixo (`C/G`), com sustenidos ou bemóis conforme o tom de destino.
9. **A− / A+** mudam o tamanho da letra. A tela fica acesa enquanto a cifra anda (onde o navegador permite).
10. **Biblioteca:** salva e abre músicas (título, artista, cifra, tom, velocidade).

### Como o áudio funciona

O navegador pede permissão do microfone (só funciona em HTTPS ou `localhost`). O som vira um espectro, que vira 12 "classes de nota", e é comparado **apenas com os acordes da própria música**, o que torna o reconhecimento muito mais confiável do que tentar reconhecer qualquer acorde. Nada é gravado nem enviado: o processamento é todo no aparelho, e o microfone é desligado ao pausar.

Dicas: toque perto do microfone, em ambiente razoavelmente silencioso, e deixe os primeiros ~0,6 s em silêncio depois de dar play (o app mede o ruído ambiente nesse instante). O reconhecimento foi validado com violão sintético e com um microfone de teste; em violões reais, com ruído e acordes bem parecidos (ex.: `Am` × `C`), pode errar de vez em quando, e por isso a cifra nunca foge à frente de você.

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
  chords.js    reconhecimento, transposição e notas dos acordes
  steps.js     sequência de acordes, posição, avanço no tempo e curva de passagem
  audio.js     microfone → espectro → acorde da música (reconhecimento por áudio)
  follow.js    acompanha o que você toca: avança, espera, estima a velocidade
  storage.js   localStorage (com fallback em memória)
  demo.js      música de exemplo
  app.js       interface e laço de animação
styles/app.css   fonts/ (JetBrains Mono, local)   icons/   scripts/   tests/
```

## Notas de projeto

- A posição é um número contínuo (índice do acorde + fração do tempo dele), atualizado a cada quadro de animação. Não há BPM nem metrônomo: o ritmo é a velocidade manual ou o que o app ouve você tocar.
- O texto colado passa por normalização (nbsp, espaços Unicode e caracteres invisíveis são tratados) antes de reconhecer as linhas de acordes.
- **Limites:** seções repetidas ("Refrão 2x") não são expandidas, cada seção aparece uma vez como na cifra colada; linhas só com letra não entram na fila de acordes.

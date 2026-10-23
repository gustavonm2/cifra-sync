// Tela da biblioteca: músicas (com estilo e busca), playlists (montar, ordenar, tocar) e código da nuvem.
import { genresOf, filterSongs, PRESET_GENRES } from './library.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const btn = (label, cls = 'btn', onClick) => {
  const b = el('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const fmtSpeed = (s) => String(s).replace('.', ',') + ' s';
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function createLibraryUI({ lib, dlg, body, currentSongId, onOpenSong, onEditSong, onNewSong, onPlayPlaylist, onCodeChanged }) {
  const ui = { tab: 'songs', genre: '', query: '', view: 'list', playlistId: null, addQuery: '' };

  function statusText() {
    const { state, message, at } = lib.status;
    if (!lib.cloudOn) return 'Só neste aparelho';
    if (state === 'syncing') return '☁ Sincronizando…';
    if (state === 'ok') return `☁ Sincronizado às ${fmtTime(at)}`;
    if (state === 'offline') return '☁ Sem internet — salvo neste aparelho';
    if (state === 'error') return '☁ ' + message;
    return '☁ Pronto para sincronizar';
  }

  function header(title, back) {
    const h = el('div', 'lib-head');
    if (back) h.append(btn('← Voltar', 'btn', () => { ui.view = 'list'; render(); }));
    h.append(el('h2', '', title), el('span', 'spacer'));
    return h;
  }

  function cloudBar() {
    const bar = el('div', 'cloud-bar');
    const st = el('span', 'cloud-status' + (lib.status.state === 'error' ? ' err' : ''), statusText());
    st.id = 'lib-status';
    bar.append(st, el('span', 'spacer'));
    if (lib.cloudOn) {
      bar.append(btn('Sincronizar', 'btn', () => lib.sync()), btn('Código', 'btn', () => { ui.view = 'code'; render(); }));
    }
    return bar;
  }

  function chips(options, current, onPick) {
    const row = el('div', 'chips');
    const mk = (label, value) => {
      const b = btn(label, 'chipbtn' + (current === value ? ' on' : ''), () => onPick(value));
      b.setAttribute('aria-pressed', String(current === value));
      row.append(b);
    };
    mk('Todos', '');
    options.forEach((g) => mk(g, g));
    return row;
  }

  // ---------- músicas ----------
  function songsView() {
    const wrap = el('div');
    const all = lib.visibleSongs;
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Buscar por título, artista ou estilo';
    search.value = ui.query;
    search.addEventListener('input', () => { ui.query = search.value; renderSongList(); });
    wrap.append(search);
    const genres = genresOf(all);
    if (genres.length) wrap.append(chips(genres, ui.genre, (g) => { ui.genre = g; render(); }));
    const list = el('ul', 'library');
    list.id = 'lib-songs';
    wrap.append(list);
    wrap.append(el('div', 'dlg-actions'));
    wrap.lastChild.append(btn('Nova música', 'btn', onNewSong));
    ui._songList = list;
    renderSongList();
    return wrap;
  }

  function renderSongList() {
    const list = ui._songList;
    if (!list) return;
    list.replaceChildren();
    const songs = filterSongs(lib.visibleSongs, { genre: ui.genre, query: ui.query });
    if (!songs.length) list.append(el('li', 'empty', lib.visibleSongs.length ? 'Nada encontrado.' : 'Nenhuma música salva ainda.'));
    for (const s of songs) {
      const li = el('li', s.id === currentSongId() ? 'current' : '');
      const meta = el('div', 'meta');
      const sub = [s.artist, s.genre, fmtSpeed(s.speed) + '/acorde', s.timing ? '● andamento gravado' : ''].filter(Boolean).join(' · ');
      meta.append(el('b', '', s.title || 'Sem título'), el('small', '', sub));
      li.append(meta, btn('Abrir', 'btn primary', () => onOpenSong(s)), btn('+ Playlist', 'btn', (e) => addToMenu(s, e.currentTarget)), btn('Editar', 'btn', () => onEditSong(s)));
      const del = btn('🗑', 'btn icon', () => {
        if (!confirm(`Excluir “${s.title}” da biblioteca?`)) return;
        lib.removeSong(s.id);
      });
      del.setAttribute('aria-label', `Excluir ${s.title}`);
      li.append(del);
      list.append(li);
    }
  }

  function addToMenu(song, anchor) {
    document.querySelector('.menu')?.remove();
    const menu = el('div', 'menu');
    const lists = lib.visiblePlaylists;
    if (!lists.length) menu.append(el('div', 'menu-empty', 'Nenhuma playlist ainda.'));
    for (const p of lists) {
      const inIt = p.songIds.includes(song.id);
      const row = btn(`${inIt ? '✓ ' : ''}${p.name}`, 'menu-item' + (inIt ? ' on' : ''), () => {
        if (inIt) lib.removeFromPlaylist(p.id, song.id);
        else lib.addToPlaylist(p.id, song.id);
        menu.remove();
      });
      menu.append(row);
    }
    menu.append(btn('＋ Nova playlist…', 'menu-item', () => {
      const name = prompt('Nome da playlist:', song.genre ? `Meu ${song.genre}` : '');
      if (name?.trim()) {
        const p = lib.addPlaylist(name.trim(), song.genre);
        lib.addToPlaylist(p.id, song.id);
      }
      menu.remove();
    }));
    anchor.closest('li').append(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  // ---------- playlists ----------
  function playlistsView() {
    const wrap = el('div');
    const lists = lib.visiblePlaylists;
    const genres = [...new Set(lists.map((p) => p.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (genres.length) wrap.append(chips(genres, ui.genre, (g) => { ui.genre = g; render(); }));
    const ul = el('ul', 'library');
    const shown = lists.filter((p) => !ui.genre || p.genre === ui.genre);
    if (!shown.length) ul.append(el('li', 'empty', lists.length ? 'Nenhuma playlist neste estilo.' : 'Nenhuma playlist ainda. Crie uma e adicione músicas.'));
    for (const p of shown) {
      const n = lib.playlistSongs(p.id).length;
      const li = el('li');
      const meta = el('div', 'meta');
      meta.append(el('b', '', p.name), el('small', '', [p.genre, `${n} ${n === 1 ? 'música' : 'músicas'}`].filter(Boolean).join(' · ')));
      li.append(meta, btn('Tocar', 'btn primary', () => onPlayPlaylist(p.id)), btn('Editar', 'btn', () => { ui.playlistId = p.id; ui.view = 'playlist'; render(); }));
      const del = btn('🗑', 'btn icon', () => {
        if (confirm(`Excluir a playlist “${p.name}”? As músicas continuam na biblioteca.`)) lib.removePlaylist(p.id);
      });
      del.setAttribute('aria-label', `Excluir playlist ${p.name}`);
      li.append(del);
      ul.append(li);
    }
    wrap.append(ul);
    const act = el('div', 'dlg-actions');
    act.append(btn('Nova playlist', 'btn', () => {
      const name = prompt('Nome da playlist:');
      if (!name?.trim()) return;
      const p = lib.addPlaylist(name.trim(), ui.genre);
      ui.playlistId = p.id;
      ui.view = 'playlist';
      render();
    }));
    wrap.append(act);
    return wrap;
  }

  function playlistEditView() {
    const p = lib.playlist(ui.playlistId);
    if (!p) { ui.view = 'list'; return songsView(); }
    const wrap = el('div');
    wrap.append(header('Editar playlist', true));

    const grid = el('div', 'grid2');
    const name = el('input');
    name.value = p.name;
    name.setAttribute('aria-label', 'Nome da playlist');
    name.addEventListener('change', () => lib.updatePlaylist(p.id, { name: name.value }));
    const genre = el('input');
    genre.value = p.genre;
    genre.placeholder = 'Estilo (opcional)';
    genre.setAttribute('list', 'genre-options');
    genre.setAttribute('aria-label', 'Estilo da playlist');
    genre.addEventListener('change', () => lib.updatePlaylist(p.id, { genre: genre.value }));
    const l1 = el('label', '', 'Nome'); l1.append(name);
    const l2 = el('label', '', 'Estilo'); l2.append(genre);
    grid.append(l1, l2);
    wrap.append(grid);

    wrap.append(el('div', 'sub-head', 'Músicas da playlist (em ordem)'));
    const songs = lib.playlistSongs(p.id);
    const ul = el('ul', 'library');
    if (!songs.length) ul.append(el('li', 'empty', 'Vazia. Adicione músicas abaixo.'));
    songs.forEach((s, i) => {
      const li = el('li');
      const meta = el('div', 'meta');
      meta.append(el('b', '', `${i + 1}. ${s.title || 'Sem título'}`), el('small', '', [s.artist, s.genre].filter(Boolean).join(' · ')));
      const up = btn('↑', 'btn icon', () => lib.moveInPlaylist(p.id, i, i - 1));
      up.disabled = i === 0;
      up.setAttribute('aria-label', 'Subir');
      const down = btn('↓', 'btn icon', () => lib.moveInPlaylist(p.id, i, i + 1));
      down.disabled = i === songs.length - 1;
      down.setAttribute('aria-label', 'Descer');
      const rm = btn('✕', 'btn icon', () => lib.removeFromPlaylist(p.id, s.id));
      rm.setAttribute('aria-label', `Tirar ${s.title} da playlist`);
      li.append(meta, up, down, rm);
      ul.append(li);
    });
    wrap.append(ul);

    wrap.append(el('div', 'sub-head', 'Adicionar músicas'));
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Buscar na biblioteca';
    search.value = ui.addQuery;
    wrap.append(search);
    const cand = el('ul', 'library short');
    const renderCand = () => {
      cand.replaceChildren();
      const options = filterSongs(lib.visibleSongs.filter((s) => !p.songIds.includes(s.id)), { query: ui.addQuery });
      if (!options.length) cand.append(el('li', 'empty', 'Nenhuma música para adicionar.'));
      for (const s of options) {
        const li = el('li');
        const meta = el('div', 'meta');
        meta.append(el('b', '', s.title || 'Sem título'), el('small', '', [s.artist, s.genre].filter(Boolean).join(' · ')));
        li.append(meta, btn('＋ Adicionar', 'btn', () => lib.addToPlaylist(p.id, s.id)));
        cand.append(li);
      }
    };
    search.addEventListener('input', () => { ui.addQuery = search.value; renderCand(); });
    renderCand();
    wrap.append(cand);

    const act = el('div', 'dlg-actions');
    act.append(el('span', 'spacer'), btn('Tocar playlist', 'btn primary', () => onPlayPlaylist(p.id)));
    wrap.append(act);
    return wrap;
  }

  // ---------- código da biblioteca ----------
  function codeView() {
    const wrap = el('div');
    wrap.append(header('Código da biblioteca', true));
    wrap.append(el('p', 'hint', 'Este código identifica a sua biblioteca na nuvem. Para ver as mesmas músicas em outro aparelho, abra o Cifra Sync lá, entre em Biblioteca → Código e cole o código abaixo. Guarde-o como uma senha: quem souber o código consegue ver e alterar as suas músicas.'));
    const code = el('div', 'code', lib.code);
    code.id = 'lib-code';
    wrap.append(code);
    const row = el('div', 'dlg-actions');
    row.append(btn('Copiar código', 'btn', async () => {
      try { await navigator.clipboard.writeText(lib.code); row.querySelector('.copied')?.remove(); row.append(el('span', 'copied hint', 'Copiado!')); } catch { /* sem permissão */ }
    }));
    wrap.append(row);
    wrap.append(el('div', 'sub-head', 'Usar o código de outro aparelho'));
    const input = el('input');
    input.placeholder = 'Cole o código aqui';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.id = 'lib-code-input';
    wrap.append(input);
    const msg = el('p', 'hint');
    wrap.append(msg);
    const go = el('div', 'dlg-actions');
    go.append(btn('Usar este código', 'btn primary', async () => {
      const value = input.value.trim();
      try {
        const merge = confirm('Juntar as músicas deste aparelho com as da biblioteca desse código?\n\nOK = juntar (as daqui são copiadas para lá)\nCancelar = trocar e apagar as músicas deste aparelho');
        lib.useCode(value, { merge });
        ui.view = 'list';
        render();
        await lib.sync();
        onCodeChanged?.();
        render();
      } catch (e) {
        msg.textContent = e.message;
      }
    }));
    wrap.append(go);
    return wrap;
  }

  // ---------- montagem ----------
  function datalist() {
    const dl = el('datalist');
    dl.id = 'genre-options';
    [...new Set([...genresOf(lib.visibleSongs), ...PRESET_GENRES])].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((g) => {
      const o = el('option');
      o.value = g;
      dl.append(o);
    });
    return dl;
  }

  function render() {
    body.replaceChildren();
    if (ui.view === 'playlist') body.append(playlistEditView(), datalist());
    else if (ui.view === 'code') body.append(codeView());
    else {
      body.append(header('Biblioteca'), cloudBar());
      const tabs = el('div', 'tabs');
      tabs.setAttribute('role', 'tablist');
      const mk = (id, label) => {
        const b = btn(label, 'tab' + (ui.tab === id ? ' on' : ''), () => { ui.tab = id; ui.genre = ''; render(); });
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(ui.tab === id));
        tabs.append(b);
      };
      mk('songs', `Músicas (${lib.visibleSongs.length})`);
      mk('playlists', `Playlists (${lib.visiblePlaylists.length})`);
      body.append(tabs, ui.tab === 'songs' ? songsView() : playlistsView());
    }
  }

  /** Chamado quando a biblioteca muda: redesenha sem perder o foco da busca. */
  function refresh() {
    if (!dlg.open) return;
    const status = body.querySelector('#lib-status');
    if (ui.view === 'list' && status && document.activeElement?.classList.contains('search')) {
      status.textContent = statusText();
      if (ui.tab === 'songs') renderSongList();
      return;
    }
    if (ui.view === 'code') {
      return; // não apaga o que está sendo digitado
    }
    render();
  }

  return {
    open(view) {
      if (view) { ui.view = view; }
      render();
      if (!dlg.open) dlg.showModal();
    },
    refresh,
    editPlaylist(id) { ui.playlistId = id; ui.view = 'playlist'; render(); },
  };
}

// Cliente da nuvem (PostgREST do Supabase) sem dependências: só fetch.

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function newUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- linhas ↔ objetos do app ----------

export function songToRow(s, library) {
  return {
    id: s.id,
    library_id: library,
    title: s.title,
    artist: s.artist,
    genre: s.genre,
    text: s.text,
    transpose: s.transpose,
    speed: s.speed,
    simplified: !!s.simplified,
    holds: s.holds,
    timing: s.timing ?? null,
    deleted_at: s.deleted ? new Date().toISOString() : null,
  };
}

export function songFromRow(r) {
  return {
    id: r.id,
    title: r.title ?? '',
    artist: r.artist ?? '',
    genre: r.genre ?? '',
    text: r.text ?? '',
    transpose: Number(r.transpose) || 0,
    speed: Number(r.speed) || 2.5,
    simplified: !!r.simplified,
    holds: r.holds && typeof r.holds === 'object' && !Array.isArray(r.holds) ? r.holds : {},
    timing: r.timing ?? null,
    updatedAt: r.updated_at ?? null,
    dirty: false,
    rev: 0,
    deleted: false,
  };
}

export function playlistToRow(p, library) {
  return {
    id: p.id,
    library_id: library,
    name: p.name,
    genre: p.genre,
    song_ids: p.songIds,
    deleted_at: p.deleted ? new Date().toISOString() : null,
  };
}

export function playlistFromRow(r) {
  return {
    id: r.id,
    name: r.name ?? '',
    genre: r.genre ?? '',
    songIds: Array.isArray(r.song_ids) ? r.song_ids : [],
    updatedAt: r.updated_at ?? null,
    dirty: false,
    rev: 0,
    deleted: false,
  };
}

/**
 * Junta as linhas vindas da nuvem com a lista local.
 *  - item local com alterações pendentes (dirty) vence (será enviado);
 *  - linha apagada na nuvem remove o item;
 *  - linha mais nova que a local substitui; linha nova é adicionada.
 */
export function mergeRemote(items, rows, fromRow) {
  const byId = new Map(items.map((i) => [i.id, i]));
  let changed = false;
  for (const r of rows) {
    const local = byId.get(r.id);
    if (local?.dirty) continue;
    if (r.deleted_at) {
      if (local) {
        byId.delete(r.id);
        changed = true;
      }
      continue;
    }
    if (!local || Date.parse(r.updated_at) > Date.parse(local.updatedAt ?? 0)) {
      byId.set(r.id, fromRow(r));
      changed = true;
    }
  }
  return { items: [...byId.values()], changed };
}

// ---------- HTTP ----------

export class CloudError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class CloudClient {
  constructor({ url, key, fetchImpl } = {}) {
    this.url = url?.replace(/\/$/, '');
    this.key = key;
    this.fetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  }

  get configured() {
    return !!(this.url && this.key);
  }

  async request(path, { method = 'GET', body, prefer, library }) {
    let res;
    try {
      res = await this.fetch(`${this.url}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'x-library-id': library,
          'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudError('Sem conexão com a nuvem.');
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.message ?? '';
      } catch {}
      if (res.status === 404 || /relation .* does not exist|schema cache/i.test(detail)) {
        throw new CloudError('As tabelas ainda não foram criadas no Supabase (rode supabase/schema.sql).', res.status);
      }
      throw new CloudError(detail || `Erro ${res.status} na nuvem.`, res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Linhas da tabela alteradas depois de `since` (ISO) — ou todas. */
  pull(table, library, since) {
    const filter = since ? `&updated_at=gt.${encodeURIComponent(since)}` : '';
    return this.request(`${table}?select=*&order=updated_at.asc${filter}`, { library });
  }

  /** Grava (insere ou atualiza) linhas; devolve as linhas salvas, com updated_at do servidor. */
  async push(table, rows, library) {
    const out = [];
    for (let i = 0; i < rows.length; i += 50) {
      const part = await this.request(`${table}?on_conflict=id`, {
        method: 'POST',
        body: rows.slice(i, i + 50),
        prefer: 'resolution=merge-duplicates,return=representation',
        library,
      });
      out.push(...part);
    }
    return out;
  }
}

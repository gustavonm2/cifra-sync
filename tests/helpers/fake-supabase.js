// Servidor falso que imita o PostgREST + a política de segurança do schema.sql:
// só enxerga/grava linhas do código de biblioteca enviado em x-library-id.
export function fakeSupabase({ failWith = null } = {}) {
  const tables = { songs: new Map(), playlists: new Map() };
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const calls = [];
  const stamp = () => new Date((clock += 1000)).toISOString().replace('Z', '+00:00');
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (failWith) throw new TypeError('offline');
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const lib = init.headers['x-library-id'];
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (!tables[table]) return json(404, { message: 'not found' });
    if (init.method === 'POST') {
      const out = [];
      for (const row of JSON.parse(init.body)) {
        const prev = tables[table].get(row.id);
        if (row.library_id !== lib || (prev && prev.library_id !== lib)) return json(403, { message: 'new row violates row-level security policy' });
        const saved = { ...(prev ?? { created_at: stamp() }), ...row, updated_at: stamp() };
        tables[table].set(row.id, saved);
        out.push(saved);
      }
      return json(201, out);
    }
    const since = u.searchParams.get('updated_at')?.replace(/^gt\./, '');
    const rows = [...tables[table].values()].filter((r) => r.library_id === lib && (!since || Date.parse(r.updated_at) > Date.parse(since)));
    return json(200, rows.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at)));
  };
  return { fetchImpl, tables, calls };
}

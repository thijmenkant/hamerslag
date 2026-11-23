// Een nagebootste Supabase (PostgREST) om de echte database-code (db.js) zonder internet te testen.
// Leest supabase/schema.sql en weigert, net als de echte Supabase:
//  - velden die geen kolom zijn in de tabel
//  - een lijst rijen waarin niet elke rij dezelfde velden heeft (PGRST102)
//  - onbekende tabellen
import { readFileSync } from 'node:fs';

export function leesSchema(pad = new URL('../../supabase/schema.sql', import.meta.url)) {
  const sql = readFileSync(pad, 'utf8').replace(/--[^\n]*/g, '');
  const tabellen = {};
  for (const m of sql.matchAll(/create table if not exists (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const kol = new Set();
    for (const regel of m[2].split(/,(?![^(]*\))/)) {
      const w = regel.trim().split(/\s+/);
      if (!w[0] || /^(primary|unique|constraint|foreign)$/i.test(w[0])) continue;
      // "actie text, asset text" staat soms op één regel
      kol.add(w[0]);
    }
    tabellen[m[1]] = kol;
  }
  for (const m of sql.matchAll(/alter table (\w+) add column if not exists (\w+)/g)) tabellen[m[1]].add(m[2]);
  return tabellen;
}

export function maakNabootsing(base = 'https://nep.supabase.co') {
  const schema = leesSchema();
  const data = Object.fromEntries(Object.keys(schema).map(t => [t, []]));
  const ids = {};
  const sleutel = { traders: 'id', market: 'symbol', headlines: 'url', state: 'id', snapshots: 't' };
  const fout = (status, bericht) => ({ ok: false, status, text: async () => JSON.stringify({ message: bericht }) });
  const ok = (json, status = 200) => ({ ok: true, status, text: async () => (json === null ? '' : JSON.stringify(json)) });
  const filter = (rows, params) => {
    let r = rows.slice();
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      if (v.startsWith('eq.')) r = r.filter(x => String(x[k]) === v.slice(3));
      else if (v.startsWith('in.(')) { const lijst = v.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')); r = r.filter(x => lijst.includes(String(x[k]))); }
    }
    const order = params.get('order');
    if (order) { const [kol, richting] = order.split('.'); r.sort((a, b) => (a[kol] > b[kol] ? 1 : a[kol] < b[kol] ? -1 : 0) * (richting === 'desc' ? -1 : 1)); }
    if (params.get('limit')) r = r.slice(0, Number(params.get('limit')));
    const sel = params.get('select');
    if (sel && sel !== '*') { const kol = sel.split(','); r = r.map(x => Object.fromEntries(kol.map(k => [k, x[k] ?? null]))); }
    return r;
  };
  async function nepFetch(url, opts = {}) {
    if (!String(url).startsWith(base)) throw new Error(`nabootsing: onverwachte url ${url}`);
    const u = new URL(url), tabel = u.pathname.replace('/rest/v1/', ''), params = u.searchParams;
    if (!schema[tabel]) return fout(404, `relation "public.${tabel}" does not exist`);
    const methode = opts.method || 'GET';
    if (methode === 'GET') {
      for (const k of (params.get('select') || '*').split(',')) if (k !== '*' && !schema[tabel].has(k)) return fout(400, `column ${tabel}.${k} does not exist`);
      return ok(filter(data[tabel], params));
    }
    const body = JSON.parse(opts.body || 'null');
    if (methode === 'PATCH') {
      for (const k of Object.keys(body)) if (!schema[tabel].has(k)) return fout(400, `Could not find the '${k}' column of '${tabel}'`);
      for (const r of filter(data[tabel], params)) Object.assign(data[tabel].find(x => x === r) || r, body);
      // filter geeft kopieën terug bij select; zonder select zijn het dezelfde objecten
      return ok(null, 204);
    }
    if (methode === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const eerste = Object.keys(rows[0] || {}).sort().join(',');
      if (rows.some(r => Object.keys(r).sort().join(',') !== eerste)) return fout(400, 'PGRST102: All object keys must match');
      for (const r of rows) for (const k of Object.keys(r)) if (!schema[tabel].has(k)) return fout(400, `PGRST204: Could not find the '${k}' column of '${tabel}' in the schema cache`);
      const uit = [];
      for (const r of rows) {
        const opConflict = params.get('on_conflict');
        const bestaand = opConflict ? data[tabel].find(x => String(x[opConflict]) === String(r[opConflict])) : null;
        if (bestaand) { Object.assign(bestaand, r); uit.push(bestaand); continue; }
        if (!opConflict && sleutel[tabel] && r[sleutel[tabel]] != null && data[tabel].some(x => String(x[sleutel[tabel]]) === String(r[sleutel[tabel]]))) return fout(409, `duplicate key value violates unique constraint "${tabel}_pkey"`);
        const nieuw = { ...r };
        if (schema[tabel].has('id') && nieuw.id == null) nieuw.id = (ids[tabel] = (ids[tabel] || 0) + 1);
        data[tabel].push(nieuw); uit.push(nieuw);
      }
      return ok(uit, 201);
    }
    return fout(405, 'methode niet ondersteund');
  }
  return { fetch: nepFetch, data, schema, base };
}

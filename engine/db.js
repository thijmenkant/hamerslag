// Opslag in Supabase via de REST-API (geen extra pakketten nodig).
// Voor testen is er een geheugen-versie met precies dezelfde functies.

import { env } from './config.js';

export function maakDb() {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_KEY');
  if (env('DRY_RUN') === '1' || !url || !key) return geheugenDb();
  return supabaseDb(url.replace(/\/$/, ''), key);
}

function supabaseDb(base, key) {
  const headers = { apikey: key, ...(String(key).startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), 'content-type': 'application/json' };
  async function req(method, path, body, prefer) {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }
  // Supabase (PostgREST) eist dat alle rijen in één aanvraag precies dezelfde velden hebben.
  // Daarom groeperen we rijen met dezelfde velden en sturen we elke groep apart (volgorde blijft gelijk).
  const groepen = rows => { const g = []; for (const r of rows) { const k = Object.keys(r).sort().join(','); const laatste = g.at(-1); laatste && laatste.k === k ? laatste.rows.push(r) : g.push({ k, rows: [r] }); } return g; };
  const insert = async (tabel, rows) => { const uit = []; for (const g of groepen(rows)) uit.push(...(await req('POST', tabel, g.rows, 'return=representation'))); return uit; };
  // Upsert: dezelfde sleutel twee keer in één batch weigert Postgres ("cannot affect row a second time").
  // Daarom eerst ontdubbelen (de laatste wint); een lege sleutel wordt null (null botst nooit).
  const ontdubbel = (rows, op) => {
    const gezien = new Map(), zonder = [];
    for (const r0 of rows) {
      const r = r0[op] === '' ? { ...r0, [op]: null } : r0;
      if (r[op] == null) zonder.push(r); else gezien.set(String(r[op]), r);
    }
    return [...gezien.values(), ...zonder];
  };
  const upsert = async (tabel, rows, op) => { const uit = []; for (const g of groepen(ontdubbel(rows, op))) uit.push(...(await req('POST', `${tabel}?on_conflict=${op}`, g.rows, 'resolution=merge-duplicates,return=representation'))); return uit; };
  return {
    soort: 'supabase',
    // De hele toestand staat in één jsonb-kolom 'data': zo past elk nieuw veld (kosten, pot, dividend, ...) er altijd in.
    loadState: async () => { const r = (await req('GET', 'state?id=eq.1&select=*'))[0]; if (!r) return null; return r.data ? { ...r.data, id: 1 } : r; },
    saveState: s => { const { id, updated_at, data, ...rest } = s; return upsert('state', [{ id: 1, data: rest, updated_at: new Date().toISOString() }], 'id'); },
    loadTraders: () => req('GET', 'traders?select=*&order=joined_at.asc'),
    // Postgres controleert verplichte velden (naam, rol, ...) vóórdat hij ziet dat de trader al bestaat.
    // Een update met alleen de tellers zou dus mislukken: eerst samenvoegen met de bestaande rij.
    upsertTraders: async rows => {
      if (!rows.length) return [];
      const ids = [...new Set(rows.map(r => r.id))].map(i => `"${String(i).replace(/"/g, '')}"`).join(',');
      const bestaand = new Map((await req('GET', `traders?select=*&id=in.(${encodeURIComponent(ids)})`)).map(r => [r.id, r]));
      return upsert('traders', rows.map(r => ({ ...(bestaand.get(r.id) || {}), ...r })), 'id');
    },
    loadMarket: () => req('GET', 'market?select=*'),
    upsertMarket: rows => upsert('market', rows, 'symbol'),
    recentRounds: n => req('GET', `rounds?select=no,started_at,proposal,outcome,votes_for&status=eq.klaar&order=id.desc&limit=${n}`),
    lastRoundNo: async () => (await req('GET', 'rounds?select=no&order=id.desc&limit=1'))[0]?.no || 0,
    createRound: async row => (await insert('rounds', [row]))[0],
    updateRound: (id, patch) => req('PATCH', `rounds?id=eq.${id}`, patch, 'return=minimal'),
    insertSources: rows => rows.length ? insert('sources', rows) : [],
    insertMessages: rows => rows.length ? insert('messages', rows) : [],
    insertTrade: row => insert('trades', [row]),
    insertSnapshot: row => insert('snapshots', [row]),
    insertHeadlines: rows => rows.length ? upsert('headlines', rows, 'url') : [],
    bekendeUrls: async urls => { if (!urls.length) return new Set(); const lijst = urls.map(u => `"${u.replace(/"/g, '')}"`).join(','); return new Set((await req('GET', `headlines?select=url&url=in.(${encodeURIComponent(lijst)})`)).map(r => r.url)); },
    laatsteRondes: () => req('GET', 'rounds?select=id,started_at,spoed,status&order=id.desc&limit=30'),
    insertVoorzitting: row => insert('voorzittingen', [row]),
    zetLive: data => upsert('live', [{ id: 1, data, updated_at: new Date().toISOString() }], 'id'),
    wachtendeVragen: () => req('GET', 'verzoeken?select=*&status=eq.wacht&order=id.asc&limit=5'),
    vragenGestartSinds: async t => (await req('GET', `verzoeken?select=id,uitkomst&status=in.(gestart,klaar)&behandeld_at=gte.${encodeURIComponent(t)}`)).filter(v => v.uitkomst !== 'GEEN VOORSTEL').length,   // mislukte of lege zittingen tellen niet mee
    updateVraag: (id, patch) => req('PATCH', `verzoeken?id=eq.${id}`, patch, 'return=minimal'),
  };
}

export function geheugenDb() {
  const d = { state: null, traders: [], market: [], rounds: [], sources: [], messages: [], trades: [], snapshots: [], headlines: [], voorzittingen: [], verzoeken: [], live: null, liveLog: [] };
  let rid = 0;
  return {
    soort: 'geheugen', data: d,
    loadState: async () => d.state && structuredClone(d.state),
    saveState: async s => { d.state = structuredClone(s); },
    loadTraders: async () => structuredClone(d.traders),
    upsertTraders: async rows => { for (const r of rows) { const i = d.traders.findIndex(t => t.id === r.id); i >= 0 ? (d.traders[i] = { ...d.traders[i], ...r }) : d.traders.push({ joined_at: new Date().toISOString(), active: true, ...r }); } },
    loadMarket: async () => structuredClone(d.market),
    upsertMarket: async rows => { for (const r of rows) { const i = d.market.findIndex(m => m.symbol === r.symbol); i >= 0 ? (d.market[i] = r) : d.market.push(r); } },
    recentRounds: async n => d.rounds.filter(r => r.status === 'klaar').slice(-n).reverse(),
    lastRoundNo: async () => d.rounds.at(-1)?.no || 0,
    createRound: async row => { const r = { id: ++rid, ...row }; d.rounds.push(r); return r; },
    updateRound: async (id, patch) => { Object.assign(d.rounds.find(r => r.id === id), patch); },
    insertSources: async rows => { d.sources.push(...rows); },
    insertMessages: async rows => { d.messages.push(...rows); },
    insertTrade: async row => { d.trades.push(row); },
    insertSnapshot: async row => { d.snapshots.push(row); },
    insertHeadlines: async rows => { d.headlines.push(...rows); },
    bekendeUrls: async urls => new Set(d.headlines.map(h => h.url).filter(u => urls.includes(u))),
    laatsteRondes: async () => d.rounds.slice(-30).reverse(),
    insertVoorzitting: async row => { d.voorzittingen.push(row); },
    zetLive: async data => { d.live = data && structuredClone(data); d.liveLog.push(data && (data.fase + (data.bronnenKlaar ? '+bronnen' : ''))); },
    wachtendeVragen: async () => d.verzoeken.filter(v => v.status === 'wacht').sort((a, b) => a.id - b.id),
    vragenGestartSinds: async t => d.verzoeken.filter(v => ['gestart', 'klaar'].includes(v.status) && v.uitkomst !== 'GEEN VOORSTEL' && v.behandeld_at >= t).length,
    updateVraag: async (id, patch) => { Object.assign(d.verzoeken.find(v => v.id === id), patch); },
  };
}

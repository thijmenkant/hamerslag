// Haalt de data op: uit Supabase (live) of uit demo.js (demo-modus).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isLive = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;

export async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sb;
}

export async function session() {
  if (!isLive()) return { demo: true };
  const c = await client();
  const { data } = await c.auth.getSession();
  return data.session;
}

export async function login(email, password) {
  const c = await client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logout() { if (sb) await sb.auth.signOut(); }

export async function laad() {
  if (!isLive()) {
    const d = await import('./demo.js');
    return {
      demo: true, traders: d.DEMO_TRADERS, market: d.DEMO_MARKET, state: d.DEMO_STATE, snapshots: d.DEMO_SNAPSHOTS,
      trades: d.DEMO_TRADES.slice().reverse(), headlines: d.DEMO_HEADLINES, round: d.DEMO_ROUND, besluit: d.DEMO_ROUND, rondes: [{ id: 14, ...d.DEMO_ROUND }], vragen: demoVragen, live: { fase: 'zitting', spoed: true, t: new Date().toISOString(), bronnenKlaar: true, onderwerp: d.DEMO_ROUND.spoed?.titel, stappen: [['Wisselkoers', 'ECB via Frankfurter', '$1 = €0,93'], ['Cryptokoersen', 'CoinGecko, gecontroleerd met Bitvavo', '41 munten'], ["Aandelen en ETF's", 'Finnhub (FMP als reserve)', '86 koersen'], ['Nieuws', 'Finnhub, NOS, CoinDesk, ECB, Fed', '20 berichten'], ['Stemming op de markt', 'Fear & Greed', '32/100'], ['Bedrijfsnieuws', 'Finnhub', '7 berichten'], ['Officiële meldingen', 'SEC EDGAR', '2 meldingen'], ['Rente en inflatie', 'FRED', '7 cijfers'], ['Cijferkalender', 'Finnhub', '12 deze week']].map(([naam, bron, aantal], i) => ({ id: 's' + i, naam, bron, aantal, status: 'ok' })) },
      messages: d.DEMO_MESSAGES, sources: d.DEMO_SOURCES, voorzittingen: d.DEMO_VOORZITTINGEN,
    };
  }
  const c = await client();
  const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
  const sinds = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [traders, market, state, snapshots, trades, headlines, rounds, voorzittingen, vragen, live] = await Promise.all([
    q(c.from('traders').select('*').order('joined_at')),
    q(c.from('market').select('*')),
    q(c.from('state').select('*').eq('id', 1).maybeSingle()).then(r => r?.data ? { ...r.data, id: 1 } : r),
    q(c.from('snapshots').select('t,value,bench,cash').order('t', { ascending: false }).limit(2000)),
    q(c.from('trades').select('*').order('t', { ascending: false }).limit(50)),
    q(c.from('headlines').select('*').gte('published_at', sinds).order('importance', { ascending: false }).order('published_at', { ascending: false }).limit(20)),
    q(c.from('rounds').select('*').order('id', { ascending: false }).limit(30)),
    q(c.from('voorzittingen').select('*').order('id', { ascending: false }).limit(48)),
    laadVragen().catch(() => []),
    c.from('live').select('data').eq('id', 1).maybeSingle().then(r => r.data?.data || null, () => null),
  ]);
  // Laatste afgeronde of lopende ronde
  // 'bezig' telt alleen als hij nog vers is: een zitting die ooit halverwege stopte blijft anders eeuwig 'live'
  const vers = r => r.status === 'bezig' && Date.now() - new Date(r.started_at) < 30 * 60000;
  const round = rounds.find(vers) || rounds.find(r => r.status === 'klaar') || rounds[0] || null;
  let messages = [], sources = {};
  if (round) {
    const [m, s] = await Promise.all([
      q(c.from('messages').select('*').eq('round_id', round.id).order('seq')),
      q(c.from('sources').select('*').eq('round_id', round.id)),
    ]);
    messages = m; sources = Object.fromEntries(s.map(x => [x.id, x]));
  }
  return { demo: false, traders, market, state, snapshots: snapshots.reverse(), trades, headlines, round, laatste: rounds[0] || null, besluit: rounds.find(r => r.status === 'klaar') || null, rondes: rounds, voorzittingen, vragen, live, messages, sources };
}

// Live updates: nieuwe berichten, rondes en koersen
export async function abonneer({ onMessage, onRound, onMarket }) {
  if (!isLive()) return () => {};
  const c = await client();
  const ch = c.channel('parlement')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onMessage?.(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, p => onRound?.(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'market' }, p => onMarket?.(p.new))
    .subscribe();
  return () => c.removeChannel(ch);
}

export async function bronnenVoorRonde(roundId) {
  const c = await client();
  const { data } = await c.from('sources').select('*').eq('round_id', roundId);
  return Object.fromEntries((data || []).map(x => [x.id, x]));
}

// Een oudere zitting terugkijken: alle berichten en bronnen van die ene ronde
export async function laadRonde(id) {
  if (!isLive()) { const d = await import('./demo.js'); return { messages: d.DEMO_MESSAGES, sources: d.DEMO_SOURCES }; }
  const c = await client();
  const [m, s] = await Promise.all([
    c.from('messages').select('*').eq('round_id', id).order('seq'),
    c.from('sources').select('*').eq('round_id', id),
  ]);
  if (m.error) throw m.error;
  return { messages: m.data || [], sources: Object.fromEntries((s.data || []).map(x => [x.id, x])) };
}

// Vragen aan de zaal: de app zet ze klaar, de motor pakt ze binnen 5 minuten op
const demoVragen = [];
export async function stelVraag(vraag) {
  if (!isLive()) { demoVragen.unshift({ id: Date.now(), t: new Date().toISOString(), vraag, status: 'wacht' }); return; }
  const c = await client();
  const { error } = await c.from('verzoeken').insert({ vraag });
  if (error) throw error;
}
export async function laadVragen() {
  if (!isLive()) return demoVragen;
  const c = await client();
  const { data, error } = await c.from('verzoeken').select('*').order('id', { ascending: false }).limit(10);
  if (error) throw error;
  return data || [];
}

// Elke 30 seconden: wat doet de motor nu (uurcheck, voorzitting), en is er een nieuwe voorzitting?
let laatsteVz = null;
export async function laadNu() {
  if (!isLive()) return null;
  const c = await client();
  const [li, vz, vr] = await Promise.all([
    c.from('live').select('data').eq('id', 1).maybeSingle(),
    c.from('voorzittingen').select('*').order('id', { ascending: false }).limit(48),
    c.from('verzoeken').select('*').order('id', { ascending: false }).limit(10),
  ]);
  const nieuweCheck = laatsteVz !== null && vz.data?.[0]?.id !== laatsteVz;
  laatsteVz = vz.data?.[0]?.id ?? null;
  return { live: li.data?.data || null, voorzittingen: vz.data || [], vragen: vr.data || [], nieuweCheck };
}

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
      trades: d.DEMO_TRADES.slice().reverse(), headlines: d.DEMO_HEADLINES, round: d.DEMO_ROUND, besluit: d.DEMO_ROUND,
      messages: d.DEMO_MESSAGES, sources: d.DEMO_SOURCES, voorzittingen: d.DEMO_VOORZITTINGEN,
    };
  }
  const c = await client();
  const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
  const sinds = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [traders, market, state, snapshots, trades, headlines, rounds, voorzittingen] = await Promise.all([
    q(c.from('traders').select('*').order('joined_at')),
    q(c.from('market').select('*')),
    q(c.from('state').select('*').eq('id', 1).maybeSingle()).then(r => r?.data ? { ...r.data, id: 1 } : r),
    q(c.from('snapshots').select('t,value,bench,cash').order('t', { ascending: false }).limit(2000)),
    q(c.from('trades').select('*').order('t', { ascending: false }).limit(50)),
    q(c.from('headlines').select('*').gte('published_at', sinds).order('importance', { ascending: false }).order('published_at', { ascending: false }).limit(20)),
    q(c.from('rounds').select('*').order('id', { ascending: false }).limit(2)),
    q(c.from('voorzittingen').select('*').order('id', { ascending: false }).limit(12)),
  ]);
  // Laatste afgeronde of lopende ronde
  const round = rounds.find(r => r.status === 'bezig') || rounds.find(r => r.status === 'klaar') || rounds[0] || null;
  let messages = [], sources = {};
  if (round) {
    const [m, s] = await Promise.all([
      q(c.from('messages').select('*').eq('round_id', round.id).order('seq')),
      q(c.from('sources').select('*').eq('round_id', round.id)),
    ]);
    messages = m; sources = Object.fromEntries(s.map(x => [x.id, x]));
  }
  return { demo: false, traders, market, state, snapshots: snapshots.reverse(), trades, headlines, round, laatste: rounds[0] || null, besluit: rounds.find(r => r.status === 'klaar') || null, voorzittingen, messages, sources };
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

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
      trades: d.DEMO_TRADES.slice().reverse(), headlines: d.DEMO_HEADLINES, round: d.DEMO_ROUND, besluit: d.DEMO_ROUND, rondes: [{ id: 14, ...d.DEMO_ROUND }], vragen: demoVragen, ...demoVoorspel(), live: { fase: 'zitting', spoed: true, t: new Date().toISOString(), bronnenKlaar: true, onderwerp: d.DEMO_ROUND.spoed?.titel, stappen: [['Wisselkoers', 'ECB via Frankfurter', '$1 = €0,93'], ['Cryptokoersen', 'CoinGecko, gecontroleerd met Bitvavo', '41 munten'], ["Aandelen en ETF's", 'Finnhub (FMP als reserve)', '86 koersen'], ['Nieuws', 'Finnhub, NOS, CoinDesk, ECB, Fed', '20 berichten'], ['Stemming op de markt', 'Fear & Greed', '32/100'], ['Bedrijfsnieuws', 'Finnhub', '7 berichten'], ['Officiële meldingen', 'SEC EDGAR', '2 meldingen'], ['Rente en inflatie', 'FRED', '7 cijfers'], ['Cijferkalender', 'Finnhub', '12 deze week']].map(([naam, bron, aantal], i) => ({ id: 's' + i, naam, bron, aantal, status: 'ok' })) },
      messages: d.DEMO_MESSAGES, sources: d.DEMO_SOURCES, voorzittingen: d.DEMO_VOORZITTINGEN,
    };
  }
  const c = await client();
  const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
  const sinds = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [traders, market, state, snapshots, trades, headlines, rounds, voorzittingen, vragen, live, dagen, voorspellingen] = await Promise.all([
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
    c.from('dagvoorspelling').select('*').order('datum', { ascending: false }).limit(14).then(r => r.data || [], () => []),
    c.from('voorspellingen').select('*').order('id', { ascending: false }).limit(150).then(r => r.data || [], () => []),
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
  return { demo: false, traders, market, state, snapshots: snapshots.reverse(), trades, headlines, round, laatste: rounds[0] || null, besluit: rounds.find(r => r.status === 'klaar') || null, rondes: rounds, voorzittingen, vragen, live, dagen, voorspellingen, messages, sources };
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

// Meldingen: dit apparaat aan- of afmelden
export async function bewaarAbonnement(a) {
  if (!isLive()) return;
  const c = await client();
  const { error } = await c.from('push_abonnementen').insert(a);
  if (error && error.code !== '23505') throw error;   // 23505 = dit apparaat stond er al
}
export async function verwijderAbonnement(endpoint) {
  if (!isLive()) return;
  const c = await client();
  await c.from('push_abonnementen').delete().eq('endpoint', endpoint);
}

// Voorbeelddata voor de tab Voorspel (alleen in de demo)
function demoVoorspel() {
  const vandaag = new Date(Date.now() + 3600e3).toISOString().slice(0, 10), gisteren = new Date(Date.now() - 864e5 + 3600e3).toISOString().slice(0, 10);
  const over = d => { const x = new Date(Date.now() + d * 864e5); x.setUTCHours(21, 0, 0, 0); return x.toISOString(); };
  return {
    dagen: [{ datum: vandaag, t: new Date().toISOString(), stemming: 'Voorzichtig positief: de beurs herstelt van de schrik van vorige week, maar beleggers wachten op het inflatiecijfer van vrijdag.',
      themas: [
        { onderwerp: 'Onrust Midden-Oosten', keten: ['Spanning rond Straat van Hormuz', 'Minder olie-aanvoer', 'Olie duurder', 'Oliebedrijven en goud omhoog'], winnaars: ['USO', 'XLE', 'GLD'], verliezers: ['SPY'], ingeprijsd: 'Nog niet: olie is deze week pas 1% gestegen.', tegen: 'Als er snel een bestand komt, zakt olie meteen terug.', effect: 'Olie en goud kunnen stijgen, de brede beurs krijgt het lastiger.' },
        { onderwerp: 'Hogere importheffingen VS', keten: ['VS verhoogt heffingen op China', 'Spullen worden duurder', 'Inflatie blijft hoger', 'Fed wacht met renteverlaging'], winnaars: ['GLD'], verliezers: ['QQQ', 'AAPL', 'TLT'], ingeprijsd: 'Deels: techaandelen zakten gisteren al 2%.', tegen: 'Een snelle deal met China draait dit om.', effect: 'Slecht voor techaandelen en obligaties.' },
        { onderwerp: 'Nieuwe CEO bij een chipmaker', keten: ['Oude CEO vertrekt', 'Beleggers hopen op nieuwe koers', 'Meer vertrouwen', 'Aandeel trekt aan'], winnaars: ['NVDA'], verliezers: [], ingeprijsd: 'Grotendeels: de koers sprong gisteren al 6%.', tegen: 'Als de nieuwe CEO tegenvalt bij zijn eerste plannen.', effect: 'Vooral al in de koers verwerkt; weinig ruimte meer.' }],
      vooruit: [
        { gebeurtenis: 'Rentebesluit van de Fed', datum: '2026-12-09', soort: 'agenda', verwachting: 'De markt rekent er voor 70% op dat de rente gelijk blijft.', wedmarkt: 'Fed verlaagt de rente in december: 30% kans', vooraf: 'Beleggers wachten af; Bitcoin en techaandelen bewegen weinig tot het besluit.',
          scenarios: [{ als: 'Rente blijft gelijk', kans: 70, keten: ['Zoals verwacht', 'Weinig verrassing', 'Kleine daling bij crypto'], winnaars: [], verliezers: ['BTC'] }, { als: 'Rente gaat omlaag', kans: 30, keten: ['Verrassing', 'Lenen wordt goedkoper', 'Crypto en tech omhoog'], winnaars: ['BTC', 'QQQ'], verliezers: [] }] },
        { gebeurtenis: 'Deadline voor nieuwe heffingen op China', datum: null, soort: 'signaal', verwachting: 'Steeds meer berichten dat de VS de heffingen echt invoert.', vooraf: 'Chipmakers zakken al licht; goud wordt meer gekocht.',
          scenarios: [{ als: 'Heffingen gaan door', kans: 60, keten: ['Duurdere import', 'Inflatie hoger', 'Tech omlaag, goud omhoog'], winnaars: ['GLD'], verliezers: ['QQQ', 'NVDA'] }, { als: 'Op het laatste moment een deal', kans: 40, keten: ['Opluchting', 'Minder onzekerheid', 'Tech veert op'], winnaars: ['QQQ', 'NVDA'], verliezers: [] }] }],
      agenda: [{ datum: '2026-11-26', tekst: 'Amerikaanse beurs dicht (Thanksgiving)', vast: true }, { datum: '2026-11-27', tekst: 'Amerikaanse beurs eerder dicht, om 19:00', vast: true }, { datum: '2026-11-27', tekst: 'Inflatiecijfer VS: valt het mee, dan stijgt de kans op een renteverlaging' }] }],
    voorspellingen: [
      { id: 6, datum: vandaag, asset: 'SPY', naam: 'S&P 500', richting: 'OP', kans: 62, basiskans: 57, tot: over(2), startprijs: 612, reden: 'De angst op de beurs zakt al drie dagen en in een feestdagenweek is het meestal rustig. Een tegenvallend inflatiecijfer kan dit nog omgooien.', bronnen: ['Angstmeter', 'Agenda'] },
      { id: 5, datum: vandaag, asset: 'USO', naam: 'Olie', richting: 'OP', kans: 58, basiskans: 51, tot: over(5), startprijs: 71.2, reden: 'De onrust in het Midden-Oosten kan de olieaanvoer raken. Als het rustig blijft, zakt dit effect weer weg.', bronnen: ['Nieuws'], thema: 'Onrust Midden-Oosten', keten: ['Spanning rond Straat van Hormuz', 'Minder olie-aanvoer', 'Olie duurder', 'Oliebedrijven en goud omhoog'] },
      { id: 4, datum: vandaag, asset: 'BTC', naam: 'Bitcoin', richting: 'NEER', kans: 55, basiskans: 47, vooruit: true, thema: 'Vooruit: Rentebesluit van de Fed', keten: ['Zoals verwacht', 'Weinig verrassing', 'Kleine daling bij crypto'], tot: over(7), startprijs: 51200, reden: 'Er stroomt nog steeds geld weg uit Bitcoin-fondsen. 55% is maar net iets beter dan kop of munt.', bronnen: ['Nieuws', 'Fear & Greed'] },
      { id: 3, datum: gisteren, asset: 'GLD', naam: 'Goud', richting: 'OP', kans: 60, basiskans: 58, tot: over(-0.2), startprijs: 245, uitkomst: 'goed', eindprijs: 248.1, verandering: 0.0127, reden: 'Onrust in de wereld maakt goud gewild.', bronnen: ['Thema'] },
      { id: 2, datum: gisteren, asset: 'TSLA', naam: 'Tesla', richting: 'NEER', kans: 57, basiskans: 46, tot: over(-0.2), startprijs: 310, uitkomst: 'fout', eindprijs: 316, verandering: 0.019, reden: 'Onzekerheid over Europese subsidies.', bronnen: ['Nieuws'] },
      { id: 1, datum: gisteren, asset: 'ETH', naam: 'Ethereum', richting: 'GELIJK', kans: 55, basiskans: 41, tot: over(-0.2), startprijs: 2900, uitkomst: 'goed', eindprijs: 2933, verandering: 0.011, reden: 'Geen grote gebeurtenis op de agenda.', bronnen: ['Agenda'] },
    ],
  };
}

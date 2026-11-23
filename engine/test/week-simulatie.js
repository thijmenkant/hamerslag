// Weeksimulatie: 7 dagen elk uur de uurcheck, met een nagebootste markt en een nagebootste AI.
// Doel: vinden wat er na dagen draaien misgaat, en een schatting van de AI-kosten per week.
//   node test/week-simulatie.js [dagen]

import assert from 'node:assert/strict';
import { zittingscheck } from '../zittingscheck.js';
import { geheugenDb, maakDb } from '../db.js';
import { maakNabootsing } from './supabase-nabootsing.js';
import { ronde } from '../run.js';
import { ASSETS, AANDELEN, ETFS, prijsVan, CONFIG } from '../config.js';
import { waarde, benchWaarde } from '../portfolio.js';

const DAGEN = Number(process.argv[2] || 7);
let zaad = 42; const rnd = () => (zaad = (zaad * 16807) % 2147483647) / 2147483647;
const normaal = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const kies = a => a[Math.floor(rnd() * a.length)];

// ---------- nagebootste markt ----------
const σ = { crypto: 0.012, aandeel: 0.006, index: 0.004, sector: 0.005, thema: 0.008, crypto_etf: 0.011, grondstof: 0.005, obligatie: 0.0015, vastgoed: 0.004, europa: 0.004 };
const markt = new Map();
for (const a of [...ASSETS.filter(a => a.soort === 'crypto'), ...AANDELEN, ...ETFS]) markt.set(a.sym, { a, prijs: a.soort === 'crypto' ? (a.sym === 'BTC' ? 56000 : 50 + rnd() * 2000) : 20 + rnd() * 500, start24: null, hist: [] });
const isOpen = t => { const d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes(); return d > 0 && d < 6 && m >= 870 && m <= 1255; };
function stap(t) {
  const schok = rnd() < 0.01 ? (rnd() < 0.5 ? -1 : 1) * (0.04 + rnd() * 0.05) : 0;   // soms een flinke klap
  for (const [s, m] of markt) {
    const crypto = m.a.soort === 'crypto';
    if (!crypto && !isOpen(t)) { m.hist.push(m.prijs); continue; }
    const vol = crypto ? σ.crypto : σ[m.a.cat] || σ.aandeel;
    m.prijs *= Math.exp(vol * normaal() + (crypto || m.a.cat === 'index' ? schok * (crypto ? 1.5 : 0.5) : 0));
    m.hist.push(m.prijs);
  }
}
const koersen = t => [...markt].map(([sym, m]) => {
  const h = m.hist, ch = n => h.length > n ? m.prijs / h[h.length - 1 - n] - 1 : 0;
  return { sym, naam: m.a.naam, soort: m.a.soort, rank: m.a.rank, prijs: m.prijs, chg1h: ch(1), chg24h: ch(24), chg7d: ch(168), tijd: t.toISOString(), bron: m.a.soort === 'crypto' ? 'CoinGecko' : 'Finnhub', url: 'https://example.test/' + sym };
});
let nieuwsTeller = 0;
const nieuwsNu = t => rnd() < 0.15 ? [{ titel: `Test-nieuws ${++nieuwsTeller} over ${kies(['Bitcoin', 'Nvidia', 'goud', 'de Fed'])}`, samenvatting: '', uitgever: kies(['Reuters', 'NOS', 'CoinDesk']), url: `https://nieuws.test/${nieuwsTeller}`, tijd: t.toISOString(), categorie: 'markt', belang: kies([1, 2, 3]), assets: [kies(['BTC', 'NVDA', 'GLD', 'MARKT', 'ETH'])] }] : [];

// ---------- nagebootste AI met kostenschatting ----------
const gezienVast = new Set();
const llm = {
  verbruik: { calls: 0, input: 0, output: 0, usd: 0 },
  perModel: {},
  async vraagJson(prompt, { vastDeel = null, model = CONFIG.model } = {}) {
    const antwoord = antwoordOp(prompt);
    const p = prijsVan(model), tok = s => Math.ceil(String(s).length / 3.6);
    let usd = tok(prompt) * p.in + tok(JSON.stringify(antwoord)) * 4 * p.uit;   // uitvoer ± 4x zo lang als dit nep-antwoord
    if (vastDeel) { const key = model + vastDeel.length; usd += tok(vastDeel) * (gezienVast.has(key) ? p.lees : p.schrijf); gezienVast.add(key); }
    usd /= 1e6;
    this.verbruik.calls++; this.verbruik.usd += usd;
    const m = (this.perModel[model] ||= { calls: 0, usd: 0 }); m.calls++; m.usd += usd;
    return antwoord;
  },
};
const traders = ['daan', 'sven', 'lisa', 'mark', 'yara', 'ruben', 'femke', 'joost', 'noor', 'sanne'];
function antwoordOp(prompt) {
  const radar = (prompt.match(/een van ([A-Z0-9., ]+) \(de radar/) || [])[1]?.split(', ').map(s => s.trim()) || ['BTC'];
  const bron = (prompt.match(/\[(B\d+)\]/) || [])[1] || 'B1';
  if (prompt.includes('TAAK 1')) return { voorstellen: traders.map(id => {
    const doe = rnd() < 0.45, actie = rnd() < 0.8 ? 'KOOP' : 'VERKOOP';
    return doe ? { id, actie, asset: kies(radar), bedrag: Math.round(20 + rnd() * 130), overtuiging: 1 + Math.floor(rnd() * 10), uitleg: 'Testvoorstel.', bronnen: [bron] } : { id, actie: 'NIKS', asset: '', bedrag: 0, overtuiging: 5, uitleg: 'Afwachten.', bronnen: [bron] };
  }) };
  if (prompt.includes('TAAK VOORZITTER')) return { tekst: 'De voorzitter spreekt.', woord: [kies(traders)], emotie: 'zeker', bronnen: [] };
  if (prompt.includes('TAAK 2')) { const n = 3 + Math.floor(rnd() * 2); let vorige = ''; return { beurten: Array.from({ length: n }, () => { let id; do id = kies(traders); while (id === vorige); vorige = id; return { id, tekst: 'Ik vind dit een redelijk idee, maar let op het risico.', bronnen: [bron], emotie: kies(['zeker', 'bezorgd', 'blij']) }; }) }; }
  if (prompt.includes('TAAK CONTROLE')) { const n = (prompt.split('DE UITSPRAKEN:')[1] || '').split('\n').filter(x => /^\d+\./.test(x)).length; return { oordeel: Array.from({ length: n }, (_, i) => ({ nr: i + 1, klopt: rnd() > 0.05 })) }; }
  if (prompt.includes('GEHEIME STEMMING')) { const voor = rnd() < 0.6; return { stem: voor ? 'VOOR' : 'TEGEN', reden: 'Op basis van het debat.', bedrag: voor ? Math.round(30 + rnd() * 120) : 0, bronnen: [bron] }; }
  if (prompt.includes('VOORZITTING')) { const v = [...prompt.matchAll(/\[(V\d+)\][^\n]*?\(([A-Z0-9.]+), /g)]; return v.length ? { kansen: [{ asset: v[0][2], richting: 'KOOP', score: 3 + Math.floor(rnd() * 6), waarom: 'Test.', bronnen: [v[0][1]] }], besluit: 'ZITTING', reden: 'Test.' } : { kansen: [], besluit: 'GEEN_ZITTING', reden: 'Niets.' }; }
  if (prompt.includes('zoekt een nieuwe trader')) return { name: 'Kees', role: 'Swingtrader', style: 'Test.', look: 'short', glasses: false, beard: false };
  throw new Error('onbekende prompt: ' + prompt.slice(0, 80));
}

// ---------- draaien ----------
// Met NABOOTSING=1 draait alles via de echte database-code (db.js) tegen een nagebootste Supabase
const nb = process.env.NABOOTSING === '1' ? maakNabootsing() : null;
if (nb) { globalThis.fetch = nb.fetch; process.env.SUPABASE_URL = nb.base; process.env.SUPABASE_SERVICE_KEY = 'nep'; }
const db = nb ? maakDb() : geheugenDb();
const dataVan = () => nb ? { ...nb.data, state: nb.data.state[0]?.data } : db.data;
if (nb) console.log('Database: nagebootste Supabase (echte db.js-code)');
let t = new Date('2026-11-30T00:07:00Z');                       // maandag, vlak voor een maandwissel (1 dec)
const bronnen = async () => ({ usdEur: { koers: 0.93 }, koersen: koersen(t), nieuws: nieuwsNu(t), fng: { waarde: 40, label: 'Fear', gisteren: 38, tijd: t.toISOString() }, fouten: [] });
const meldingen = [];
const push = async m => { meldingen.push(m.titel); return true; };
const start = o => ronde({ ...o, bronnen, llm, beurtPauze: 0, push, dividendData: async () => ({}) });
const telling = { RUSTIG: 0, GEEN_ZITTING: 0, ZITTING: 0, fouten: 0 };
const maandVan = x => x.toISOString().slice(0, 7);
let usdBeginMaand = 0;
for (let uur = 0; uur < DAGEN * 24; uur++) {
  stap(t);
  if (uur && maandVan(t) !== maandVan(new Date(+t - 3600000))) usdBeginMaand = llm.verbruik.usd;
  try {
    const r = await zittingscheck({ db, koersen: async () => koersen(t), nieuws: async () => nieuwsNu(t), start, llm, nu: t, forceer: false });
    const v = dataVan().voorzittingen.at(-1); if (v && v.t === t.toISOString()) telling[v.besluit]++;
    if (r.uitslag && !r.uitslag.uitkomst && !r.uitslag.nep) throw new Error('zitting zonder uitkomst');
  } catch (e) { telling.fouten++; console.error(`❌ ${t.toISOString()}: ${e.stack}`); if (telling.fouten > 3) process.exit(1); }
  t = new Date(+t + 3600000);
}

// ---------- verslag ----------
const d = dataVan(), prijzen = Object.fromEntries([...markt].map(([s, m]) => [s, m.prijs]));
const rondes = d.rounds, uitkomsten = rondes.reduce((a, r) => (a[r.outcome || r.status] = (a[r.outcome || r.status] || 0) + 1, a), {});
const eurWeek = llm.verbruik.usd * 0.93 * 7 / DAGEN;
console.log(`\nWeeksimulatie (${DAGEN} dagen)`);
console.log(`Uurchecks: ${DAGEN * 24} · rustig ${telling.RUSTIG} · voorzitting zonder zitting ${telling.GEEN_ZITTING} · zitting ${telling.ZITTING}`);
console.log(`Zittingen: ${rondes.length} → ${JSON.stringify(uitkomsten)} · trades ${d.trades.length}`);
console.log(`Portefeuille €${waarde(d.state, prijzen).toFixed(2)} (cash €${d.state.cash.toFixed(2)}, pot €${(d.state.pot || 0).toFixed(2)}), kopen & vasthouden €${benchWaarde(d.state, prijzen).toFixed(2)}`);
console.log(`AI-aanroepen: ${llm.verbruik.calls} · geschatte kosten ≈ €${eurWeek.toFixed(2)} per week (≈ €${(eurWeek * 4.35).toFixed(2)} per maand)`);
for (const [m, x] of Object.entries(llm.perModel)) console.log(`   ${m.padEnd(20)} ${String(x.calls).padStart(5)} aanroepen · €${(x.usd * 0.93 * 7 / DAGEN).toFixed(2)} per week`);
console.log(`Kostenmeter in de app: €${d.state.kosten?.eur?.toFixed(2)} · meldingen: ${meldingen.length} (${[...new Set(meldingen.map(m => m.split(':')[0]))].join(', ')})`);
console.log(`Maandwissel: ${d.state.last_rotation} · berichten in de database: ${d.messages.length}`);

assert.equal(telling.fouten, 0, 'geen fouten tijdens de week');
assert.equal(d.traders.filter(x => x.active !== false).length, 10, 'altijd precies 10 traders, ook na een maandwissel');
assert.ok(rondes.every(r => r.status === 'klaar'), 'elke zitting is netjes afgerond');
assert.ok(Object.values(d.state.positions).every(p => p.qty > 0 && isFinite(p.qty) && isFinite(p.cost)), 'geen kapotte posities');
assert.ok(d.state.cash >= -0.01, 'nooit negatieve cash');
const totaal = waarde(d.state, prijzen);
for (const [s, p] of Object.entries(d.state.positions)) assert.ok(p.qty * prijzen[s] <= totaal * 0.35, `${s} niet ver boven de 25%-regel (koersstijging mag)`);
assert.equal(d.state.kosten.maand, maandVan(t), 'kostenmeter telt per maand');
assert.ok(Math.abs(d.state.kosten.eur - (llm.verbruik.usd - usdBeginMaand) * 0.93) < 0.05, `kostenmeter klopt met het echte verbruik deze maand (${d.state.kosten.eur} vs ${((llm.verbruik.usd - usdBeginMaand) * 0.93).toFixed(2)})`);
assert.equal(d.state.last_rotation, maandVan(t), 'maandwissel gebeurt op de 1e');
if (nb && process.env.DUMP) { (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(nb.data)); console.log('Database weggeschreven naar', process.env.DUMP); }
console.log('\n✅ Een week draaien zonder fouten.');

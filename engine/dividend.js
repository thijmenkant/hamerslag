import { meld } from './bronstatus.js';
// Dividend en staking: extra opbrengsten naast koerswinst.
//
// Dividend
//  - Exact via Financial Modeling Prep (gratis plan: ± 87 grote Amerikaanse namen).
//  - Voor de rest een schatting op basis van het dividendrendement (Finnhub).
//  - Wie op de ex-dividenddatum het aandeel bezit, krijgt op de betaaldatum dividend.
//  - Na 15% dividendbelasting gaat het in de aparte DIVIDENDPOT, niet in de kas.
//  - Kopen & vasthouden krijgt ook dividend, anders is de vergelijking oneerlijk.
// Staking
//  - Crypto in bezit groeit met een geschatte netto rente (zie STAKING in config.js).

import { CONFIG, SYMS, STAKING, vindAsset, env } from './config.js';

const DAG = 86400000, JAAR = 365.25 * DAG;
const iso = d => new Date(d).toISOString().slice(0, 10);
const getal = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function staatDividend(staat) {
  staat.pot ??= 0;
  return (staat.dividend ||= { dag: null, dekking: {}, events: [], rendement: {}, tegoed: [], ontvangen: [], geschat: {}, bench: 0, benchStaking: {} });
}

// Bezit van kopen & vasthouden (aantal stuks per asset)
const benchStuks = (staat, s) => staat.bench?.[s] ? (CONFIG.startKapitaal / SYMS.length) / staat.bench[s] : 0;

// ---------- data ophalen (1x per dag) ----------
export async function haalDividendData(staat, nu = new Date(), { fetchJson = standaardFetch } = {}) {
  const d = staatDividend(staat);
  if (d.dag === iso(nu)) return { nieuw: false };
  const fmp = env('FMP_KEY'), fh = env('FINNHUB_KEY');
  const nodig = [...new Set([
    ...Object.keys(staat.positions || {}),
    ...SYMS,
  ])].filter(s => { const a = vindAsset(s); return a && a.soort !== 'crypto'; });
  const fouten = [];
  // 1. Kalender: één aanroep voor alle gedekte symbolen (ex-datums van 10 dagen terug tot 30 dagen vooruit)
  if (fmp) {
    try {
      const k = await fetchJson(`https://financialmodelingprep.com/stable/dividends-calendar?from=${iso(+nu - 10 * DAG)}&to=${iso(+nu + 30 * DAG)}&apikey=${fmp}`);
      if (Array.isArray(k)) { voegEventsToe(d, k.filter(x => vindAsset(x.symbol))); meld('fmp', true, { aantal: 'dividendkalender' }); }
    } catch (e) { fouten.push('FMP kalender: ' + e.message); meld('fmp', false, { melding: e.message }); }
  }
  // 2. Per symbool éénmalig vaststellen of FMP het dekt (gratis plan is beperkt)
  for (const s of nodig) {
    if (d.dekking[s]) continue;
    if (!fmp) { d.dekking[s] = 'schatting'; continue; }
    try {
      const r = await fetchJson(`https://financialmodelingprep.com/stable/dividends?symbol=${encodeURIComponent(s)}&apikey=${fmp}`);
      if (Array.isArray(r)) { d.dekking[s] = 'fmp'; voegEventsToe(d, r.map(x => ({ ...x, symbol: s }))); }
      else d.dekking[s] = 'schatting';
    } catch { d.dekking[s] = 'schatting'; }
  }
  // 3. Schatting: dividendrendement via Finnhub (1x per week per symbool)
  for (const s of nodig.filter(s => d.dekking[s] === 'schatting')) {
    const r = d.rendement[s];
    if (r && +nu - new Date(r.t) < 7 * DAG) continue;
    if (!fh) continue;
    try {
      const m = await fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(s)}&metric=all&token=${fh}`);
      const pct = getal(m?.metric?.dividendYieldIndicatedAnnual) ?? getal(m?.metric?.currentDividendYieldTTM) ?? 0;
      d.rendement[s] = { pct: Math.max(0, Math.min(15, pct)), t: nu.toISOString() };
      await new Promise(r => setTimeout(r, 1100));
    } catch (e) { fouten.push(`Finnhub rendement ${s}: ${e.message}`); }
  }
  d.events = d.events.filter(e => +nu - new Date(e.ex) < 120 * DAG).slice(-400);
  d.dag = iso(nu);
  return { nieuw: true, fouten };
}

function voegEventsToe(d, lijst) {
  for (const x of lijst) {
    const ex = x.date || x.exDividendDate || x.exDate, bedrag = getal(x.dividend ?? x.adjDividend);
    if (!ex || !(bedrag > 0)) continue;
    const key = `${x.symbol}|${ex}`;
    if (d.events.some(e => e.key === key)) continue;
    d.events.push({ key, sym: x.symbol, ex: iso(ex), pay: iso(x.paymentDate || ex), bedrag, rendement: getal(x.yield) });
  }
}

async function standaardFetch(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- verwerken (elke ronde) ----------
// Geeft de uitbetalingen van deze ronde terug (voor berichten en pushmeldingen).
export function verwerkDividend(staat, prijzen, usdEur, nu = new Date()) {
  const d = staatDividend(staat), vandaag = iso(nu), netto = 1 - CONFIG.dividendBelasting;
  const betaald = [];
  // 1. Recht op dividend vastleggen: wie op de ex-datum bezat (gekocht vóór de ex-datum)
  for (const e of d.events) {
    if (e.geregistreerd || e.ex > vandaag) continue;
    e.geregistreerd = true;
    if (staat.started_at && e.ex < iso(staat.started_at)) continue;
    const p = staat.positions?.[e.sym];
    if (p?.qty > 0 && (!p.sinds || iso(p.sinds) < e.ex)) d.tegoed.push({ sym: e.sym, ex: e.ex, pay: e.pay, perStuk: e.bedrag, qty: p.qty });
    const b = benchStuks(staat, e.sym);
    if (b > 0) d.tegoed.push({ sym: e.sym, ex: e.ex, pay: e.pay, perStuk: e.bedrag, qty: b, bench: true });
  }
  // 2. Uitbetalen op de betaaldatum (bedragen in dollar, omgerekend naar euro, min 15% belasting)
  d.tegoed = d.tegoed.filter(t => {
    if (t.pay > vandaag) return true;
    const eur = Math.round(t.qty * t.perStuk * usdEur * netto * 100) / 100;
    if (t.bench) { d.bench += eur; return false; }
    if (eur > 0) {
      staat.pot = Math.round((staat.pot + eur) * 100) / 100;
      const r = { sym: t.sym, eur, datum: vandaag, ex: t.ex, perStuk: t.perStuk, soort: 'exact' };
      d.ontvangen.push(r); betaald.push(r);
    }
    return false;
  });
  // 3. Schatting voor wat FMP niet dekt: elke ronde een klein stukje van het jaarrendement
  const vorige = d.laatsteSchatting ? new Date(d.laatsteSchatting) : nu;
  const fractie = Math.max(0, Math.min(2 * DAG, +nu - +vorige)) / JAAR;
  d.laatsteSchatting = nu.toISOString();
  if (fractie > 0) {
    for (const [s, p] of Object.entries(staat.positions || {})) {
      if (d.dekking[s] !== 'schatting' || !d.rendement[s]?.pct || !(prijzen[s] > 0)) continue;
      const eur = p.qty * prijzen[s] * (d.rendement[s].pct / 100) * fractie * netto;
      staat.pot = Math.round((staat.pot + eur) * 10000) / 10000;
      d.geschat[s] = (d.geschat[s] || 0) + eur;
    }
    for (const s of SYMS) {
      if (d.dekking[s] !== 'schatting' || !d.rendement[s]?.pct || !(prijzen[s] > 0)) continue;
      d.bench += benchStuks(staat, s) * prijzen[s] * (d.rendement[s].pct / 100) * fractie * netto;
    }
  }
  // geschatte bedragen 1x per maand als regel in de lijst zetten
  const maand = vandaag.slice(0, 7);
  if (d.schattingMaand && d.schattingMaand !== maand) {
    for (const [s, eur] of Object.entries(d.geschat)) if (eur >= 0.01) d.ontvangen.push({ sym: s, eur: Math.round(eur * 100) / 100, datum: vandaag, soort: 'schatting' });
    d.geschat = {};
  }
  d.schattingMaand = maand;
  d.ontvangen = d.ontvangen.slice(-200);
  return betaald;
}

// Staking: crypto in bezit groeit met de netto rente. Geeft de opbrengst in euro van deze ronde terug.
export function verwerkStaking(staat, prijzen, nu = new Date()) {
  const d = staatDividend(staat);
  const vorige = staat.stakingT ? new Date(staat.stakingT) : nu;
  const jaren = Math.max(0, Math.min(2 * DAG, +nu - +vorige)) / JAAR;
  staat.stakingT = nu.toISOString();
  let totaal = 0;
  if (!jaren) return 0;
  staat.staking ||= {};
  for (const [s, p] of Object.entries(staat.positions || {})) {
    const r = STAKING[s]; if (!r || !(p.qty > 0)) continue;
    const erbij = p.qty * (Math.exp(r * jaren) - 1);
    p.qty += erbij;
    const eur = erbij * (prijzen[s] || 0);
    staat.staking[s] = Math.round(((staat.staking[s] || 0) + eur) * 10000) / 10000;
    totaal += eur;
  }
  for (const s of SYMS) if (STAKING[s]) d.benchStaking[s] = (d.benchStaking[s] || 1) * Math.exp(STAKING[s] * jaren);
  return totaal;
}

// Voor het bronnenpakket: komende ex-dividenddatums en rendementen van de assets op de radar
export function dividendInfo(staat, radar, nu = new Date()) {
  const d = staat.dividend; if (!d) return [];
  const vandaag = iso(nu), uit = [];
  for (const s of radar) {
    const e = d.events.filter(e => e.sym === s && e.ex >= vandaag).sort((a, b) => a.ex.localeCompare(b.ex))[0];
    if (e) uit.push({ sym: s, tekst: `${s}: volgende ex-dividenddatum ${e.ex}, $${e.bedrag} per aandeel, betaald op ${e.pay}. Wie het aandeel vóór de ex-datum bezit, krijgt het (min 15% belasting).`, soort: 'exact' });
    else if (d.rendement[s]?.pct > 0) uit.push({ sym: s, tekst: `${s}: dividendrendement ongeveer ${d.rendement[s].pct.toFixed(2).replace('.', ',')}% per jaar (schatting).`, soort: 'schatting' });
  }
  return uit;
}

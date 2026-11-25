// Echte dagkoersen voor de voorspeller: dag-RSI, 50- en 200-daags gemiddelde, afstand tot de jaartop
// en BASISKANSEN (hoe vaak ging dit omhoog over zoveel handelsdagen in het afgelopen jaar).
// Bronnen (gratis, geen sleutel): Yahoo Finance voor aandelen/ETF's (Stooq als reserve), Bitvavo voor crypto.
import { BEURS_DICHT } from './config.js';

const TIMEOUT = 15000;
const UA = { 'User-Agent': 'Mozilla/5.0 (Hamerslag; +https://hamerslag.vercel.app)' };

async function haal(url, soort = 'json') {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`${r.status} bij ${url.split('?')[0]}`);
  return soort === 'json' ? r.json() : r.text();
}

async function yahoo(sym) {
  const j = await haal(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`);
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [], c = res?.indicators?.adjclose?.[0]?.adjclose || res?.indicators?.quote?.[0]?.close || [];
  return ts.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: c[i] })).filter(x => Number.isFinite(x.c) && x.c > 0);
}

async function stooq(sym) {
  const csv = await haal(`https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d`, 'text');
  return csv.trim().split('\n').slice(1).map(r => r.split(',')).map(([d, , , , c]) => ({ d, c: Number(c) })).filter(x => /^\d{4}-/.test(x.d) && x.c > 0).slice(-520);
}

async function bitvavo(sym) {
  const rows = await haal(`https://api.bitvavo.com/v2/${sym}-EUR/candles?interval=1d&limit=520`);
  return (Array.isArray(rows) ? rows : []).map(r => ({ d: new Date(Number(r[0])).toISOString().slice(0, 10), c: Number(r[4]) })).filter(x => x.c > 0).sort((a, b) => a.d.localeCompare(b.d));
}

// { SYM: [{d, c}] } oud -> nieuw. Wat niet lukt, ontbreekt gewoon.
export async function fetchDagkoersen(assets, { bronnen = {} } = {}) {
  const uit = {};
  await Promise.all(assets.map(async a => {
    const pogingen = a.kind === 'crypto' ? [bronnen.crypto || bitvavo] : [bronnen.aandeel || yahoo, bronnen.reserve || stooq];
    for (const f of pogingen) {
      try { const r = await f(a.symbol); if (r.length >= 60) { uit[a.symbol] = r; return; } } catch { /* volgende bron */ }
    }
  }));
  return uit;
}

const gem = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// Wilder-RSI over 14 dagen
export function rsi14(c) {
  if (c.length < 15) return null;
  let w = 0, v = 0;
  for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d > 0) w += d; else v -= d; }
  w /= 14; v /= 14;
  for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; w = (w * 13 + Math.max(d, 0)) / 14; v = (v * 13 + Math.max(-d, 0)) / 14; }
  return v === 0 ? 100 : 100 - 100 / (1 + w / v);
}

// Hoe vaak ging het in het afgelopen jaar (± 250 handelsdagen) omhoog / omlaag / bleef het binnen de marge over h dagen?
export function basisKansen(c, h, marge) {
  const start = Math.max(0, c.length - 250 - h);
  let op = 0, neer = 0, gelijk = 0, n = 0;
  for (let i = start; i + h < c.length; i++) {
    const r = c[i + h] / c[i] - 1; n++;
    if (r > 0) op++; else if (r < 0) neer++;
    if (Math.abs(r) <= marge) gelijk++;
  }
  if (n < 40) return null;
  return { OP: Math.round(op / n * 100), NEER: Math.round(neer / n * 100), GELIJK: Math.round(gelijk / n * 100), n };
}

export function dagIndicatoren(reeks, marge = 0.015) {
  const c = reeks.map(x => x.c), laatste = c.at(-1);
  const sma = n => c.length >= n ? gem(c.slice(-n)) : null;
  const s50 = sma(50), s200 = sma(200), top = Math.max(...c.slice(-252));
  const terug = n => c.length > n ? laatste / c.at(-1 - n) - 1 : null;
  return {
    rsi: rsi14(c), sma50: s50, sma200: s200, boven50: s50 ? laatste > s50 : null, boven200: s200 ? laatste > s200 : null,
    chg5d: terug(5), chg30d: terug(21), vanTop: laatste / top - 1,
    basis3: basisKansen(c, 3, marge), basis5: basisKansen(c, 5, marge), closes: c,
  };
}

// Aantal handelsdagen tot de einddatum (crypto: gewone dagen)
export function handelsdagen(nu, tot, crypto) {
  let n = 0;
  for (let t = new Date(nu); ; ) {
    t = new Date(t.getTime() + 864e5);
    if (t > new Date(tot)) break;
    const d = t.toISOString().slice(0, 10), w = t.getUTCDay();
    if (crypto || (w !== 0 && w !== 6 && !BEURS_DICHT[d])) n++;
  }
  return Math.max(1, n);
}

// Basiskans voor precies deze voorspelling (richting + horizon + marge)
export function basisVoor(ind, v, nu, crypto) {
  if (!ind?.closes) return null;
  const b = basisKansen(ind.closes, handelsdagen(nu, v.tot, crypto), Number(v.marge));
  return b ? b[v.richting] : null;
}

export function dagRegel(ind) {
  if (!ind) return '';
  const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  const d = [];
  if (ind.rsi != null) d.push(`dag-RSI ${Math.round(ind.rsi)}`);
  if (ind.boven50 != null) d.push(`${ind.boven50 ? 'boven' : 'onder'} 50-dagengem.`);
  if (ind.boven200 != null) d.push(`${ind.boven200 ? 'boven' : 'onder'} 200-dagengem.`);
  if (ind.chg30d != null) d.push(`maand ${pct(ind.chg30d)}`);
  if (ind.vanTop != null) d.push(`${Math.round(-ind.vanTop * 100)}% onder jaartop`);
  if (ind.basis5) d.push(`basiskans 5 handelsdagen: omhoog ${ind.basis5.OP}%, omlaag ${ind.basis5.NEER}%`);
  return d.join(' · ');
}

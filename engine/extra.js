// Extra bronnen (november 2026):
//  1. Finnhub: nieuws per aandeel + de kalender met kwartaalcijfers (zelfde gratis sleutel als de koersen)
//  2. SEC EDGAR: officiële meldingen van Amerikaanse bedrijven (8-K) en buitenlandse (6-K). Geen sleutel,
//     wel een contactadres in de User-Agent (SEC-regel). Zet je e-mail in de GitHub-variabele SEC_CONTACT.
//  3. FRED (St. Louis Fed): rente, inflatie, werkloosheid, VIX. Gratis sleutel: FRED_KEY.
// Alles faalt rustig: lukt een bron niet, dan gaat de ronde gewoon door zonder.

import { AANDELEN, vindAsset, env } from './config.js';

const TIMEOUT = 15000;
const dag = (d, plus = 0) => new Date(d.getTime() + plus * 864e5).toISOString().slice(0, 10);
async function json(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`${r.status} bij ${url.split('?')[0]}`);
  return r.json();
}
const isAandeel = s => AANDELEN.some(a => a.sym === s);
const naamVan = s => vindAsset(s)?.naam || s;

// ---------- 1a. nieuws per aandeel (Finnhub /company-news) ----------
// Alleen voor aandelen die er nu toe doen: wat we bezitten, de agenda van de voorzitting en de grootste bewegers.
export async function fetchBedrijfsnieuws(symbolen, { nu = new Date(), maxPerAandeel = 3, maxAandelen = 6 } = {}) {
  const key = env('FINNHUB_KEY'); if (!key) return [];
  const lijst = [...new Set(symbolen)].filter(isAandeel).slice(0, maxAandelen);
  const uit = [];
  let mis = 0, fout = null;
  for (const s of lijst) {
    const fh = AANDELEN.find(a => a.sym === s)?.fh || s;
    try {
      const items = await json(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(fh)}&from=${dag(nu, -2)}&to=${dag(nu)}&token=${key}`);
      (Array.isArray(items) ? items : []).sort((a, b) => b.datetime - a.datetime).slice(0, maxPerAandeel)
        .forEach(n => uit.push({ headline: n.headline, summary: n.summary, url: n.url, source: n.source || 'Finnhub', datetime: n.datetime, cat: 'aandeel', vast: [s] }));
    } catch (e) { mis++; fout = e; /* één aandeel mislukt: de rest gaat door */ }
    await new Promise(r => setTimeout(r, 1100));   // Finnhub gratis: max 60 per minuut
  }
  if (lijst.length && mis === lijst.length) throw fout;
  return uit;
}

// ---------- 1b. kwartaalcijfers (Finnhub /calendar/earnings) ----------
const UUR = { bmo: 'voor de opening', amc: 'na het slot', dmh: 'tijdens de handel' };
export async function fetchCijferkalender({ nu = new Date(), dagen = 7 } = {}) {
  const key = env('FINNHUB_KEY'); if (!key) return [];
  const j = await json(`https://finnhub.io/api/v1/calendar/earnings?from=${dag(nu)}&to=${dag(nu, dagen)}&token=${key}`);
  const fhNaarSym = new Map(AANDELEN.map(a => [a.fh || a.sym, a.sym]));
  return (j?.earningsCalendar || [])
    .filter(e => fhNaarSym.has(e.symbol) && e.date)
    .map(e => ({ sym: fhNaarSym.get(e.symbol), datum: e.date, uur: UUR[e.hour] || '', epsVerwacht: Number.isFinite(e.epsEstimate) ? e.epsEstimate : null, omzetVerwacht: Number.isFinite(e.revenueEstimate) ? e.revenueEstimate : null, kwartaal: e.quarter, jaar: e.year }))
    .sort((a, b) => a.datum.localeCompare(b.datum));
}
export function cijferTitel(c) {
  const d = new Date(c.datum + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const delen = [`Kwartaalcijfers ${naamVan(c.sym)} (${c.sym}) op ${d}${c.uur ? ', ' + c.uur : ''}`];
  if (c.epsVerwacht != null) delen.push(`verwachte winst per aandeel $${c.epsVerwacht.toFixed(2).replace('.', ',')}`);
  if (c.omzetVerwacht != null) delen.push(`verwachte omzet $${(c.omzetVerwacht / 1e9).toFixed(1).replace('.', ',')} mld`);
  return delen.join(' · ');
}

// ---------- 2. SEC EDGAR ----------
const SEC_UA = () => `Hamerslag/1.0 (${env('SEC_CONTACT', 'leerproject zonder contactadres')})`;
const ITEMS = {
  '1.01': 'belangrijke overeenkomst', '1.02': 'overeenkomst beëindigd', '1.03': 'faillissement', '1.05': 'cyberincident',
  '2.01': 'overname of verkoop afgerond', '2.02': 'kwartaalcijfers', '2.03': 'nieuwe schuld', '2.05': 'reorganisatiekosten', '2.06': 'afwaardering',
  '3.01': 'beursnotering in gevaar', '3.02': 'nieuwe aandelen uitgegeven', '4.02': 'eerdere cijfers niet meer betrouwbaar',
  '5.02': 'wissel in bestuur of top', '5.07': 'uitslag aandeelhoudersvergadering', '7.01': 'mededeling aan beleggers', '8.01': 'overig nieuws',
};
const ZWAAR = new Set(['1.01', '1.03', '1.05', '2.01', '2.02', '2.06', '3.01', '4.02', '5.02']);
let cikCache = null;
async function cikKaart() {
  if (cikCache) return cikCache;
  const j = await json('https://www.sec.gov/files/company_tickers.json', { 'user-agent': SEC_UA() });
  cikCache = new Map(Object.values(j || {}).map(c => [String(c.ticker).toUpperCase(), String(c.cik_str).padStart(10, '0')]));
  return cikCache;
}
export async function fetchSecMeldingen(symbolen, { nu = new Date(), uren = 48, maxAandelen = 8 } = {}) {
  const lijst = [...new Set(symbolen)].filter(isAandeel).slice(0, maxAandelen);
  if (!lijst.length) return [];
  const kaart = await cikKaart();
  const grens = nu.getTime() - uren * 3600e3;
  const uit = [];
  let mis = 0, fout = null, geprobeerd = 0;
  for (const s of lijst) {
    const cik = kaart.get(s); if (!cik) continue;
    geprobeerd++;
    try {
      const j = await json(`https://data.sec.gov/submissions/CIK${cik}.json`, { 'user-agent': SEC_UA() });
      const r = j?.filings?.recent || {};
      (r.form || []).forEach((form, i) => {
        if (form !== '8-K' && form !== '6-K') return;
        const t = new Date(r.acceptanceDateTime?.[i] || r.filingDate?.[i]).getTime();
        if (!(t >= grens) || t > nu.getTime() + 36e5) return;
        const items = String(r.items?.[i] || '').split(',').map(x => x.trim()).filter(Boolean);
        const wat = form === '6-K' ? (r.primaryDocDescription?.[i] || 'mededeling buitenlandse onderneming') : items.map(x => ITEMS[x]).filter(Boolean).join(', ') || 'melding';
        const map = String(r.accessionNumber?.[i] || '').replace(/-/g, '');
        const url = map && r.primaryDocument?.[i] ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${map}/${r.primaryDocument[i]}` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${form}`;
        uit.push({ headline: `Officiële melding ${naamVan(s)} (${s}) bij de SEC: ${wat} (${form}${items.length ? ', ' + items.join(', ') : ''})`, summary: '', url, source: 'SEC EDGAR', datetime: Math.floor(t / 1000), cat: 'melding', vast: [s], belangPlus: items.some(x => ZWAAR.has(x)) ? 2 : 1 });
      });
    } catch (e) { mis++; fout = e; /* één bedrijf mislukt: de rest gaat door */ }
    await new Promise(r => setTimeout(r, 150));   // SEC: max 10 verzoeken per seconde
  }
  if (geprobeerd && mis === geprobeerd) throw fout;
  return uit;
}

// ---------- 3. FRED: de grote economische cijfers ----------
export const FRED_REEKSEN = [
  { id: 'DFF', naam: 'Rente Amerikaanse centrale bank (fed funds)', eenheid: '%', n: 8 },
  { id: 'ECBDFR', naam: 'Depositorente ECB', eenheid: '%', n: 3 },
  { id: 'DGS10', naam: 'Rente 10-jarige Amerikaanse staatslening', eenheid: '%', n: 8 },
  { id: 'T10Y2Y', naam: 'Verschil 10- en 2-jarige rente VS (negatief = recessiesignaal)', eenheid: 'procentpunt', n: 8 },
  { id: 'VIXCLS', naam: 'VIX, de angstmeter van de aandelenbeurs', eenheid: '', n: 8 },
  { id: 'CPIAUCSL', naam: 'Inflatie VS op jaarbasis', eenheid: '%', n: 14, jaar: true },
  { id: 'UNRATE', naam: 'Werkloosheid VS', eenheid: '%', n: 3 },
];
export async function fetchMacro() {
  const key = env('FRED_KEY'); if (!key) return [];
  const uit = [];
  let fout = null;
  for (const r of FRED_REEKSEN) {
    try {
      const j = await json(`https://api.stlouisfed.org/fred/series/observations?series_id=${r.id}&api_key=${key}&file_type=json&sort_order=desc&limit=${r.n}`);
      const obs = (j?.observations || []).filter(o => o.value !== '.' && Number.isFinite(Number(o.value)));
      if (obs.length < 2) continue;
      let waarde = Number(obs[0].value), vorige = Number(obs[1].value);
      if (r.jaar) {                                     // CPI is een index: reken om naar inflatie t.o.v. een jaar eerder
        if (obs.length < 14) continue;
        waarde = (Number(obs[0].value) / Number(obs[12].value) - 1) * 100;
        vorige = (Number(obs[1].value) / Number(obs[13].value) - 1) * 100;
      }
      uit.push({ ...r, waarde, vorige, datum: obs[0].date, vorigeDatum: obs[1].date });
    } catch (e) { fout = e; /* één reeks mislukt: de rest gaat door */ }
  }
  if (!uit.length && fout) throw fout;
  return uit;
}
const nl = (v, d = 2) => v.toFixed(d).replace('.', ',');
export function macroTitel(m) {
  const maand = m.jaar || m.id === 'UNRATE' ? new Date(m.datum + 'T12:00:00Z').toLocaleDateString('nl-NL', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : m.datum;
  const e = m.eenheid === '%' ? '%' : m.eenheid ? ' ' + m.eenheid : '';
  return `${m.naam}: ${nl(m.waarde)}${e} (${maand}), daarvoor ${nl(m.vorige)}${e}`;
}

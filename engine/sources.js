// Haalt elke ronde verse data op en maakt er een genummerd bronnenpakket van.
// Elke bron krijgt een id ([B1], [B2], ...), een uitgever, een tijdstip en
// waar mogelijk een link. De traders mogen alleen naar deze ids verwijzen.

import { meld, meet, uitgezet } from './bronstatus.js';
import { fetchBedrijfsnieuws, fetchCijferkalender, fetchSecMeldingen, fetchMacro, cijferTitel, macroTitel } from './extra.js';
import { CONFIG, KOPPELING, GEWICHT, CRYPTO_TOP, STABLES, ASSETS, AANDELEN, ETFS, UNIVERSUM, registreer, vindAsset, trefwoorden, env } from './config.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TIMEOUT = 15000;

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} bij ${url.split('?')[0]}`);
  return r.json();
}

// ---------- losse bronnen ----------

export async function fetchCrypto() {
  const key = env('COINGECKO_KEY');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=${CRYPTO_TOP + 20}&page=1&price_change_percentage=1h,24h,7d`;
  const rows = await getJson(url, key ? { 'x-cg-demo-api-key': key } : {});
  const uit = [];
  for (const c of rows) {
    if (uit.length >= CRYPTO_TOP) break;
    if (STABLES.has(String(c.symbol).toLowerCase()) || STABLES.has(c.id)) continue;
    const a = registreer({ sym: String(c.symbol).toUpperCase(), naam: c.name, soort: 'crypto', cg: c.id, rank: c.market_cap_rank });
    if (!a) continue; // symbool botst met een aandeel
    uit.push({
      sym: a.sym, naam: a.naam, soort: 'crypto', rank: c.market_cap_rank, prijs: c.current_price,
      chg1h: num(c.price_change_percentage_1h_in_currency) / 100,
      chg24h: num(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h) / 100,
      chg7d: num(c.price_change_percentage_7d_in_currency) / 100,
      volume: c.total_volume, marktwaarde: c.market_cap, tijd: c.last_updated || new Date().toISOString(),
      bron: 'CoinGecko', url: `https://www.coingecko.com/nl/coins/${c.id}`,
    });
  }
  return uit;
}

export async function fetchUsdEur() {
  try {
    const j = await getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR');
    return { koers: j.rates.EUR, datum: j.date };
  } catch {
    const j = await getJson('https://api.frankfurter.app/latest?from=USD&to=EUR');
    return { koers: j.rates.EUR, datum: j.date };
  }
}

export async function fetchStocks(usdEur, { pauze = 1150, symbolen = null } = {}) {   // 1150 ms: ruim onder de 60 per minuut, ook als de nieuwsreflex tegelijk draait
  const key = env('FINNHUB_KEY');
  if (!key) throw new Error('FINNHUB_KEY ontbreekt');
  const out = [];
  let mislukt = 0;
  for (const a of [...AANDELEN, ...ETFS].filter(a => !symbolen || symbolen.includes(a.sym))) { // Finnhub gratis: max 60 per minuut, dus rustig aan
    try {
      const q = await getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(a.fh)}&token=${key}`);
      if (q.c > 0) out.push({
        sym: a.sym, naam: a.naam, soort: a.soort, rank: a.rank, prijs: q.c * usdEur, prijsUsd: q.c,
        chg24h: num(q.dp) / 100, tijd: q.t ? new Date(q.t * 1000).toISOString() : new Date().toISOString(),
        bron: 'Finnhub', url: `https://finnhub.io/quote/${a.fh}`,
      });
      mislukt = 0;
    } catch (e) {
      // één aandeel mislukt: de rest gaat door. Maar 5 keer op rij mis en nog niets binnen = Finnhub ligt plat
      if (++mislukt >= 5 && !out.length) throw new Error(`Finnhub reageert niet (${e.message})`);
    }
    await sleep(pauze);
  }
  if (!out.length) throw new Error('geen enkele aandelenkoers');
  return out;
}

// RSS-feeds (Nederlands en crypto). Simpele parser, geen extra pakketten.
export const RSS = [
  { naam: 'NOS', id: 'nos', url: 'https://feeds.nos.nl/nosnieuwsalgemeen', cat: 'markt' },
  { naam: 'NOS Economie', id: 'nos', url: 'https://feeds.nos.nl/nosnieuwseconomie', cat: 'markt' },
  { naam: 'CoinDesk', id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', cat: 'crypto' },
  // Centrale banken: rentebesluiten raken de hele markt (de koppen noemen 'ECB' of 'Fed' vaak niet zelf)
  { naam: 'ECB', id: 'ecb', url: 'https://www.ecb.europa.eu/rss/press.xml', cat: 'markt', markt: true },
  { naam: 'Federal Reserve', id: 'fed', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', cat: 'markt', markt: true },
];
export function parseRss(xml, bron) {
  const tag = (blok, t) => { const m = blok.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? schoon(m[1]) : ''; };
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => {
    const b = m[0];
    const tijd = new Date(tag(b, 'pubDate') || tag(b, 'dc:date') || Date.now());
    return { headline: tag(b, 'title'), summary: tag(b, 'description').slice(0, 300), url: tag(b, 'link') || tag(b, 'guid'), source: bron.naam, datetime: Math.floor(tijd.getTime() / 1000), cat: bron.cat, markt: !!bron.markt };
  }).filter(n => n.headline);
}
const schoon = t => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
async function fetchRss(bron) {
  const r = await fetch(bron.url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': 'Hamerslag/1.0 (leerproject)' } });
  if (!r.ok) throw new Error(`${r.status} bij ${bron.naam}`);
  return parseRss(await r.text(), bron);
}

// Fear & Greed-index voor crypto (alternative.me, geen sleutel)
export async function fetchFearGreed() {
  const j = await getJson('https://api.alternative.me/fng/?limit=2');
  const [vandaag, gisteren] = j?.data || [];
  const waarde = Number(vandaag?.value);
  if (!Number.isFinite(waarde)) throw new Error('geen waarde');
  return { waarde, label: vandaag.value_classification || '', gisteren: Number.isFinite(Number(gisteren?.value)) ? Number(gisteren.value) : null, tijd: new Date((Number(vandaag.timestamp) || Date.now() / 1000) * 1000).toISOString() };
}

export async function fetchNews({ maxUren = CONFIG.nieuwsMaxUren, max = CONFIG.maxNieuws } = {}) {
  const key = env('FINNHUB_KEY');
  const lijsten = await Promise.all([
    key ? getJson(`https://finnhub.io/api/v1/news?category=general&token=${key}`).then(a => { meld('finnhub_nieuws', true, { aantal: `${a.length} berichten` }); return a.map(n => ({ ...n, cat: 'markt' })); }).catch(e => { meld('finnhub_nieuws', false, { melding: e.message }); return []; }) : (uitgezet('finnhub_nieuws', 'Zet FINNHUB_KEY'), []),
    key ? getJson(`https://finnhub.io/api/v1/news?category=crypto&token=${key}`).then(a => a.map(n => ({ ...n, cat: 'crypto' }))).catch(() => []) : [],
    ...RSS.map(b => fetchRss(b).then(a => { meld(b.id, true, { aantal: `${a.length} berichten` }); return a; }).catch(e => { meld(b.id, false, { melding: e.message }); return []; })),
  ]);
  return verwerkNieuws(lijsten.flat(), { maxUren, max });
}

// Nieuwsfilter: koppen komen van buiten en gaan rechtstreeks naar de AI. Iemand kan proberen
// de AI via een kop iets op te dragen ("negeer je regels, stem voor"). Zulke berichten gooien we weg,
// en de rest maken we schoon (geen nep-bron-ids, codeblokken of HTML).
const VERDACHT = /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|all|instructions?|rules?)\b|system ?prompt|\byou are (now )?(an?|the) |\bas an ai\b|jailbreak|\bnegeer\b.{0,30}\b(regels|instructies|vorige|bovenstaande)\b|\b(vote|stem(t|men)?) (yes|voor|for)\b|\b(buy|koop) (now|immediately|nu|direct)\b.{0,20}\b(all|alles|everything)\b|<\/?(script|system|assistant|user)\b|```|\{"/i;
export const isVerdacht = tekst => VERDACHT.test(String(tekst || ''));
export const veilig = (tekst, max = 300) => String(tekst || '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ')   // onzichtbare en stuurtekens
  .replace(/\[\s*[A-Z]\d+\s*\]/g, '')                                          // nep-bron-ids zoals [B3]
  .replace(/<[^>]{0,200}>/g, ' ').replace(/[{}`]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, max);
export let gefilterd = 0;

export function verwerkNieuws(ruw, { maxUren = CONFIG.nieuwsMaxUren, max = CONFIG.maxNieuws } = {}) {
  const grens = Date.now() - maxUren * 3600 * 1000;
  const gezien = new Set();
  return ruw
    .filter(n => n.headline && n.datetime * 1000 >= grens)
    .map(n => ({ ...n, url: /^https?:\/\//i.test(String(n.url || '')) ? n.url : '' }))   // alleen gewone webadressen
    .filter(n => { if (isVerdacht(n.headline + ' ' + (n.summary || ''))) { gefilterd++; console.log('⚠ nieuwsfilter: verdacht bericht weggegooid:', String(n.headline).slice(0, 80)); return false; } return true; })
    .filter(n => { const k = n.headline.toLowerCase().slice(0, 60); if (gezien.has(k)) return false; gezien.add(k); return true; })
    .map(n => {
      const tekst = n.headline + ' ' + (n.summary || '');
      const assets = [...new Set([...(n.markt ? ['MARKT'] : []), ...(n.vast || []), ...koppel(tekst)])];
      return {
        titel: veilig(n.headline, 200), samenvatting: veilig(n.summary, 280),
        uitgever: n.source || 'Finnhub', url: n.url, tijd: new Date(n.datetime * 1000).toISOString(),
        categorie: n.cat, assets, belang: belang(tekst) + (assets.some(a => a !== 'MARKT') ? 1 : 0) + (n.belangPlus || 0),
      };
    })
    .sort((x, y) => y.belang - x.belang || y.tijd.localeCompare(x.tijd))
    .slice(0, max);
}

// Welke assets gaat dit bericht over?
export function koppel(tekst) {
  const t = ' ' + tekst.toLowerCase() + ' ';
  const uit = new Set();
  const raak = woorden => woorden.some(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t));
  for (const a of UNIVERSUM.values()) if (raak(trefwoorden(a))) uit.add(a.sym);
  if (raak(KOPPELING.CRYPTO)) for (const a of UNIVERSUM.values()) if (a.soort === 'crypto' && (a.rank || 99) <= 3) uit.add(a.sym);
  if (raak(KOPPELING.MARKT)) uit.add('MARKT');
  return [...uit];
}

// Hoe "groot" is een nieuwsbericht? Voor de BREAKING-balk, de volgorde en de nieuwsreflex.
export function belang(tekst) {
  const t = ' ' + tekst.toLowerCase() + ' ';
  let score = 0;
  for (const [punten, woorden] of Object.entries(GEWICHT)) {
    for (const w of woorden) if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t)) { score += Number(punten); }
  }
  return Math.min(score, 10);
}

// ---------- alles samen ----------

// ---------- koersen met reservebronnen en een dubbele controle ----------
// Crypto: CoinGecko, gecontroleerd tegen Bitvavo (openbaar, geen sleutel). Wijkt een prijs meer dan 5% af,
// dan vertrouwen we hem deze ronde niet. Valt CoinGecko uit, dan nemen we de koersen van Bitvavo.
// Aandelen: Finnhub. Ontbreken belangrijke aandelen (bijv. Finnhub plat), dan vult Financial Modeling Prep aan.
export async function fetchBitvavo() {
  const rows = await getJson('https://api.bitvavo.com/v2/ticker/24h');
  if (!Array.isArray(rows)) throw new Error('Bitvavo: onverwacht antwoord');
  const uit = {};
  for (const r of rows) {
    const [sym, quote] = String(r.market || '').split('-');
    const last = Number(r.last), open = Number(r.open);
    if (quote === 'EUR' && last > 0) uit[sym] = { prijs: last, chg24h: open > 0 ? last / open - 1 : null, tijd: r.timestamp ? new Date(Number(r.timestamp)).toISOString() : new Date().toISOString() };
  }
  return uit;
}
export async function fetchFmpQuote(sym, usdEur) {
  const key = env('FMP_KEY'); if (!key) throw new Error('geen FMP_KEY');
  const j = await getJson(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(sym)}&apikey=${key}`);
  const q = Array.isArray(j) ? j[0] : j;
  const prijs = Number(q?.price);
  if (!(prijs > 0)) throw new Error(`FMP: geen prijs voor ${sym}`);
  const pct = Number(q.changePercentage ?? q.changesPercentage);
  return { prijs: prijs * usdEur, chg24h: Number.isFinite(pct) ? pct / 100 : null };
}
export async function haalKoersen({ usdEur = 0.93, bezit = [], fouten = [], stocks = true } = {}) {
  const veilig = async (naam, fn) => { try { return await fn(); } catch (e) { fouten.push(`${naam}: ${e.message}`); return null; } };
  const [cg, bv, aandelen] = await Promise.all([
    veilig('CoinGecko', () => meet('coingecko', fetchCrypto, r => `${r.length} munten`)), veilig('Bitvavo (controle)', () => meet('bitvavo', fetchBitvavo, r => `${Object.keys(r).length} markten`)),
    stocks ? (env('FINNHUB_KEY') ? veilig('Finnhub koersen', () => meet('finnhub_koers', () => fetchStocks(usdEur), r => `${r.length} koersen`)) : (uitgezet('finnhub_koers', 'Zet FINNHUB_KEY'), [])) : [],
  ]);
  let crypto = cg || [];
  if (crypto.length && bv) {
    crypto = crypto.filter(k => {
      const b = bv[k.sym]; if (!b) return true;
      const afwijking = k.prijs / b.prijs - 1;
      if (Math.abs(afwijking) > 0.05) { fouten.push(`prijscontrole: ${k.sym} wijkt ${(afwijking * 100).toFixed(1)}% af van Bitvavo, deze ronde overgeslagen`); return false; }
      return true;
    });
  }
  if (!crypto.length && bv) {
    fouten.push('CoinGecko viel uit: crypto-koersen van Bitvavo gebruikt');
    const syms = [...new Set([...ASSETS.filter(a => a.soort === 'crypto').map(a => a.sym), ...bezit.filter(s => vindAsset(s)?.soort === 'crypto')])];
    crypto = syms.filter(s => bv[s]).map(s => { const a = vindAsset(s) || {}; return { sym: s, naam: a.naam || s, soort: 'crypto', rank: a.rank, prijs: bv[s].prijs, chg24h: bv[s].chg24h, tijd: bv[s].tijd, bron: 'Bitvavo', url: `https://bitvavo.com/nl/markets/${s}-EUR` }; });
  }
  let stocksLijst = aandelen || [];
  if (stocks) {
    const heb = new Set(stocksLijst.map(k => k.sym));
    const belangrijk = [...new Set([...bezit, 'SPY', 'QQQ', 'GLD', ...ASSETS.filter(a => a.soort !== 'crypto').map(a => a.sym)])].filter(s => { const a = vindAsset(s); return a && a.soort !== 'crypto' && !heb.has(s); }).slice(0, 15);
    if (belangrijk.length && env('FMP_KEY')) {
      let gevuld = 0;
      for (const s of belangrijk) {
        const q = await veilig(`FMP reserve ${s}`, () => fetchFmpQuote(s, usdEur));
        if (q) { const a = vindAsset(s); stocksLijst.push({ sym: s, naam: a.naam, soort: a.soort, rank: a.rank, prijs: q.prijs, chg24h: q.chg24h, tijd: new Date().toISOString(), bron: 'Financial Modeling Prep', url: `https://financialmodelingprep.com/financial-summary/${s}` }); gevuld++; }
      }
      meld('fmp', gevuld > 0, gevuld ? { aantal: `${gevuld} reservekoersen` } : { melding: 'reserve gaf geen koersen' });
      if (gevuld) fouten.push(`Finnhub miste ${belangrijk.length} belangrijke koersen: ${gevuld} aangevuld via Financial Modeling Prep`);
    }
  }
  return [...crypto, ...stocksLijst];
}

export async function verzamelBronnen({ bezit = [], focus = [], nu = new Date() } = {}) {
  const fouten = [];
  const veilig = async (naam, fn) => { try { return await fn(); } catch (e) { fouten.push(`${naam}: ${e.message}`); return null; } };
  const usdEur = await veilig('Wisselkoers', () => meet('frankfurter', fetchUsdEur, r => `$1 = €${r.koers.toFixed(2).replace('.', ',')}`));
  const [koersen, nieuws, fng] = await Promise.all([
    haalKoersen({ usdEur: usdEur?.koers ?? 0.93, bezit, fouten }),
    veilig('Finnhub nieuws', fetchNews),
    veilig('Fear & Greed', () => meet('feargreed', fetchFearGreed, r => `${r.waarde}/100`)),
  ]);
  // Extra: nieuws per aandeel, officiële SEC-meldingen, de cijferkalender en de grote economische cijfers.
  // Voor de aandelen die er nu toe doen: in bezit, op de agenda en de grootste bewegers van vandaag.
  const bewegers = koersen.filter(k => AANDELEN.some(a => a.sym === k.sym) && Number.isFinite(k.chg24h)).sort((a, b) => Math.abs(b.chg24h) - Math.abs(a.chg24h)).slice(0, 4).map(k => k.sym);
  const belangrijk = [...new Set([...bezit, ...focus, ...bewegers])];
  const [bn, sec, cijfers, macro] = await Promise.all([
    veilig('Finnhub bedrijfsnieuws', () => meet('finnhub_bedrijf', () => fetchBedrijfsnieuws(belangrijk, { nu }), r => `${r.length} berichten`)),
    env('SEC_CONTACT') ? veilig('SEC EDGAR', () => meet('sec', () => fetchSecMeldingen(belangrijk, { nu }), r => `${r.length} meldingen`)) : (uitgezet('sec', 'Zet SEC_CONTACT'), []),
    veilig('Finnhub cijferkalender', () => meet('cijfers', () => fetchCijferkalender({ nu }), r => `${r.length} deze week`)),
    env('FRED_KEY') ? veilig('FRED', () => meet('fred', fetchMacro, r => `${r.length} cijfers`)) : (uitgezet('fred', 'Zet FRED_KEY'), []),
  ]);
  const titels = new Set((nieuws || []).map(n => n.titel.toLowerCase().slice(0, 60)));
  const extraNieuws = verwerkNieuws([...(sec || []), ...(bn || [])], { max: 8 }).filter(n => !titels.has(n.titel.toLowerCase().slice(0, 60)));
  return { usdEur, koersen, nieuws: [...(nieuws || []), ...extraNieuws], fng, cijfers: cijfers || [], macro: macro || [], fouten };
}

// Maakt het genummerde pakket. `indicatoren` komt uit de eigen koersgeschiedenis.
export function maakPakket(ruw, indicatoren = {}, radar = null) {
  const pakket = [];
  let n = 0;
  const id = () => `B${++n}`;
  for (const k of ruw.koersen) {
    if (radar && !radar.includes(k.sym)) continue;
    const ind = indicatoren[k.sym] || {};
    const delen = [`${k.naam} (${k.sym}, ${k.soort}) €${fmt(k.prijs)}`, `24u ${pct(k.chg24h)}`];
    if (isFinite(k.chg1h)) delen.push(`1u ${pct(k.chg1h)}`);
    if (isFinite(k.chg7d)) delen.push(`7d ${pct(k.chg7d)}`);
    if (ind.rsi != null) delen.push(`RSI ${Math.round(ind.rsi)}`);
    if (ind.trend) delen.push(`trend ${ind.trend}`);
    pakket.push({ id: id(), kind: 'koers', publisher: k.bron, title: delen.join(' · '), url: k.url, published_at: k.tijd, data: { ...k, ...ind } });
  }
  if (ruw.fng) {
    const f = ruw.fng;
    pakket.push({ id: id(), kind: 'sentiment', publisher: 'Alternative.me', title: `Crypto Fear & Greed Index: ${f.waarde}/100 (${f.label})${f.gisteren != null ? `, gisteren ${f.gisteren}` : ''}`, url: 'https://alternative.me/crypto/fear-and-greed-index/', published_at: f.tijd, data: f });
  }
  if (ruw.usdEur) {
    pakket.push({ id: id(), kind: 'wisselkoers', publisher: 'ECB via Frankfurter', title: `1 dollar = €${ruw.usdEur.koers.toFixed(4)}${ruw.usdEur.datum ? ` (${ruw.usdEur.datum})` : ''}`, url: 'https://www.frankfurter.app', published_at: (ruw.usdEur.datum && !isNaN(new Date(ruw.usdEur.datum)) ? new Date(ruw.usdEur.datum) : new Date()).toISOString(), data: ruw.usdEur });
  }
  // Kwartaalcijfers die eraan komen (alleen voor aandelen op de radar)
  for (const c of (ruw.cijfers || []).filter(c => !radar || radar.includes(c.sym)).slice(0, 6)) {
    pakket.push({ id: id(), kind: 'agenda', publisher: 'Finnhub cijferkalender', title: cijferTitel(c), url: `https://www.nasdaq.com/market-activity/stocks/${c.sym.toLowerCase()}/earnings`, published_at: new Date().toISOString(), data: c });
  }
  // De grote economische cijfers (FRED)
  for (const m of ruw.macro || []) {
    pakket.push({ id: id(), kind: 'macro', publisher: 'FRED (St. Louis Fed)', title: macroTitel(m), url: `https://fred.stlouisfed.org/series/${m.id}`, published_at: new Date(m.datum + 'T12:00:00Z').toISOString(), data: m });
  }
  for (const nw of ruw.nieuws) {
    pakket.push({ id: id(), kind: 'nieuws', publisher: nw.uitgever, title: nw.titel, url: nw.url, published_at: nw.tijd, data: { samenvatting: nw.samenvatting, categorie: nw.categorie, belang: nw.belang, assets: nw.assets } });
  }
  return pakket;
}

export function pakketTekst(pakket) {
  return pakket.map(b => {
    const t = new Date(b.published_at).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
    const extra = b.kind === 'nieuws' && b.data.samenvatting ? ` — ${b.data.samenvatting}` : '';
    return `[${b.id}] (${b.kind}, ${b.publisher}, ${t}) ${b.title}${extra}`;
  }).join('\n');
}

function num(v) { const n = Number(v); return isFinite(n) ? n : NaN; }
function fmt(v) { return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 4 : 2 }).format(v); }
function pct(v) { return isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2).replace('.', ',') + '%' : '?'; }

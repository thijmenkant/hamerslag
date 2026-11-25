// Koersen in de tabel 'market' zetten. Wordt gebruikt door de zitting, de uurcheck (elk uur)
// en de nieuwsreflex (elke 5 minuten, alleen de prijzen die je bezit plus crypto), zodat de app altijd verse koersen toont.
import { CONFIG, vindAsset } from './config.js';
import { indicatoren, round2, waarde, benchWaarde } from './portfolio.js';
import { fetchBitvavo, fetchStocks, fetchUsdEur } from './sources.js';
import { beursOpen, env } from './config.js';

const fin = v => (Number.isFinite(v) ? v : null);

// historie = true: er komt een punt bij in de koersgeschiedenis (voor de indicatoren); false: alleen de prijs bijwerken
export function naarMarktRijen(koersen, bestaand = {}, { historie = true } = {}) {
  const ind = {};
  const rijen = koersen.map(k => {
    const a = vindAsset(k.sym) || { naam: k.naam, soort: k.soort };
    const oud = bestaand[k.sym]?.history || [];
    const hist = historie ? [...oud, round2(k.prijs * 1e4) / 1e4].slice(-CONFIG.historiePunten) : oud;
    ind[k.sym] = indicatoren(hist.length ? hist : [k.prijs]);
    return { symbol: k.sym, name: k.naam || a.naam, kind: k.soort || a.soort, cat: a.cat || (k.soort === 'crypto' ? 'crypto' : null), rank: k.rank ?? a.rank ?? null,
      price: k.prijs, chg1h: fin(k.chg1h), chg24h: fin(k.chg24h), chg7d: fin(k.chg7d) ?? fin(bestaand[k.sym]?.chg7d), source: k.bron, url: k.url, updated_at: k.tijd || new Date().toISOString(),
      history: hist, rsi: ind[k.sym].rsi ?? null, trend: ind[k.sym].trend ?? null };
  });
  return { rijen, ind };
}

// Waarde van de portefeuille vastleggen (lijn in de grafiek), met de nieuwste prijzen
export async function snapshotNu(db, staat, nu = new Date()) {
  if (!staat || staat.cash == null || !db.insertSnapshot) return;
  const prijzen = Object.fromEntries((await db.loadMarket()).map(m => [m.symbol, Number(m.price)]));
  await db.insertSnapshot({ t: nu.toISOString(), value: round2(waarde(staat, prijzen)), cash: round2(staat.cash), bench: round2(benchWaarde(staat, prijzen)) });
}

// Snel bijwerken (elke 5 minuten): crypto via Bitvavo (1 aanroep), aandelen/ETF's die je bezit via Finnhub (alleen als de beurs open is)
export async function verversPrijzen(db, { nu = new Date(), usdEur = 0.93 } = {}) {
  const staat = await db.loadState();
  const markt = Object.fromEntries((await db.loadMarket()).map(m => [m.symbol, m]));
  const bezit = Object.keys(staat?.positions || {});
  const nieuw = [];
  try {
    const bv = await fetchBitvavo();
    for (const [sym, b] of Object.entries(bv)) if (markt[sym]?.kind === 'crypto') nieuw.push({ sym, prijs: b.prijs, chg24h: b.chg24h, tijd: b.tijd, bron: 'Bitvavo', url: `https://bitvavo.com/nl/${sym.toLowerCase()}/koers`, naam: markt[sym].name, soort: 'crypto', rank: markt[sym].rank });
  } catch { /* volgende keer weer */ }
  const aandelen = bezit.filter(s => markt[s] && markt[s].kind !== 'crypto');
  if (aandelen.length && beursOpen(nu) && env('FINNHUB_KEY')) {
    try { const k = await fetchUsdEur().catch(() => null); nieuw.push(...await fetchStocks(k?.koers || usdEur, { symbolen: aandelen, pauze: 300 })); } catch { /* volgende keer weer */ }
  }
  if (!nieuw.length) return 0;
  const { rijen } = naarMarktRijen(nieuw, markt, { historie: false });
  await db.upsertMarket(rijen);
  return rijen.length;
}

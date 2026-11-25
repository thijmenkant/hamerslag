// Test: koersen lopen live mee — de uurcheck zet alle koersen + een grafiekpunt neer, de nieuwsreflex ververst de prijzen.
//   node test/markt.js
import assert from 'node:assert/strict';
import { geheugenDb } from '../db.js';
import { naarMarktRijen, verversPrijzen } from '../markt.js';

const db = geheugenDb();
await db.saveState({ cash: 875, positions: { SPY: { qty: 0.2, kost: 125 } }, bench: { cash: 1000, positions: {} } });
await db.upsertMarket(naarMarktRijen([{ sym: 'SPY', prijs: 600, chg24h: 0, soort: 'etf', naam: 'S&P 500' }, { sym: 'BTC', prijs: 80000, soort: 'crypto', naam: 'Bitcoin' }], {}).rijen);
const voor = db.data.market.find(m => m.symbol === 'SPY').history.length;

// nieuwsreflex: Bitvavo voor crypto, Finnhub voor SPY (beurs open: dinsdag 16:00 NL)
const echt = globalThis.fetch;
globalThis.fetch = async url => {
  url = String(url);
  if (url.includes('bitvavo')) return new Response(JSON.stringify([{ market: 'BTC-EUR', last: '81000', open: '80000', timestamp: Date.now() }]));
  if (url.includes('frankfurter')) return new Response(JSON.stringify({ rates: { EUR: 0.9 }, date: '2026-11-25' }));
  if (url.includes('finnhub')) return new Response(JSON.stringify({ c: 700, dp: 1.5, t: Math.floor(Date.now() / 1000) }));
  return echt(url);
};
process.env.FINNHUB_KEY = 'test';
const n = await verversPrijzen(db, { nu: new Date('2026-11-24T15:00:00Z') });
const spy = db.data.market.find(m => m.symbol === 'SPY'), btc = db.data.market.find(m => m.symbol === 'BTC');
assert.equal(n, 2); assert.equal(btc.price, 81000); assert.ok(Math.abs(spy.price - 630) < 0.01, `SPY ${spy.price}`);
assert.equal(spy.history.length, voor, 'snel verversen voegt geen punt toe aan de koersgeschiedenis');

// beurs dicht: alleen crypto
const n2 = await verversPrijzen(db, { nu: new Date('2026-11-25T08:00:00Z') });
assert.equal(n2, 1);
console.log('✅ Koersen lopen live mee: crypto elke 5 min via Bitvavo, je aandelen/ETFs via Finnhub als de beurs open is.');

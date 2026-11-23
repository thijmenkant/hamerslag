// Test van de reservebronnen en de prijscontrole, met een nagebootst internet.
//   node test/reservebronnen.js
import assert from 'node:assert/strict';
process.env.FINNHUB_KEY = 'nep'; process.env.FMP_KEY = 'nep'; process.env.COINGECKO_KEY = 'nep';
const { haalKoersen, parseRss, verwerkNieuws, RSS } = await import('../sources.js');

const cg = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, current_price: 56000, price_change_percentage_24h_in_currency: 1.2 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2, current_price: 1600, price_change_percentage_24h_in_currency: -0.5 },
  { id: 'solana', symbol: 'sol', name: 'Solana', market_cap_rank: 5, current_price: 90, price_change_percentage_24h_in_currency: 2 },   // fout: Bitvavo zegt 67
];
const bv = [{ market: 'BTC-EUR', last: '56100', open: '55500' }, { market: 'ETH-EUR', last: '1601', open: '1610' }, { market: 'SOL-EUR', last: '67', open: '66' }, { market: 'XRP-EUR', last: '0.95', open: '0.94' }];
let scenario = 'alles goed', aanroepen = {};
globalThis.fetch = async url => {
  const host = new URL(url).host; aanroepen[host] = (aanroepen[host] || 0) + 1;
  const json = (status, j) => ({ ok: status < 300, status, statusText: String(status), json: async () => j, text: async () => JSON.stringify(j) });
  if (host.includes('coingecko')) return scenario === 'coingecko plat' ? json(503, {}) : json(200, cg);
  if (host.includes('bitvavo')) return json(200, bv);
  if (host.includes('finnhub')) return scenario === 'finnhub plat' ? json(401, { error: 'Invalid API key' }) : json(200, { c: 249.1, dp: 0.3, t: 1764000000 });
  if (host.includes('financialmodelingprep')) return json(200, [{ symbol: new URL(url).searchParams.get('symbol'), price: 250, changePercentage: 0.4 }]);
  throw new Error('onverwacht: ' + url);
};

// 1. CoinGecko en Bitvavo allebei goed: SOL wijkt 34% af en wordt deze ronde niet vertrouwd
let fouten = [];
let k = await haalKoersen({ fouten, stocks: false });
assert.deepEqual(k.map(x => x.sym).sort(), ['BTC', 'ETH'], 'SOL met afwijkende prijs overgeslagen');
assert.ok(fouten.some(f => f.includes('SOL wijkt')), 'melding over de afwijking');

// 2. CoinGecko plat: Bitvavo springt in (nieuwe run: lampjes van run 1 eerst wegschrijven)
(await import('../bronstatus.js')).bewaarIn({});
scenario = 'coingecko plat'; fouten = [];
k = await haalKoersen({ fouten, stocks: false, bezit: ['XRP'] });
assert.ok(k.find(x => x.sym === 'BTC' && x.bron === 'Bitvavo' && x.prijs === 56100), 'BTC via Bitvavo');
assert.ok(k.find(x => x.sym === 'XRP'), 'ook wat we bezitten');
assert.ok(fouten.some(f => f.includes('Bitvavo gebruikt')));
const { huidig } = await import('../bronstatus.js');
assert.equal(huidig().coingecko?.ok, false, 'lampje CoinGecko rood');
assert.match(huidig().coingecko.melding, /503/, 'met de reden erbij');
assert.equal(huidig().bitvavo?.ok, true, 'lampje Bitvavo groen');

// 3. Finnhub plat: stopt na 5 pogingen (snel) en FMP vult de belangrijkste aandelen aan
scenario = 'finnhub plat'; fouten = []; aanroepen = {};
const t0 = Date.now();
const { fetchStocks } = await import('../sources.js');
await assert.rejects(() => fetchStocks(0.93, { pauze: 1 }), /Finnhub reageert niet/);
assert.equal(aanroepen['finnhub.io'], 5, 'na 5 mislukkingen op rij gestopt in plaats van 86');
// haalKoersen met een korte pauze: via een eigen symbolen-lijst kan niet, dus we meten alleen de reserve
k = await (async () => { const f = []; const r = await haalKoersen({ fouten: f, bezit: ['NVDA'], usdEur: 0.9 }); fouten = f; return r; })();
const nvda = k.find(x => x.sym === 'NVDA');
assert.ok(nvda && nvda.bron === 'Financial Modeling Prep' && Math.abs(nvda.prijs - 225) < 0.01, 'NVDA (in bezit) via FMP, omgerekend naar euro');
assert.ok(k.find(x => x.sym === 'SPY'), 'SPY via FMP');
assert.ok(aanroepen['financialmodelingprep.com'] <= 15, 'hooguit 15 reserve-aanroepen (gratis limiet 250 per dag)');
assert.ok(Date.now() - t0 < 15000, 'Finnhub plat kost geen anderhalve minuut meer');

// 4. Centrale banken: een ECB-bericht raakt altijd de hele markt
const ecb = RSS.find(r => r.naam === 'ECB');
const items = parseRss(`<rss><channel><item><title>Monetary policy decisions</title><link>https://www.ecb.europa.eu/press/pr/date/2026/html/x.en.html</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, ecb);
const nw = verwerkNieuws(items);
assert.ok(nw[0].assets.includes('MARKT'), 'ECB-besluit raakt de hele markt, ook zonder het woord ECB in de kop');
console.log('✅ Reservebronnen werken: prijscontrole tegen Bitvavo, Bitvavo als reserve voor crypto, FMP als reserve voor aandelen, ECB/Fed als marktnieuws.');

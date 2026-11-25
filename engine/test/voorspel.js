// Test: de dagvoorspelling wordt één keer per dag gemaakt (na 14:00), blijft binnen de regels en wordt na afloop nagekeken.
//   node test/voorspel.js
import assert from 'node:assert/strict';
import { geheugenDb } from '../db.js';
import { dagvoorspelling, kijkNa, beursAgenda, beoordeel } from '../voorspel.js';

const db = geheugenDb();
await db.saveState({ cash: 875, positions: { SPY: { qty: 0.2 } }, kosten: { usd: 1, eur: 0.93, usdEur: 0.93 } });
await db.upsertMarket([
  { symbol: 'SPY', name: 'S&P 500', kind: 'etf', price: 600, chg24h: 0.004 }, { symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', price: 80000, chg24h: -0.03 },
  { symbol: 'GLD', name: 'Goud', kind: 'etf', price: 200, chg24h: 0 },
]);
let prompt = '';
const llm = { verbruik: { usd: 0 }, vraagJson: async (p, o) => { prompt = p; opties = o; llm.verbruik.usd += 0.004; return {
  stemming: 'Voorzichtig positief.',
  voorspellingen: [{ thema: 0, asset: 'SPY', richting: 'OP', kans: 62, dagen: 2, reden: 'Rust keert terug.', bronnen: ['Angstmeter'] },
    { vooruit: 0, asset: 'BTC', richting: 'NEER', kans: 99, dagen: 30, reden: 'Uitstroom.', bronnen: ['Nieuws'] },
    { asset: 'XYZ', richting: 'OP', kans: 60, dagen: 3, reden: 'bestaat niet' }, { asset: 'GLD', richting: 'SCHUIN', kans: 60, dagen: 3 }],
  agenda: [{ datum: "2026-11-27", tekst: "Inflatiecijfer VS" }], themas: [{ onderwerp: "Handelsoorlog VS", keten: ["Hogere heffingen", "Duurdere spullen", "Inflatie hoger", "Aandelen omlaag"], winnaars: ["GLD", "NEPTICKER"], verliezers: ["SPY"], ingeprijsd: "Deels.", tegen: "Een deal.", effect: "Importheffingen drukken de beurs." }],
  vooruit: [{ gebeurtenis: "Rentebesluit Fed", datum: "2026-12-09", soort: "agenda", verwachting: "Markt rekent op gelijke rente.", vooraf: "Beleggers dekken zich in.", scenarios: [{ als: "Rente omlaag", kans: 30, keten: ["Verrassing", "Goedkoper lenen", "Crypto omhoog"], winnaars: ["BTC"] }, { als: "Rente gelijk", kans: 70, keten: ["Zoals verwacht", "Weinig beweging", "Crypto zakt licht"], verliezers: ["BTC"] }] }, { gebeurtenis: "zonder scenarios" }] }; } };
let opties;
const bronnen = { koppen: async () => [{ title: 'Bitcoin slides', publisher: 'CoinDesk' }], cijfers: async () => [], macro: async () => [], angst: async () => ({ waarde: 24, label: 'Extreme Fear' }) };

// 11:00 NL: nog niet
assert.equal((await dagvoorspelling({ db, llm, bronnen, nu: new Date('2026-11-25T10:00:00Z') })).reden, 'nog geen 14:00');
// 14:05 NL: wel
const r = await dagvoorspelling({ db, llm, bronnen, nu: new Date('2026-11-25T13:05:00Z') });
assert.equal(r.gemaakt, true); assert.equal(r.voorspellingen.length, 2, 'onbekende asset en rare richting eruit');
const btc = r.voorspellingen.find(v => v.asset === 'BTC');
assert.equal(btc.kans, 85, 'kans maximaal 85%'); assert.ok(new Date(btc.tot) - new Date('2026-11-25T13:05:00Z') <= 8 * 864e5, 'termijn maximaal 7 dagen');
assert.ok(prompt.includes('Thanksgiving'), 'beursfeestdag staat in de agenda');
assert.ok(db.data.dagvoorspelling[0].agenda.some(a => a.tekst.includes('Thanksgiving'))); assert.equal(db.data.dagvoorspelling[0].themas[0].onderwerp, 'Handelsoorlog VS'); assert.ok(prompt.includes('oorlogen') && prompt.includes('CEO'), 'kijkt naar de hele wereld');
assert.ok(Math.abs((await db.loadState()).kosten.usd - 1.004) < 1e-9, 'kosten meegeteld');
// tweede keer dezelfde dag: niet opnieuw
assert.equal((await dagvoorspelling({ db, llm, bronnen, nu: new Date('2026-11-25T15:00:00Z') })).reden, 'vandaag al gedaan');

// nakijken: SPY gestegen -> goed; BTC (nog niet verlopen) blijft open
await db.upsertMarket([{ symbol: 'SPY', name: 'S&P 500', kind: 'etf', price: 610 }]);
assert.equal(await kijkNa(db, new Date('2026-11-27T22:00:00Z')), 1);
assert.equal(db.data.voorspellingen.find(v => v.asset === 'SPY').uitkomst, 'goed');
assert.equal(db.data.voorspellingen.find(v => v.asset === 'BTC').uitkomst, null);
// 'gelijk' binnen de marge
assert.equal(beoordeel({ richting: 'GELIJK', startprijs: 100, marge: 0.015 }, 101).uitkomst, 'goed');
assert.equal(beoordeel({ richting: 'GELIJK', startprijs: 100, marge: 0.015 }, 103).uitkomst, 'fout');
assert.equal(beursAgenda(new Date('2026-11-25T13:00:00Z'), 7).length, 2, 'Thanksgiving + korte vrijdag');
// slimmer: eerst gevolgketens, Sonnet, keten aan de voorspelling gekoppeld, en lessen uit eerdere fouten
const spy = db.data.voorspellingen.find(v => v.asset === 'SPY');
assert.deepEqual(spy.keten, ['Hogere heffingen', 'Duurdere spullen', 'Inflatie hoger', 'Aandelen omlaag']); assert.equal(spy.thema, 'Handelsoorlog VS');
assert.deepEqual(db.data.dagvoorspelling[0].themas[0].winnaars, ['GLD'], 'alleen bestaande tickers');
assert.ok(prompt.includes('GEVOLGKETEN') && prompt.includes('ingeprijsd') && prompt.includes('TEGENARGUMENT'));
assert.match(opties.model, /sonnet/);
await dagvoorspelling({ db, llm, bronnen, nu: new Date('2026-11-28T13:05:00Z') });
assert.ok(prompt.includes('LESSEN VAN EERDER') && prompt.includes('SPY OP 62%: GOED'), 'leert van eerdere voorspellingen');
// vooruitkijken: aankomende gebeurtenissen met scenario's, voorspelling vóór de gebeurtenis
const dv = db.data.dagvoorspelling[0];
assert.equal(dv.vooruit.length, 1, 'gebeurtenis zonder scenario valt weg'); assert.equal(dv.vooruit[0].scenarios[1].kans, 70);
const btcV = db.data.voorspellingen.find(v => v.asset === 'BTC');
assert.ok(btcV.vooruit && btcV.thema === 'Vooruit: Rentebesluit Fed'); assert.deepEqual(btcV.keten, ['Zoals verwacht', 'Weinig beweging', 'Crypto zakt licht'], 'keten van het waarschijnlijkste scenario');
assert.ok(prompt.includes('VOOR DE GEBEURTENIS') || prompt.includes('VÓÓR DE GEBEURTENIS')); assert.ok(prompt.includes('VERRASSING'));
assert.ok(beursAgenda(new Date('2026-12-07T13:00:00Z'), 7).some(a => a.tekst.includes('Rentebesluit')), 'Fed-besluit in de agenda');
console.log('✅ Dagvoorspelling werkt: 1x per dag na 14:00, binnen de regels (50-85%, max 7 dagen), kosten geteld, en na afloop nagekeken.');

// Test: na een zitting komt er een uitleg in gewone taal (waarom + verwachting + plan) in de app en in de melding.
//   node test/uitleg.js
import assert from 'node:assert/strict';
import { uitlegPrompt, maakUitleg } from '../uitleg.js';
const info = { voorstel: { actie: 'KOOP', asset: 'BTC', bedrag: 100 }, uitkomst: 'AFGEWEZEN', voor: 3, nodig: 6, totaal: 10, naamVan: id => id,
  stemmen: [{ id: 'noor', stem: 'VOOR', reden: 'dip kopen' }, { id: 'mark', stem: 'TEGEN', reden: 'ETF-uitstroom houdt aan' }], koers: { price: 84000, chg24h: -0.03 }, vraag: 'moeten we in bitcoin?' };
const p = uitlegPrompt(info);
assert.ok(p.includes('ETF-uitstroom') && p.includes('moeten we in bitcoin') && p.includes('afgewezen'));
const u = await maakUitleg({ vraagJson: async () => ({ waarom: 'Te veel geld stroomt weg uit Bitcoin-fondsen.', verwachting: 'Eerst verder zakken.', plan: 'Opnieuw kijken als de uitstroom stopt.' }) }, info);
assert.equal(u.waarom, 'Te veel geld stroomt weg uit Bitcoin-fondsen.');
assert.equal(await maakUitleg({ vraagJson: async () => { throw new Error('stuk'); } }, info), null, 'een mislukte uitleg laat de zitting niet vallen');
console.log('✅ Uitleg in gewone taal werkt: waarom, verwachting en plan; een mislukking breekt niets.');

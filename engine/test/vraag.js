// Test: een vraag uit de app wordt opgepakt, start een zitting met de juiste aanleiding en focus, en het dagmaximum werkt.
//   node test/vraag.js
import assert from 'node:assert/strict';
import { geheugenDb } from '../db.js';
import { verwerkVraag, MAX_VRAGEN_PER_DAG } from '../vraag.js';
import { nieuwscheck } from '../nieuwscheck.js';

const db = geheugenDb(), nu = new Date('2026-11-24T15:00:00Z');   // dinsdag 16:00 NL: beurs open
let gestart = [];
const start = async a => { gestart.push(a); return { no: 7, uitkomst: 'AFGEWEZEN' }; };
db.data.verzoeken.push({ id: 1, t: nu.toISOString(), vraag: 'Moeten we investeren in goud?', status: 'wacht' });

// via de nieuwsreflex (die draait elke 5 minuten)
const r = await nieuwscheck({ db, start, nu, nieuws: async () => [] });
assert.equal(r.gestart, true);
assert.equal(gestart[0].aanleiding[0].soort, 'vraag');
assert.deepEqual(gestart[0].agenda.map(a => a.asset), ['GLD']);
assert.equal(db.data.verzoeken[0].status, 'klaar');
assert.equal(db.data.verzoeken[0].round_no, 7);

// zitting bezig: vraag wacht
db.data.rounds.push({ id: 9, status: 'bezig', started_at: nu.toISOString() });
db.data.verzoeken.push({ id: 2, vraag: 'bitcoin?', status: 'wacht' });
assert.equal((await verwerkVraag({ db, start, nu })).reden, 'zitting bezig');
db.data.rounds.pop();

// dagmaximum
for (let i = 0; i < MAX_VRAGEN_PER_DAG; i++) db.data.verzoeken.push({ id: 10 + i, vraag: 'x', status: 'klaar', behandeld_at: nu.toISOString() });
assert.equal((await verwerkVraag({ db, start, nu })).reden, 'dagmaximum');
assert.equal(db.data.verzoeken.find(v => v.id === 2).status, 'geweigerd');
// beurs dicht (dinsdag 10:00 NL) en de vraag gaat over goud: wachten tot de opening
const db2 = geheugenDb(); db2.data.verzoeken.push({ id: 1, vraag: 'Moeten we in goud investeren?', status: 'wacht' });
const w = await verwerkVraag({ db: db2, start, nu: new Date('2026-11-24T09:00:00Z') });
assert.equal(w.reden, 'beurs dicht'); assert.equal(db2.data.verzoeken[0].status, 'wacht');
// crypto kan altijd
db2.data.verzoeken[0].vraag = 'Is dit een goed moment voor Bitcoin?';
assert.equal((await verwerkVraag({ db: db2, start, nu: new Date('2026-11-24T09:00:00Z') })).gestart, true);
// een wachtende goud-vraag houdt een bitcoin-vraag niet tegen
const db3 = geheugenDb(); db3.data.verzoeken.push({ id: 1, vraag: 'Moeten we in Nvidia investeren?', status: 'wacht' }, { id: 2, vraag: 'Moeten we in bitcoin investeren?', status: 'wacht' });
gestart = [];
assert.equal((await verwerkVraag({ db: db3, start, nu: new Date('2026-11-24T09:00:00Z') })).gestart, true);
assert.equal(db3.data.verzoeken[1].status, 'klaar'); assert.equal(db3.data.verzoeken[0].status, 'wacht');
// inhalen: uurcheck overgeslagen -> de nieuwsreflex doet hem alsnog (na minuut 4), maar niet als hij net gedaan is
const db4 = geheugenDb(); await db4.saveState({ cash: 1000, positions: {}, laatsteCheck: { t: '2026-11-24T09:00:00Z' } });
let ingehaald = 0; const inhalen = async () => { ingehaald++; return { gestart: false, reden: 'rustig' }; };
await nieuwscheck({ db: db4, start, nu: new Date('2026-11-24T10:02:00Z'), nieuws: async () => [], inhalen });
assert.equal(ingehaald, 0, 'niet in de eerste minuten van het uur');
await nieuwscheck({ db: db4, start, nu: new Date('2026-11-24T10:05:00Z'), nieuws: async () => [], inhalen });
assert.equal(ingehaald, 1, 'wel na minuut 4 als de check van dit uur ontbreekt');
await db4.saveState({ cash: 1000, positions: {}, laatsteCheck: { t: '2026-11-24T10:05:00Z' } });
await nieuwscheck({ db: db4, start, nu: new Date('2026-11-24T10:10:00Z'), nieuws: async () => [], inhalen });
assert.equal(ingehaald, 1, 'niet als hij net gedaan is');
console.log('✅ Vragen aan de zaal werken: opgepakt binnen de nieuwsreflex, juiste focus (goud = GLD), wacht bij een lopende zitting, max', MAX_VRAGEN_PER_DAG, 'per dag.');

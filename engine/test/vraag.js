// Test: een vraag uit de app wordt opgepakt, start een zitting met de juiste aanleiding en focus, en het dagmaximum werkt.
//   node test/vraag.js
import assert from 'node:assert/strict';
import { geheugenDb } from '../db.js';
import { verwerkVraag, MAX_VRAGEN_PER_DAG } from '../vraag.js';
import { nieuwscheck } from '../nieuwscheck.js';

const db = geheugenDb(), nu = new Date('2026-11-24T09:00:00Z');
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
console.log('✅ Vragen aan de zaal werken: opgepakt binnen de nieuwsreflex, juiste focus (goud = GLD), wacht bij een lopende zitting, max', MAX_VRAGEN_PER_DAG, 'per dag.');

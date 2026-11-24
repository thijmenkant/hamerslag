// Test: de live voortgang (statusbalk) volgt de bronnen en de fases, en is na afloop weer leeg.
//   node test/voortgang.js
import assert from 'node:assert/strict';
import { geheugenDb } from '../db.js';
import { maakVoortgang } from '../voortgang.js';
import { meet, meld } from '../bronstatus.js';

const db = geheugenDb();
const vg = maakVoortgang(db, { fase: 'zitting', onderwerp: 'Jouw vraag: bitcoin?' });
const p = meet('coingecko', async () => [1, 2, 3], r => `${r.length} munten`);
assert.equal(db.data.live.stappen.length, 9);
await p; meld('bitvavo', true, { aantal: '200 markten' });
await meet('fred', async () => { throw new Error('stuk'); }).catch(() => {});
vg.zet({}); await new Promise(r => setTimeout(r, 20));
const st = id => db.data.live.stappen.find(s => s.id === id);
assert.equal(st('crypto').status, 'ok'); assert.equal(st('crypto').aantal, '3 munten');
assert.equal(st('fred').status, 'fout'); assert.equal(st('sec').status, 'wacht');
vg.bronnenKlaar(); await new Promise(r => setTimeout(r, 20));
assert.equal(db.data.live.bronnenKlaar, true); assert.equal(st('sec').status, 'overgeslagen');
await vg.stop();
assert.equal(db.data.live, null);
console.log('✅ Live voortgang werkt: bronnen per stap (ok, fout, overgeslagen), fase, en leeg na afloop.');

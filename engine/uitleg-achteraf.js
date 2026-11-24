// Eenmalig: zittingen die al geweest zijn alsnog een uitleg in gewone taal geven.
//   node uitleg-achteraf.js
import { maakDb } from './db.js';
import * as llm from './llm.js';
import { maakUitleg } from './uitleg.js';
import { CONFIG } from './config.js';

const db = maakDb();
const traders = Object.fromEntries((await db.loadTraders()).map(t => [t.id, t.name]));
const markt = await db.loadMarket();
let n = 0;
for (const r of await db.rondesMetVoorstel()) {
  const p = r.proposal;
  if (!p?.asset || (p.uitleg_kort && process.env.OPNIEUW !== '1') || r.votes_for == null) continue;
  const stemmen = (await db.berichtenVan(r.id, 'stem')).map(m => ({ id: m.trader_id, stem: m.action?.stem, reden: m.text }));
  if (!stemmen.length) continue;
  const vraag = (r.aanleiding || []).find(a => a.soort === 'vraag')?.tekst?.replace(/^vraag van de eigenaar: /, '');
  const { uitleg_kort, ...voorstel } = p;
  const uitleg = await maakUitleg(llm, { voorstel, uitkomst: r.outcome, voor: r.votes_for, nodig: p.uitPot ? CONFIG.potStemmen : CONFIG.stemmenNodig, totaal: stemmen.length,
    stemmen, naamVan: id => traders[id] || id, koers: markt.find(m => m.symbol === p.asset), aanleiding: r.aanleiding, vraag });
  if (!uitleg) { console.log(`zitting ${r.no}: geen uitleg gelukt`); continue; }
  await db.updateRound(r.id, { proposal: { ...p, uitleg_kort: uitleg } });
  const seq = Math.max(0, ...(await db.berichtenVan(r.id)).map(m => m.seq || 0)) + 1;
  await db.insertMessages([{ round_id: r.id, seq, phase: 'uitleg', trader_id: 'voorzitter', text: uitleg.waarom, action: uitleg, sources: [], created_at: new Date().toISOString() }]);
  console.log(`zitting ${r.no} (${p.actie} ${p.asset}, ${r.outcome}): ${uitleg.waarom}\n  verwachting: ${uitleg.verwachting}\n  plan: ${uitleg.plan}`);
  n++;
}
console.log(`${n} zitting(en) kregen een uitleg.`);

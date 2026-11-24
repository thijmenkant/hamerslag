// Vragen van de eigenaar: "moeten we in goud investeren?" vanuit de app.
// De app zet de vraag in de tabel 'verzoeken'; de nieuwsreflex (elke 5 minuten) pakt hem op en start een zitting.

import { ASSETS, KOPPELING, ZITTING, beursOpen, vindAsset } from './config.js';
import { ronde } from './run.js';
import { push } from './push.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const MAX_VRAGEN_PER_DAG = 5;

// Welke assets bedoelt de vraag? Op naam, ticker of trefwoord (goud -> GLD, olie -> XLE, ...)
export function assetsUitVraag(vraag) {
  const t = ` ${String(vraag).toLowerCase()} `;
  const gevonden = new Set();
  for (const a of ASSETS) {
    const sym = a.sym.toLowerCase();
    if (new RegExp(`[^a-z0-9]${sym.replace('.', '\\.')}[^a-z0-9]`).test(t) && sym.length >= 2) gevonden.add(a.sym);
    if (a.naam && a.naam.length > 3 && t.includes(a.naam.toLowerCase())) gevonden.add(a.sym);
  }
  for (const [sym, woorden] of Object.entries(KOPPELING)) {
    if (['CRYPTO', 'MARKT'].includes(sym)) continue;
    if (woorden.some(w => new RegExp(`[^a-z0-9]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(t))) gevonden.add(sym);
  }
  return [...gevonden].slice(0, 6);
}

export async function verwerkVraag({ db, start = ronde, nu = new Date() } = {}) {
  if (!db.wachtendeVragen) return { gestart: false };
  const wacht = await db.wachtendeVragen();
  if (!wacht.length) return { gestart: false };
  // De eerste vraag die nu kan: vragen over aandelen/ETF's wachten bij een dichte beurs, maar houden crypto-vragen niet tegen
  const kanNu = assets => !(assets.length && assets.every(a => vindAsset(a)?.soort !== 'crypto') && !beursOpen(nu));
  let v = null, assets = [];
  for (const w of wacht) {
    const a = assetsUitVraag(w.vraag);
    if (kanNu(a)) { v = w; assets = a; break; }
    if (!w.reden) await db.updateVraag(w.id, { reden: 'wacht tot de Amerikaanse beurs opent (15:30)', assets: a });
    log(`vraag: "${w.vraag}" gaat over ${a.join(', ')}, beurs dicht: wacht tot de opening`);
  }
  if (!v) return { gestart: false, reden: 'beurs dicht' };
  const rondes = await db.laatsteRondes();
  if (rondes.some(r => r.status === 'bezig' && (nu - new Date(r.started_at)) / 60000 < ZITTING.bezigMaxMin)) {
    log('vraag: er loopt al een zitting, de vraag wacht op de volgende beurt'); return { gestart: false, reden: 'zitting bezig' };
  }
  const vandaag = await db.vragenGestartSinds(new Date(nu.getTime() - 24 * 3600e3).toISOString());
  if (vandaag >= MAX_VRAGEN_PER_DAG) {
    await db.updateVraag(v.id, { status: 'geweigerd', reden: `Maximum van ${MAX_VRAGEN_PER_DAG} eigen zittingen per 24 uur bereikt`, behandeld_at: nu.toISOString() });
    log('vraag: dagmaximum bereikt, geweigerd'); return { gestart: false, reden: 'dagmaximum' };
  }
  await db.updateVraag(v.id, { status: 'gestart', behandeld_at: nu.toISOString(), assets });
  log(`VRAAG: "${v.vraag}"${assets.length ? ` (gaat over ${assets.join(', ')})` : ''}`);
  const aanleiding = [{ soort: 'vraag', tekst: `vraag van de eigenaar: ${v.vraag}` }];
  const agenda = assets.map(a => ({ asset: a, richting: 'KOOP', score: 0, waarom: 'genoemd in de vraag van de eigenaar' }));
  try {
    const uitslag = await start({ db, nu, aanleiding, agenda: agenda.length ? agenda : null });
    await db.updateVraag(v.id, { status: 'klaar', round_no: uitslag?.no ?? null, uitkomst: uitslag?.uitkomst ?? null });
    const U = { UITGEVOERD: 'aangenomen', AFGEWEZEN: 'afgewezen', 'GEEN VOORSTEL': 'geen voorstel' }[uitslag?.uitkomst] || String(uitslag?.uitkomst || 'klaar').toLowerCase();
    await push({ titel: `Jouw vraag: ${U}`, tekst: `"${v.vraag}"${uitslag?.voor != null ? ` · ${uitslag.voor} stemmen voor` : ''}. Tik om het debat terug te kijken.`, url: './#home', db });
    return { gestart: true, vraag: v, uitslag };
  } catch (e) {
    await db.updateVraag(v.id, { status: 'fout', reden: String(e.message).slice(0, 300) }).catch(() => {});
    throw e;
  }
}

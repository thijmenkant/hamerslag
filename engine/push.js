// Pushmeldingen naar je telefoon, van de Hamerslag-app zelf (Web Push).
// Je zet ze aan in de app (Bronnen → Meldingen); elk apparaat dat ze aanzette krijgt ze.
import { stuur } from './webpush.js';

let dbStandaard = null;
export function pushDb(db) { dbStandaard = db; }

export async function push({ titel, tekst, prio = 3, url = null, db = dbStandaard }) {
  try {
    if (!db?.pushAbonnementen) { const { maakDb } = await import('./db.js'); db = maakDb(); }
    const abos = await db.pushAbonnementen();
    if (!abos?.length) return false;
    const bericht = { titel, tekst, url: url || './', tag: titel.split(':')[0], urgent: prio >= 4 };
    let ok = 0;
    for (const a of abos) {
      const r = await stuur(a, bericht, { urgent: prio >= 4 });
      if (r === 'ok') ok++;
      if (r === 'weg') await db.verwijderAbonnement?.(a.endpoint).catch(() => {});   // telefoon heeft de meldingen uitgezet
    }
    return ok > 0;
  } catch { return false; } // een mislukte melding mag een ronde nooit laten mislukken
}

// Nieuwsreflex: draait elke 5 minuten, kost geen AI.
// Is er vers, groot nieuws over iets wat wij volgen? Dan direct een spoeddebat.

import { SPOED, ZITTING } from './config.js';
import { fetchNews } from './sources.js';
import { maakDb } from './db.js';
import { ronde } from './run.js';
import { verwerkVraag } from './vraag.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export async function nieuwscheck({ db = maakDb(), nieuws = () => fetchNews({ maxUren: 3, max: 60 }), start = ronde, nu = new Date(), inhalen = null } = {}) {
  // Eerst: heeft de eigenaar een vraag aan de zaal gesteld? Die gaat voor.
  try { const v = await verwerkVraag({ db, start, nu }); if (v.gestart) return v; }
  catch (e) { log('⚠ vraag mislukt:', e.message); }
  // Inhalen: is de uurcheck van dit uur overgeslagen (bijv. omdat er net een zitting was), dan doen we hem alsnog.
  // Niet in de eerste minuten van het uur, dan draait de gewone uurcheck van de wekker zelf nog.
  if (inhalen && nu.getUTCMinutes() >= 4) {
    const staat = await db.loadState().catch(() => null);
    const lc = staat?.laatsteCheck?.t;
    if (staat?.cash != null && (!lc || nu - new Date(lc) >= 55 * 60000)) {
      log(`nieuwscheck: de uurcheck van dit uur is nog niet gedaan (laatste ${lc ? Math.round((nu - new Date(lc)) / 60000) + ' min geleden' : 'nooit'}), nu inhalen`);
      const r = await inhalen({ db, start, nu });
      if (r?.reden !== 'net een zitting') return { ...r, ingehaald: true };
    }
  }
  const lijst = await nieuws();
  const grens = nu.getTime() - SPOED.maxLeeftijdMin * 60000;
  let kandidaten = lijst.filter(n => n.belang >= SPOED.drempel && n.assets.length && new Date(n.tijd).getTime() >= grens);
  if (!kandidaten.length) { log(`nieuwscheck: ${lijst.length} berichten, niets groots`); return { gestart: false, reden: 'geen groot nieuws' }; }

  const bekend = await db.bekendeUrls(kandidaten.map(n => n.url).filter(Boolean));
  kandidaten = kandidaten.filter(n => !bekend.has(n.url));
  if (!kandidaten.length) { log('nieuwscheck: groot nieuws is al besproken'); return { gestart: false, reden: 'al besproken' }; }

  // Tweede bron nodig: een andere uitgever moet over dezelfde asset berichten (laatste 3 uur)
  const bevestigd = n => lijst.some(m => m !== n && m.uitgever !== n.uitgever && m.assets.some(a => a !== 'MARKT' && n.assets.includes(a)) || (n.assets.includes('MARKT') && m !== n && m.uitgever !== n.uitgever && m.assets.includes('MARKT') && m.belang >= SPOED.drempel));
  const onbevestigd = kandidaten.filter(n => !bevestigd(n));
  kandidaten = kandidaten.filter(bevestigd);
  if (!kandidaten.length) { log(`nieuwscheck: groot nieuws maar nog maar 1 bron (${onbevestigd[0]?.uitgever}): wachten op bevestiging`); return { gestart: false, reden: 'wacht op tweede bron' }; }

  const rondes = await db.laatsteRondes();
  const minSinds = r => (nu - new Date(r.started_at)) / 60000;
  if (rondes.some(r => r.status === 'bezig' && minSinds(r) < ZITTING.bezigMaxMin)) { log('nieuwscheck: er loopt al een zitting, het nieuws gaat mee in de volgende'); return { gestart: false, reden: 'zitting bezig' }; }
  if (rondes[0] && minSinds(rondes[0]) < SPOED.rustNaRondeMin) { log('nieuwscheck: net een ronde gehad, het nieuws gaat mee in de volgende'); return { gestart: false, reden: 'net een ronde' }; }
  const spoeden = rondes.filter(r => r.spoed);
  if (spoeden[0] && minSinds(spoeden[0]) < SPOED.rustNaSpoedMin) { log('nieuwscheck: max 1 spoeddebat per uur'); return { gestart: false, reden: 'rustperiode' }; }
  if (spoeden.filter(r => minSinds(r) < 24 * 60).length >= SPOED.maxPerDag) { log('nieuwscheck: dagmaximum bereikt'); return { gestart: false, reden: 'dagmaximum' }; }

  const top = kandidaten[0];
  log(`SPOED: "${top.titel}" (${top.uitgever}, belang ${top.belang}, ${top.assets.join('/')})`);
  const uitslag = await start({ db, spoed: top, nu });
  return { gestart: true, nieuws: top, uitslag };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { zittingscheck } = await import('./zittingscheck.js');
  nieuwscheck({ inhalen: o => zittingscheck({ ...o, forceer: false, inhaal: true }) }).catch(e => { console.error('Nieuwscheck mislukt:', e.message); process.exit(1); });
}

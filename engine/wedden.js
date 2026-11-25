// Wedden op Polymarket met nepgeld, vanuit een aparte wedpot.
// - De dagvoorspelling stelt hooguit 2 weddenschappen per dag voor (alleen bij >= 10 procentpunt verschil met de markt).
// - Deze module plaatst ze (max €20 per stuk, max 5 open), werkt de prijzen bij en betaalt uit als een markt afloopt.
// - Draait in de nieuwscheck, nooit tijdens een zitting (die schrijft ook de staat weg).
import { CONFIG, ZITTING } from './config.js';
import { round2 } from './portfolio.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const KOSTEN = 0.01;          // 1% kosten per inzet (Polymarket rekent een kleine spread)
const VERS_MIN = 30;          // prijzen hooguit elke 30 minuten bijwerken
const lijst = s => { try { const a = typeof s === 'string' ? JSON.parse(s) : s; return Array.isArray(a) ? a : []; } catch { return []; } };

async function haalMarkt(id) {
  const r = await fetch(`https://gamma-api.polymarket.com/markets/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} Polymarket`);
  return r.json();
}

// Prijs van onze uitkomst (JA of NEE) en of de markt klaar is
export function standVan(m, uitkomst) {
  const namen = lijst(m?.outcomes), prijzen = lijst(m?.outcomePrices).map(Number);
  const ja = Math.max(0, namen.findIndex(o => /^yes$/i.test(o))), nee = namen.findIndex(o => /^no$/i.test(o));
  const pJa = prijzen[ja], pNee = nee >= 0 ? prijzen[nee] : 1 - pJa;
  const prijs = uitkomst === 'JA' ? pJa : pNee;
  const klaar = !!m?.closed && (prijs <= 0.01 || prijs >= 0.99);
  return { prijs: Number.isFinite(prijs) ? prijs : null, klaar, gewonnen: klaar && prijs >= 0.99 };
}

export function inzetVoor(verschil, pot) {
  const bedrag = verschil >= 20 ? CONFIG.maxPerWed : Math.round(CONFIG.maxPerWed / 2);
  return Math.min(bedrag, Math.floor(pot));
}

export async function wedRonde(db, { nu = new Date(), haal = haalMarkt, push = async () => {}, voorstellen = null } = {}) {
  const staat = await db.loadState();
  if (!staat) return { gedaan: false };
  const rondes = db.laatsteRondes ? await db.laatsteRondes().catch(() => []) : [];
  if (rondes.some(r => r.status === 'bezig' && (nu - new Date(r.started_at)) / 60000 < ZITTING.bezigMaxMin)) return { gedaan: false, reden: 'zitting bezig' };

  let veranderd = false;
  // 1. Wedpot aanmaken (eenmalig, uit de cash)
  if (!staat.wedden) {
    if (Number(staat.cash) < CONFIG.wedpot) return { gedaan: false, reden: 'niet genoeg cash voor de wedpot' };
    staat.cash = round2(staat.cash - CONFIG.wedpot);
    staat.wedden = { pot: CONFIG.wedpot, open: [], klaar: [], start: CONFIG.wedpot, sinds: nu.toISOString() };
    veranderd = true; log(`wedpot aangemaakt: €${CONFIG.wedpot}`);
  }
  const w = staat.wedden;

  // 2. Nieuwe weddenschappen van de dagvoorspelling van vandaag (één keer per dag)
  const dag = voorstellen ? { datum: 'test', wedden: voorstellen } : staat.wedVoorstellen ? { datum: staat.wedVoorstellen.datum, wedden: staat.wedVoorstellen.lijst } : null;
  const geplaatst = [];
  if (dag && w.geplaatstVoor !== dag.datum) {
    for (const v of dag.wedden || []) {
      if (w.open.length >= CONFIG.maxOpenWedden || w.open.some(x => x.id === v.id)) continue;
      let stand; try { stand = standVan(await haal(v.id), v.uitkomst); } catch { continue; }
      if (!stand.prijs || stand.klaar || stand.prijs >= 0.97 || stand.prijs <= 0.03) continue;
      const inzet = inzetVoor(v.verschil, w.pot);
      if (inzet < 5) continue;
      const aandelen = inzet * (1 - KOSTEN) / stand.prijs;
      w.pot = round2(w.pot - inzet);
      const wed = { id: v.id, slug: v.slug, vraag: v.vraag, uitkomst: v.uitkomst, onzeKans: v.onzeKans, marktKans: v.marktKans, reden: v.reden, einde: v.einde, inzet, instap: stand.prijs, prijs: stand.prijs, aandelen, sinds: nu.toISOString() };
      w.open.push(wed); geplaatst.push(wed);
    }
    w.geplaatstVoor = dag.datum; veranderd = true;
  }

  // 3. Prijzen bijwerken en uitbetalen (hooguit elke 30 minuten)
  const uitbetaald = [];
  if (w.open.length && (!w.bijgewerkt || (nu - new Date(w.bijgewerkt)) / 60000 >= VERS_MIN || geplaatst.length)) {
    for (const x of [...w.open]) {
      let stand; try { stand = standVan(await haal(x.id), x.uitkomst); } catch { continue; }
      if (stand.prijs != null) x.prijs = stand.prijs;
      if (!stand.klaar) continue;
      const opbrengst = round2(stand.gewonnen ? x.aandelen : 0);
      w.pot = round2(w.pot + opbrengst);
      w.open = w.open.filter(y => y !== x);
      const af = { ...x, opbrengst, gewonnen: stand.gewonnen, klaar: nu.toISOString() };
      w.klaar = [af, ...(w.klaar || [])].slice(0, 40); uitbetaald.push(af);
    }
    w.bijgewerkt = nu.toISOString(); veranderd = true;
  }

  if (veranderd) await db.saveState(staat);
  if (geplaatst.length) {
    log(`weddenschappen geplaatst: ${geplaatst.map(x => `${x.uitkomst} op "${x.vraag}" €${x.inzet}`).join(', ')}`);
    await push({ titel: `${geplaatst.length === 1 ? 'Weddenschap' : `${geplaatst.length} weddenschappen`} geplaatst`, tekst: geplaatst.map(x => `€${x.inzet} op ${x.uitkomst} bij: ${x.vraag} (wij ${x.uitkomst === 'JA' ? x.onzeKans : 100 - x.onzeKans}%, de markt ${x.uitkomst === 'JA' ? x.marktKans : 100 - x.marktKans}%)`).join(' · ').slice(0, 220), prio: 3 });
  }
  for (const x of uitbetaald) {
    log(`weddenschap afgelopen: "${x.vraag}" ${x.gewonnen ? `gewonnen, €${x.opbrengst}` : 'verloren'}`);
    await push({ titel: x.gewonnen ? `Weddenschap gewonnen: +€${round2(x.opbrengst - x.inzet)}` : `Weddenschap verloren: −€${x.inzet}`, tekst: x.vraag, prio: 3 });
  }
  return { gedaan: veranderd, geplaatst, uitbetaald };
}

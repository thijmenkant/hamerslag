// Na elke zitting: in gewone taal waarom er gekocht, verkocht of afgewezen is, en wat we verwachten.
// Eén goedkope AI-vraag (Haiku) die het hele debat samenvat. Mislukt hij, dan valt de zitting niet om.
import { CONFIG } from './config.js';

const pct = x => `${(x * 100).toFixed(0)}%`;

export function uitlegPrompt({ voorstel, uitkomst, voor, nodig, totaal, stemmen, naamVan, koers, aanleiding, vraag }) {
  const redenen = soort => stemmen.filter(s => (soort === 'VOOR') === (s.stem === 'VOOR') && s.reden).slice(0, 4).map(s => `- ${naamVan(s.id)}: ${s.reden}`).join('\n') || '- (geen)';
  return `Je bent Eva, voorzitter van Hamerslag: tien AI-traders die met nepgeld beleggen. Leg de eigenaar (een student, geen belegger) in gewone, korte Nederlandse taal uit wat er net besloten is. Spreek hem aan met "je". Geen vaktaal; moet je toch een woord als ETF gebruiken, leg het dan in een paar woorden uit.

ZITTING
Aanleiding: ${vraag ? `de eigenaar vroeg: "${vraag}"` : (aanleiding || []).map(a => a.tekst).join('; ') || 'gewone uurcheck'}
Wat is ${voorstel.asset}: ${koers?.name ? `${koers.name}${koers.kind ? ` (${koers.kind})` : ''}` : 'zie de naam hierboven'}
Voorstel: ${voorstel.actie} €${voorstel.bedrag} ${voorstel.asset}, ingediend door trader ${voorstel.door ? naamVan(voorstel.door) : 'een van de traders'}${voorstel.uitleg ? ` — onderbouwing: ${voorstel.uitleg}` : ''}
Koers nu: ${koers ? `${koers.price} (${koers.chg24h != null ? `${(koers.chg24h * 100).toFixed(1)}% in 24 uur` : 'verandering onbekend'})` : 'onbekend'}
Uitslag: ${uitkomst} met ${voor} van ${totaal} stemmen voor (${nodig} nodig)
Huisregels: we verkopen automatisch bij ${pct(CONFIG.stopLoss)} verlies (stop-loss) en pakken winst bij +${pct(CONFIG.winstDoel)}.

Redenen van de voorstemmers:
${redenen('VOOR')}
Redenen van de tegenstemmers:
${redenen('TEGEN')}

Belangrijk:
- Het voorstel kwam van een trader, niet van de eigenaar. Zeg dus nooit "je voorstel"; zeg "het voorstel" of noem de trader.
- Gebruik alleen feiten die hierboven staan. Verzin niets over wat een fonds of bedrijf is: gebruik de naam bij "Wat is". Weet je het niet zeker, laat het dan weg.
- Koersen van aandelen en fondsen zijn in dollars.

Geef ALLEEN JSON, zonder aanhalingstekens binnen je teksten:
{"waarom": "1 tot 2 zinnen: waarom ${uitkomst === 'UITGEVOERD' ? ({ KOOP: 'we dit gekocht hebben', VERKOOP: 'we dit verkocht hebben', SHORT: 'we hierop short zijn gegaan (inzetten op een daling)', DEKKEN: 'we deze short hebben gesloten' }[voorstel.actie] || 'we dit gedaan hebben') : 'het voorstel is afgewezen'}, met het belangrijkste argument",
 "verwachting": "1 tot 2 zinnen: wat we verwachten dat er de komende dagen of weken met deze koers gebeurt, en waarom. Wees eerlijk over onzekerheid",
 "melding": "1 korte zin van hoogstens 15 woorden voor een pushmelding: de kern van waarom, simpel",
 "plan": "1 zin: ${uitkomst === 'UITGEVOERD' && ['KOOP', 'SHORT'].includes(voorstel.actie) ? 'wanneer we verkopen of dekken (met de stop-loss en het winstdoel) of opnieuw kijken' : 'wanneer of onder welke voorwaarde we er opnieuw naar kijken'}"}`;
}

export async function maakUitleg(llm, info) {
  try {
    const j = await llm.vraagJson(uitlegPrompt(info), { maxTokens: 600, model: CONFIG.model });
    const schoon = t => String(t || '').trim().slice(0, 400);
    if (!j?.waarom) return null;
    return { waarom: schoon(j.waarom), verwachting: schoon(j.verwachting), plan: schoon(j.plan), melding: schoon(j.melding).slice(0, 160) || null };
  } catch { return null; }
}

// Een (vaak Engelse) nieuwskop omzetten naar één simpele Nederlandse zin, voor de melding bij een spoedzitting
export async function simpelNieuws(llm, titel) {
  try {
    const j = await llm.vraagJson(`Zet deze nieuwskop om naar één korte, simpele Nederlandse zin (hoogstens 15 woorden) voor iemand zonder beleggingskennis. Leg vaktermen kort uit of laat ze weg. Verzin niets.\n\nKop: ${titel}\n\nGeef ALLEEN JSON: {"zin": "..."}`, { maxTokens: 200, model: CONFIG.model });
    const z = String(j?.zin || '').trim();
    return z ? z.slice(0, 160) : null;
  } catch { return null; }
}

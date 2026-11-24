// Na elke zitting: in gewone taal waarom er gekocht, verkocht of afgewezen is, en wat we verwachten.
// Eén goedkope AI-vraag (Haiku) die het hele debat samenvat. Mislukt hij, dan valt de zitting niet om.
import { CONFIG } from './config.js';

const pct = x => `${(x * 100).toFixed(0)}%`;

export function uitlegPrompt({ voorstel, uitkomst, voor, nodig, totaal, stemmen, naamVan, koers, aanleiding, vraag }) {
  const redenen = soort => stemmen.filter(s => (soort === 'VOOR') === (s.stem === 'VOOR') && s.reden).slice(0, 4).map(s => `- ${naamVan(s.id)}: ${s.reden}`).join('\n') || '- (geen)';
  return `Je bent Eva, voorzitter van Hamerslag: tien AI-traders die met nepgeld beleggen. Leg de eigenaar (een student, geen belegger) in gewone, korte Nederlandse taal uit wat er net besloten is. Spreek hem aan met "je". Geen vaktaal; moet je toch een woord als ETF gebruiken, leg het dan in een paar woorden uit.

ZITTING
Aanleiding: ${vraag ? `de eigenaar vroeg: "${vraag}"` : (aanleiding || []).map(a => a.tekst).join('; ') || 'gewone uurcheck'}
Voorstel: ${voorstel.actie} €${voorstel.bedrag} ${voorstel.asset}${voorstel.uitleg ? ` — onderbouwing van de indiener: ${voorstel.uitleg}` : ''}
Koers nu: ${koers ? `${koers.price} (${koers.chg24h != null ? `${(koers.chg24h * 100).toFixed(1)}% in 24 uur` : 'verandering onbekend'})` : 'onbekend'}
Uitslag: ${uitkomst} met ${voor} van ${totaal} stemmen voor (${nodig} nodig)
Huisregels: we verkopen automatisch bij ${pct(CONFIG.stopLoss)} verlies (stop-loss) en pakken winst bij +${pct(CONFIG.winstDoel)}.

Redenen van de voorstemmers:
${redenen('VOOR')}
Redenen van de tegenstemmers:
${redenen('TEGEN')}

Geef ALLEEN JSON, zonder aanhalingstekens binnen je teksten:
{"waarom": "1 tot 2 zinnen: waarom ${uitkomst === 'UITGEVOERD' ? (voorstel.actie === 'KOOP' ? 'we dit gekocht hebben' : 'we dit verkocht hebben') : 'het voorstel is afgewezen'}, met het belangrijkste argument",
 "verwachting": "1 tot 2 zinnen: wat we verwachten dat er de komende dagen of weken met deze koers gebeurt, en waarom. Wees eerlijk over onzekerheid",
 "plan": "1 zin: ${uitkomst === 'UITGEVOERD' && voorstel.actie === 'KOOP' ? 'wanneer we verkopen (met de huisregels) of opnieuw kijken' : 'wanneer of onder welke voorwaarde we er opnieuw naar kijken'}"}`;
}

export async function maakUitleg(llm, info) {
  try {
    const j = await llm.vraagJson(uitlegPrompt(info), { maxTokens: 600, model: CONFIG.model });
    const schoon = t => String(t || '').trim().slice(0, 400);
    if (!j?.waarom) return null;
    return { waarom: schoon(j.waarom), verwachting: schoon(j.verwachting), plan: schoon(j.plan) };
  } catch { return null; }
}

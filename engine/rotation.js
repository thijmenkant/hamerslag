// Elke maand: de slechtste trader verlaat de zaal, een nieuwe komt erbij.
// Alleen als hij genoeg beoordeelde stemmen heeft én slechter scoort dan 50%
// (een muntje opgooien). Anders blijft iedereen zitten.

import { CONFIG } from './config.js';
import { LOOK_OPTIES } from './traders.js';
import { maandCode } from './portfolio.js';

export function kiesVertrekker(traders) {
  const kandidaten = traders
    .filter(t => t.active)
    .map(t => ({ t, n: (t.goed || 0) + (t.fout || 0), score: (t.goed || 0) / Math.max(1, (t.goed || 0) + (t.fout || 0)) }))
    .filter(x => x.n >= CONFIG.rotatie.minBeoordeeld && x.score < CONFIG.rotatie.maxScore)
    .sort((a, b) => a.score - b.score);
  return kandidaten[0] || null;
}

export const nieuweTraderPrompt = (vertrekker, zittend) => `Hamerslag, het AI-parlement (10 AI-traders die over een nep-portefeuille met crypto en aandelen debatteren) zoekt een nieuwe trader.
${vertrekker.name} (${vertrekker.role}) vertrekt na een score van ${Math.round(vertrekker.score * 100)}%.
Zittende traders: ${zittend.map(t => `${t.name} (${t.role})`).join(', ')}.

Bedenk een nieuwe professionele trader met een stijl die nog NIET in de zaal zit en die de groep sterker maakt (bijvoorbeeld een andere tijdshorizon, een ander soort bron of een andere risicohouding). Nederlandse voornaam die nog niet bestaat in de zaal.
Antwoord met precies dit JSON-formaat:
{"name":"...","role":"max 3 woorden","style":"2 zinnen over hoe hij of zij denkt","look":"${LOOK_OPTIES.look.join('|')}","glasses":true,"beard":false}`;

export function maakNieuweTrader(raw, bestaandeIds, model = 'haiku') {
  const kies = arr => arr[Math.floor(Math.random() * arr.length)];
  const name = String(raw?.name || 'Nieuwkomer').replace(/[^\p{L} -]/gu, '').slice(0, 20) || 'Nieuwkomer';
  let id = name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') || 'trader';
  while (bestaandeIds.includes(id)) id += Math.floor(Math.random() * 9);
  const look = LOOK_OPTIES.look.includes(raw?.look) ? raw.look : kies(LOOK_OPTIES.look);
  return {
    id, name, role: String(raw?.role || 'Trader').slice(0, 40), style: String(raw?.style || '').slice(0, 400),
    model, active: true, joined_at: new Date().toISOString(), goed: 0, fout: 0, voor: 0, tegen: 0, bronnen: 0,
    look: { bg: kies(LOOK_OPTIES.bg), skin: kies(LOOK_OPTIES.skin), hair: kies(LOOK_OPTIES.hair), shirt: kies(LOOK_OPTIES.shirt), tie: Math.random() < 0.3 ? kies(LOOK_OPTIES.shirt) : '', look, glasses: !!raw?.glasses, beard: !!raw?.beard, kleur: kies(LOOK_OPTIES.kleur) },
  };
}

export function isNieuweMaand(staat, nu = new Date()) { return staat.last_rotation !== maandCode(nu); }

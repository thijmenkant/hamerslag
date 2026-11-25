// Dagvoorspelling: elke middag (na 14:00 NL, vóór de Amerikaanse beurs opengaat) kijken de traders 1 tot 7 dagen vooruit.
// Alleen voorspellen, NIET handelen: zo meten we eerst of het iets oplevert (scorebord in de app, tab Voorspel).
// Eén goedkope AI-vraag per dag. Verlopen voorspellingen worden vanzelf nagekeken met de koers van dat moment.
import { CONFIG, MODELLEN, vindAsset, BEURS_DICHT, BEURS_KORT, RENTEBESLUIT } from './config.js';
import { fetchCijferkalender, fetchMacro, cijferTitel, macroTitel } from './extra.js';
import { fetchFearGreed } from './sources.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const RICHTINGEN = ['OP', 'NEER', 'GELIJK'];
export const MARGE = { crypto: 0.03, anders: 0.015 };   // 'blijft gelijk' = binnen ±3% (crypto) of ±1,5% (aandelen/ETF's)
const nlDatum = d => new Date(d.getTime() + 3600e3).toISOString().slice(0, 10);   // Nederlandse datum (winter)

// Vaste beursdagen van de komende week (feestdagen / korte dagen) voor de agenda
// De dagvoorspelling is één vraag per dag en moet echt nadenken over oorzaak en gevolg: daarom Sonnet (± 5 cent per dag).
export const VOORSPEL_MODEL = process.env.VOORSPEL_MODEL || MODELLEN.sonnet.id;

export function beursAgenda(nu, dagen = 7) {   // feestdagen, korte dagen en rentebesluiten
  const uit = [];
  for (let i = 0; i <= dagen; i++) {
    const d = new Date(nu.getTime() + i * 864e5).toISOString().slice(0, 10);
    if (BEURS_DICHT[d]) uit.push({ datum: d, tekst: `Amerikaanse beurs dicht (${BEURS_DICHT[d]})` });
    if (BEURS_KORT[d]) uit.push({ datum: d, tekst: `Amerikaanse beurs eerder dicht, om 19:00 (${BEURS_KORT[d]})` });
    if (RENTEBESLUIT[d]) uit.push({ datum: d, tekst: 'Rentebesluit van de Fed (20:00 Nederlandse tijd)' });
  }
  return uit;
}

export function voorspelPrompt({ nu, markt, koppen, agenda, macro, angst, lessen = [] }) {
  const regel = m => `${m.symbol} (${m.name}, ${m.kind}): prijs ${Number(m.price).toFixed(2)} · 24u ${m.chg24h != null ? (m.chg24h * 100).toFixed(1) + '%' : '?'} · 7d ${m.chg7d != null ? (m.chg7d * 100).toFixed(1) + '%' : '?'}${m.rsi != null ? ` · uur-RSI ${Math.round(m.rsi)}` : ''}${m.trend ? ` · uurtrend ${m.trend}` : ''}`;
  return `Je bent het onderzoeksteam van Hamerslag (10 AI-traders, nepgeld). Het is ${nu.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'full', timeStyle: 'short' })}.
Maak de DAGVOORSPELLING: kijk 1 tot 7 dagen vooruit. Je handelt NIET, je voorspelt alleen; later meten we of je gelijk had.

KIJK NAAR DE HELE WERELD, niet alleen naar koersen. Alles wat aandelen, crypto en grondstoffen kan bewegen telt mee:
- bedrijven: nieuwe of vertrekkende CEO's, overnames, rechtszaken, kwartaalcijfers, productlanceringen
- politiek: presidenten en regeringen, verkiezingen, importheffingen en handelsoorlogen, sancties, nieuwe wetten (ook voor crypto)
- oorlogen en conflicten: wat doen die met olie, gas, goud, defensie en de stemming?
- centrale banken: rente (Fed, ECB), inflatie, werkloosheid
- grondstoffen: olie, gas, goud, zilver, koper, landbouw
DENK ALS EEN ANALIST, IN OORZAAK EN GEVOLG. Werk in deze volgorde:
1. Kies de 2 tot 4 belangrijkste gebeurtenissen uit het nieuws en de agenda.
2. Maak per gebeurtenis een GEVOLGKETEN van 3 tot 4 stappen: gebeurtenis → direct gevolg → wat dat doet met geld, kosten of vraag → welke markt beweegt.
   Voorbeeld: Iran dreigt de Straat van Hormuz te sluiten → minder olie-aanvoer → olie duurder → oliebedrijven (XLE) omhoog, luchtvaart en transport omlaag, inflatie hoger → renteverlaging later → techaandelen onder druk.
   Voorbeeld: nieuwe CEO bij een bedrijf → beleggers verwachten een nieuwe koers → onzekerheid of vertrouwen → aandeel beweegt de dagen erna.
   Voorbeeld: hogere importheffingen VS → duurdere spullen → inflatie hoger → Fed wacht met renteverlaging → aandelen omlaag, dollar omhoog.
3. Benoem per keten WINNAARS en VERLIEZERS (tickers uit de lijst).
4. CHECK per keten: is het al ingeprijsd? Kijk naar de beweging van 24u en 7d. Is de koers al flink in die richting gegaan, dan is de kans op nog meer kleiner.
5. Bedenk het TEGENARGUMENT: wat kan de keten breken?
6. Pas DAARNA maak je voorspellingen, en elke voorspelling moet uit een van je ketens komen.

KIJK OOK VOORUIT: VOORSPEL VÓÓR DE GEBEURTENIS. Hier zit de echte voorsprong.
- Agenda: wat komt er de komende 7 dagen aan (rentebesluit, inflatiecijfer, kwartaalcijfers, beurs dicht)?
- Vroege signalen in het nieuws: dingen die nog NIET gebeurd zijn maar dichterbij komen. Denk aan dreigementen, oplopende spanning, onderhandelingen, verkiezingen, geruchten over een overname of een vertrekkende CEO, een deadline voor heffingen.
- Per aankomende gebeurtenis: wat verwacht de markt al? Koersen bewegen niet op het nieuws zelf, maar op de VERRASSING ten opzichte van die verwachting. Geef 2 scenario's (meevaller en tegenvaller of: het gebeurt en het gebeurt niet), met kans en gevolgketen.
- Wat beweegt er al VOOR de gebeurtenis (onrust vooraf, mensen die zich indekken)? Daar kun je op voorspellen.
- Verzin niets: alleen gebeurtenissen uit de agenda of het nieuws hierboven.

Wees eerlijk en bescheiden: markten zijn moeilijk te voorspellen. Een kans van 55% is al een mening; boven de 70% alleen met een heel sterke, concrete reden. Liever 3 goede voorspellingen dan 5 zwakke. Voorspel niet iets wat al gebeurd is: kijk naar wat er de komende dagen kan veranderen (agenda, trends die doorzetten of keren, stemming).

${lessen.length ? `LESSEN VAN EERDER (jouw voorspellingen die al zijn nagekeken; leer van je fouten, herhaal ze niet):
${lessen.map(l => `- ${l.asset} ${l.richting} ${l.kans}%: ${l.uitkomst === 'goed' ? 'GOED' : 'FOUT'} (werkelijk ${(Number(l.verandering) * 100).toFixed(1)}%). Reden was: ${String(l.reden || '').slice(0, 140)}`).join('\n')}

` : ''}LET OP: uur-RSI en uurtrend gaan over de laatste ± 14 uur, niet over dagen. Een uur-RSI van 0 of 100 betekent alleen dat de koers een paar uur dezelfde kant op ging (of stil stond omdat de beurs dicht was); het is GEEN bewijs dat iets oververkocht is of gaat herstellen. Leun er niet op en zet niet al je voorspellingen op dezelfde gok (bijvoorbeeld overal herstel).

KOERSEN (euro voor crypto, aandelen/ETF's in euro omgerekend):
${markt.map(regel).join('\n')}

NIEUWS VAN DE AFGELOPEN 24 UUR:
${koppen.map(k => `- ${k.title} (${k.publisher || 'nieuws'})`).join('\n') || '- (geen)'}

AGENDA KOMENDE 7 DAGEN:
${agenda.map(a => `- ${a.datum}: ${a.tekst}`).join('\n') || '- (niets bekend)'}

ECONOMIE (FRED): ${macro.map(macroTitel).join(' | ') || 'onbekend'}
STEMMING (Fear & Greed): ${angst ? `${angst.waarde}/100 (${angst.label})` : 'onbekend'}

Geef ALLEEN JSON, in gewoon Nederlands voor een student zonder beleggingskennis, zonder aanhalingstekens binnen je teksten:
{"stemming": "1 tot 2 zinnen: hoe staat de markt er vandaag voor",
 "themas": [{"onderwerp": "kort: de gebeurtenis (bijv. oorlog, president, CEO-wissel, rente)", "keten": ["gebeurtenis", "direct gevolg", "gevolg voor geld of vraag", "welke markt beweegt"], "winnaars": ["TICKER"], "verliezers": ["TICKER"], "ingeprijsd": "1 korte zin: is dit al in de koers verwerkt?", "tegen": "1 korte zin: wat kan de keten breken", "effect": "1 zin samenvatting"}],
 "vooruit": [{"gebeurtenis": "kort: wat komt eraan", "datum": "YYYY-MM-DD of leeg als onbekend", "soort": "agenda|signaal", "verwachting": "1 zin: wat de markt nu al verwacht", "scenarios": [{"als": "kort: wat er gebeurt", "kans": 0-100, "keten": ["stap", "stap", "markt beweegt"], "winnaars": ["TICKER"], "verliezers": ["TICKER"]}], "vooraf": "1 zin: wat er al beweegt voor het zover is"}],
 "voorspellingen": [{"thema": "nummer van het thema waar dit uit komt, vanaf 0", "vooruit": "of: nummer van de aankomende gebeurtenis waar dit uit komt, vanaf 0", "asset": "TICKER uit de lijst hierboven", "richting": "OP|NEER|GELIJK", "kans": 50-85, "dagen": 1-7, "reden": "1 tot 2 zinnen waarom, en wat het kan omgooien", "bronnen": ["korte naam van 1 tot 3 bronnen, bijv. Agenda, Nieuws, Angstmeter, RSI"]}],
 "agenda": [{"datum": "YYYY-MM-DD", "tekst": "korte uitleg in gewone taal van een belangrijke gebeurtenis uit de agenda hierboven"}]}
3 tot 5 voorspellingen, verschillende assets, waar het kan ook grondstoffen (GLD goud, SLV zilver, USO olie, UNG gas, CPER koper, DBA landbouw). Thema's: 2 tot 4, alleen uit het nieuws en de agenda hierboven, niets verzinnen; elke stap in de keten hooguit 8 woorden. Vooruit: 1 tot 3 aankomende gebeurtenissen, elk met precies 2 scenario's waarvan de kansen samen 100 zijn; minstens 1 voorspelling komt uit een aankomende gebeurtenis als die er is. Agenda: hoogstens 5 punten, alleen uit de agenda hierboven.`;
}

// Een voorspelling netjes maken (of weggooien als hij niet klopt)
export function schoonVoorspelling(v, markt, nu) {
  const m = markt.find(x => x.symbol === String(v.asset || '').toUpperCase());
  if (!m || !(Number(m.price) > 0) || !RICHTINGEN.includes(v.richting)) return null;
  const dagen = Math.min(7, Math.max(1, Math.round(Number(v.dagen) || 3)));
  const tot = new Date(nu.getTime() + dagen * 864e5); tot.setUTCHours(21, 0, 0, 0);   // na de slotbel in New York
  return {
    asset: m.symbol, naam: m.name, richting: v.richting, kans: Math.min(85, Math.max(50, Math.round(Number(v.kans) || 55))),
    reden: String(v.reden || '').slice(0, 400), bronnen: (Array.isArray(v.bronnen) ? v.bronnen : []).slice(0, 3).map(b => String(b).slice(0, 40)),
    startprijs: Number(m.price), marge: m.kind === 'crypto' ? MARGE.crypto : MARGE.anders, tot: tot.toISOString(),
  };
}

export function beoordeel(v, prijs) {
  const r = prijs / Number(v.startprijs) - 1;
  const goed = v.richting === 'OP' ? r > 0 : v.richting === 'NEER' ? r < 0 : Math.abs(r) <= Number(v.marge);
  return { uitkomst: goed ? 'goed' : 'fout', eindprijs: prijs, verandering: r };
}

// Verlopen voorspellingen nakijken met de koers van nu
export async function kijkNa(db, nu = new Date()) {
  if (!db.openVoorspellingen) return 0;
  const open = (await db.openVoorspellingen()).filter(v => new Date(v.tot) <= nu);
  if (!open.length) return 0;
  const prijzen = Object.fromEntries((await db.loadMarket()).map(m => [m.symbol, Number(m.price)]));
  let n = 0;
  for (const v of open) {
    const p = prijzen[v.asset]; if (!(p > 0)) continue;
    await db.updateVoorspelling(v.id, { ...beoordeel(v, p), beoordeeld_at: nu.toISOString() });
    n++;
  }
  if (n) log(`voorspellingen nagekeken: ${n}`);
  return n;
}

// Maak de dagvoorspelling (één keer per dag, na 14:00 Nederlandse tijd)
export async function dagvoorspelling({ db, llm, nu = new Date(), forceer = false, bronnen = {} } = {}) {
  await kijkNa(db, nu).catch(e => log('⚠ nakijken mislukt:', e.message));
  const datum = nlDatum(nu), uurNL = (nu.getUTCHours() + 1) % 24;
  if (!forceer && uurNL < 14) return { gemaakt: false, reden: 'nog geen 14:00' };
  if (!db.heeftDagvoorspelling || (await db.heeftDagvoorspelling(datum))) return { gemaakt: false, reden: 'vandaag al gedaan' };
  const staat = await db.loadState();
  if (staat?.kosten?.gestopt) return { gemaakt: false, reden: 'budget op' };

  const alle = await db.loadMarket();
  const bezit = Object.keys(staat?.positions || {});
  const basis = ['SPY', 'QQQ', 'GLD', 'SLV', 'USO', 'UNG', 'CPER', 'DBA', 'TLT', 'XLE', 'BTC', 'ETH', 'SOL', 'NVDA', 'AAPL', 'MSFT', 'TSLA'];
  const bewegers = [...alle].filter(m => m.chg24h != null).sort((a, b) => Math.abs(b.chg24h) - Math.abs(a.chg24h)).slice(0, 6).map(m => m.symbol);
  const focus = new Set([...bezit, ...basis, ...bewegers]);
  const markt = alle.filter(m => focus.has(m.symbol) && Number(m.price) > 0);
  const veilig = async (fn, standaard) => { try { return await fn(); } catch { return standaard; } };
  const [koppen, cijfers, macro, angst] = await Promise.all([
    veilig(() => (bronnen.koppen || db.recenteKoppen)(new Date(nu - 24 * 3600e3).toISOString()), []),
    veilig(() => (bronnen.cijfers || fetchCijferkalender)({ nu, dagen: 7 }), []),
    veilig(() => (bronnen.macro || fetchMacro)(), []),
    veilig(() => (bronnen.angst || fetchFearGreed)(), null),
  ]);
  const agendaIn = [...beursAgenda(nu), ...cijfers.slice(0, 12).map(c => ({ datum: c.datum, tekst: cijferTitel(c) }))].sort((a, b) => a.datum.localeCompare(b.datum));

  const usdStart = llm.verbruik?.usd || 0;
  const lessen = await veilig(() => db.nagekekenVoorspellingen ? db.nagekekenVoorspellingen(new Date(nu - 14 * 864e5).toISOString()) : [], []);
  const j = await llm.vraagJson(voorspelPrompt({ nu, markt, koppen: koppen.slice(0, 40), agenda: agendaIn, macro, angst, lessen: lessen.slice(0, 15) }), { maxTokens: 5000, model: VOORSPEL_MODEL });
  const tickers = new Set(markt.map(m => m.symbol)), lijstT = x => (Array.isArray(x) ? x : []).map(String).filter(t => tickers.has(t)).slice(0, 4);
  const themas = (Array.isArray(j.themas) ? j.themas : []).filter(x => x?.onderwerp).slice(0, 4).map(x => ({
    onderwerp: String(x.onderwerp).slice(0, 80), effect: String(x.effect || '').slice(0, 240),
    keten: (Array.isArray(x.keten) ? x.keten : []).map(k => String(k).slice(0, 70)).filter(Boolean).slice(0, 5),
    winnaars: lijstT(x.winnaars), verliezers: lijstT(x.verliezers),
    ingeprijsd: String(x.ingeprijsd || '').slice(0, 160), tegen: String(x.tegen || '').slice(0, 160) }));
  const vooruit = (Array.isArray(j.vooruit) ? j.vooruit : []).filter(x => x?.gebeurtenis).slice(0, 3).map(x => ({
    gebeurtenis: String(x.gebeurtenis).slice(0, 90), datum: /^\d{4}-\d{2}-\d{2}$/.test(x.datum || '') ? x.datum : null, soort: x.soort === 'signaal' ? 'signaal' : 'agenda',
    verwachting: String(x.verwachting || '').slice(0, 200), vooraf: String(x.vooraf || '').slice(0, 200),
    scenarios: (Array.isArray(x.scenarios) ? x.scenarios : []).slice(0, 2).map(c => ({ als: String(c.als || '').slice(0, 90), kans: Math.max(0, Math.min(100, Math.round(Number(c.kans) || 50))),
      keten: (Array.isArray(c.keten) ? c.keten : []).map(k => String(k).slice(0, 70)).filter(Boolean).slice(0, 4), winnaars: lijstT(c.winnaars), verliezers: lijstT(c.verliezers) })).filter(c => c.als) }))
    .filter(x => x.scenarios.length);
  const lijst = (j?.voorspellingen || []).map(v => {
    const s = schoonVoorspelling(v, markt, nu); if (!s) return null;
    const t = v.thema != null && v.thema !== '' ? themas[Number(v.thema)] : null, f = v.vooruit != null && v.vooruit !== '' ? vooruit[Number(v.vooruit)] : null;
    if (f) { const sc = [...f.scenarios].sort((a, b) => b.kans - a.kans)[0]; s.thema = `Vooruit: ${f.gebeurtenis}`; s.keten = sc?.keten || []; s.vooruit = true; }
    else if (t) { s.keten = t.keten; s.thema = t.onderwerp; }
    return s;
  }).filter(Boolean);
  const gezien = new Set(); const uniek = lijst.filter(v => !gezien.has(v.asset) && gezien.add(v.asset)).slice(0, 5);
  if (!uniek.length) throw new Error('geen bruikbare voorspellingen');
  const agenda = [...beursAgenda(nu).map(a => ({ ...a, vast: true })), ...(Array.isArray(j.agenda) ? j.agenda : []).filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a?.datum)).map(a => ({ datum: a.datum, tekst: String(a.tekst || '').slice(0, 160) }))]
    .filter((a, i, l) => l.findIndex(b => b.datum === a.datum && b.tekst === a.tekst) === i).sort((a, b) => a.datum.localeCompare(b.datum)).slice(0, 7);

  // kosten meetellen in de kostenmeter (vers geladen staat, zodat er niets overschreven wordt)
  const extra = (llm.verbruik?.usd || 0) - usdStart;
  if (extra > 0 && db.saveState) {
    const st = await db.loadState();
    if (st?.kosten) { st.kosten.usd = (st.kosten.usd || 0) + extra; st.kosten.eur = Math.round(st.kosten.usd * (st.kosten.usdEur || 0.93) * 100) / 100; await db.saveState(st); }
  }
  await db.insertDagvoorspelling({ datum, t: nu.toISOString(), stemming: String(j.stemming || '').slice(0, 400), agenda, themas, vooruit });
  await db.insertVoorspellingen(uniek.map(v => ({ ...v, datum, t: nu.toISOString() })));
  log(`dagvoorspelling ${datum}: ${uniek.map(v => `${v.asset} ${v.richting} ${v.kans}%`).join(', ')}`);
  return { gemaakt: true, datum, voorspellingen: uniek };
}

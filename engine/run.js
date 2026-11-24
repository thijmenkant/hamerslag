import { maakVoortgang } from './voortgang.js';
import { maakUitleg } from './uitleg.js';
import { bewaarIn } from './bronstatus.js';
// Eén zitting van Hamerslag. Wordt gestart door de uurcheck (zittingscheck.js) of de nieuwsreflex.
//   node run.js            → echte ronde (met sleutels uit de omgeving)
//   DRY_RUN=1 node run.js  → oefenronde zonder internet en zonder database

import { CONFIG, SYMS, RADAR_MAX, vindAsset, env, MODELLEN, START_MODEL } from './config.js';
import { push as pushEcht } from './push.js';
import { START_TRADERS } from './traders.js';
import { verzamelBronnen, maakPakket } from './sources.js';
import { indicatoren, nieuweStaat, waarde, benchWaarde, beoordeel, voerUit, magHandelen, maandCode, round2, vangnetten } from './portfolio.js';
import { context, pitchPrompt, radarVan, stemPrompt, stemPromptEnkel, controleerVoorstellen, kiesVoorstel, controleerDebat, controleerStemmen, bedragUitStemmen, cijferCheck, controlePrompt, verwerkControle, debatVast, debatDeelPrompt, evaPrompt, controleerEva } from './debate.js';
import { kiesVertrekker, nieuweTraderPrompt, maakNieuweTrader, isNieuweMaand } from './rotation.js';
import { maakDb } from './db.js';
import { haalDividendData, verwerkDividend, verwerkStaking, dividendInfo } from './dividend.js';
import * as llmEcht from './llm.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function ronde({ db = maakDb(), bronnen = verzamelBronnen, llm = llmEcht, beurtPauze = Number(env('TURN_DELAY_MS', 2500)), nu = new Date(), spoed = null, push = pushEcht, dividendData = haalDividendData, aanleiding = null, agenda = null } = {}) {
  log(`Hamerslag ${spoed ? 'SPOEDZITTING' : 'ronde'} start (opslag: ${db.soort}, model: ${CONFIG.model})`);

  // 1. Traders en markt laden
  let traders = await db.loadTraders();
  if (!traders.length) {
    await db.upsertTraders(START_TRADERS.map(t => ({ ...t, active: true, goed: 0, fout: 0, voor: 0, tegen: 0, bronnen: 0 })));
    traders = await db.loadTraders();
    log('10 starttraders aangemaakt');
  }
  const markt = Object.fromEntries((await db.loadMarket()).map(m => [m.symbol, m]));

  // 2. Bronnen ophalen (met live voortgang voor de statusbalk in de app)
  const vraagA = aanleiding?.find(a => a.soort === 'vraag');
  const vg = maakVoortgang(db, { fase: 'zitting', spoed: !!spoed, onderwerp: vraagA ? vraagA.tekst.replace(/^vraag van de eigenaar: /, 'Jouw vraag: ') : spoed ? spoed.titel : (aanleiding || []).filter(a => a.soort !== 'agenda').map(a => a.tekst).join(' · ') });
  const ruw = await bronnen({ bezit: Object.keys((await db.loadState())?.positions || {}), focus: [...(agenda || []).map(k => k.asset), ...(spoed?.assets || [])], nu });
  ruw.fouten.forEach(f => log('⚠ bron mislukt:', f));
  if (spoed && !ruw.nieuws.some(n => n.url === spoed.url)) ruw.nieuws.unshift(spoed);
  if (!ruw.koersen.length) { await vg.stop(); throw new Error('Geen enkele koers opgehaald, ronde afgebroken.'); }
  vg.bronnenKlaar();
  const prijzen = { ...Object.fromEntries(Object.values(markt).map(m => [m.symbol, Number(m.price)])), ...Object.fromEntries(ruw.koersen.map(k => [k.sym, k.prijs])) };

  // Koersgeschiedenis bijwerken (1 punt per ronde) en indicatoren berekenen
  const ind = {};
  const marktRows = ruw.koersen.map(k => {
    const a = vindAsset(k.sym) || { naam: k.naam, soort: k.soort };
    const hist = [...(markt[k.sym]?.history || []), round2(k.prijs * 1e4) / 1e4].slice(-CONFIG.historiePunten);
    ind[k.sym] = indicatoren(hist);
    return { symbol: k.sym, name: k.naam || a.naam, kind: k.soort || a.soort, cat: a.cat || (k.soort === 'crypto' ? 'crypto' : null), rank: k.rank ?? a.rank ?? null, price: k.prijs, chg1h: fin(k.chg1h), chg24h: fin(k.chg24h), chg7d: fin(k.chg7d), source: k.bron, url: k.url, updated_at: k.tijd, history: hist, rsi: ind[k.sym].rsi ?? null, trend: ind[k.sym].trend ?? null };
  });
  await db.upsertMarket(marktRows);
  const radar = kiesRadar(ruw, await db.loadState(), spoed, agenda);
  const pakket = maakPakket(ruw, ind, radar);
  log(`bronnenpakket: ${pakket.length} bronnen (${ruw.nieuws.length} nieuws), radar: ${radar.join(' ')}`);

  // 3. Portefeuille laden, oude stemmen beoordelen
  let staat = await db.loadState();
  if (!staat) { staat = nieuweStaat(prijzen); log('nieuwe portefeuille met €1.000 nepgeld'); }
  for (const s of SYMS) if (!staat.bench?.[s] && prijzen[s]) (staat.bench ||= {})[s] = prijzen[s];

  // 3b. Kostenmeter: harde stop op het maandbudget, spaarstand vanaf 70%
  const maand = maandCode(nu);
  if (staat.kosten?.maand !== maand) staat.kosten = { maand, usd: 0, eur: 0 };
  staat.kosten.usdEur = ruw.usdEur?.koers || staat.kosten.usdEur || 0.93;
  staat.kosten.budget = CONFIG.budgetEur;
  if (staat.kosten.eur >= CONFIG.budgetEur) {
    if (!staat.kosten.gestopt) { staat.kosten.gestopt = true; await push({ titel: 'Hamerslag gepauzeerd', tekst: `Het maandbudget van €${CONFIG.budgetEur} is op (€${staat.kosten.eur.toFixed(2)}). Volgende maand gaat het vanzelf verder.`, prio: 5, tags: ['money_with_wings'] }); }
    bewaarIn(staat); await db.saveState(staat);
    log(`budget op: €${staat.kosten.eur.toFixed(2)} van €${CONFIG.budgetEur}, geen ronde`);
    await vg.stop();
    return { uitkomst: 'BUDGET' };
  }
  const spaarstand = staat.kosten.eur >= CONFIG.budgetEur * CONFIG.spaarstandVanaf;

  // 3c. Dividend en staking: extra opbrengsten naast koerswinst
  try { const dd = await dividendData(staat, nu); (dd?.fouten || []).forEach(f => log('⚠ dividend:', f)); }
  catch (e) { log('⚠ dividenddata mislukt:', e.message); }
  const stakingEur = verwerkStaking(staat, prijzen, nu);
  const dividendBetaald = verwerkDividend(staat, prijzen, ruw.usdEur?.koers || staat.kosten.usdEur || 0.93, nu);
  if (stakingEur > 0.005) log(`staking: +€${stakingEur.toFixed(3)}`);
  for (const d of dividendBetaald) { log(`dividend ${d.sym}: +€${d.eur}`); await push({ titel: `Dividend: €${d.eur.toFixed(2)} van ${d.sym}`, tekst: `Na 15% dividendbelasting in de dividendpot (nu €${staat.pot.toFixed(2)}).`, prio: 3, tags: ['moneybag'] }); }
  for (const d of dividendInfo(staat, radar, nu)) {
    pakket.push({ id: `B${pakket.length + 1}`, kind: 'dividend', publisher: d.soort === 'exact' ? 'Financial Modeling Prep' : 'Finnhub (schatting)', title: d.tekst, url: d.soort === 'exact' ? `https://financialmodelingprep.com/financial-summary/${d.sym}` : `https://finnhub.io/quote/${d.sym}`, published_at: nu.toISOString(), data: { sym: d.sym } });
  }
  const startUsd = llm.verbruik?.usd || 0;
  const boekKosten = async () => {
    staat.kosten.usd += (llm.verbruik?.usd || 0) - startUsd;
    staat.kosten.eur = Math.round(staat.kosten.usd * staat.kosten.usdEur * 100) / 100;
    if (!staat.kosten.gemeld70 && staat.kosten.eur >= CONFIG.budgetEur * CONFIG.spaarstandVanaf) {
      staat.kosten.gemeld70 = true;
      await push({ titel: 'Spaarstand aan', tekst: `AI-kosten deze maand: €${staat.kosten.eur.toFixed(2)} van €${CONFIG.budgetEur}. Opus-traders stemmen nu met Sonnet.`, prio: 4, tags: ['warning'] });
    }
  };
  const stats = {};
  const beoordeeld = beoordeel(staat, prijzen, stats, nu.getTime());
  if (beoordeeld.length) log(`${beoordeeld.length} eerdere besluiten beoordeeld`);

  // 4. Maandelijkse wissel
  let actief = traders.filter(t => t.active);
  const wissel = [];
  if (isNieuweMaand(staat, nu)) {
    const merged = actief.map(t => ({ ...t, goed: (t.goed || 0) + (stats[t.id]?.goed || 0), fout: (t.fout || 0) + (stats[t.id]?.fout || 0) }));
    const weg = kiesVertrekker(merged);
    if (weg) {
      const raw = await llm.vraagJson(nieuweTraderPrompt({ ...weg.t, score: weg.score }, actief.filter(t => t.id !== weg.t.id)), { maxTokens: 500 });
      const nieuw = maakNieuweTrader(raw, traders.map(t => t.id), weg.t.model || START_MODEL[weg.t.id] || 'haiku');
      await db.upsertTraders([{ id: weg.t.id, active: false, left_at: nu.toISOString(), left_reason: `Score ${Math.round(weg.score * 100)}% na ${weg.n} beoordelingen` }, nieuw]);
      actief = [...actief.filter(t => t.id !== weg.t.id), nieuw];
      wissel.push(`${weg.t.name} verlaat de zaal (${Math.round(weg.score * 100)}%). Welkom ${nieuw.name}, ${nieuw.role}!`);
      await push({ titel: 'Maandwissel', tekst: wissel[0], prio: 3, tags: ['arrows_counterclockwise'] });
      log('maandwissel:', wissel[0]);
    }
    staat.last_rotation = maandCode(nu);
  }

  // 5. Ronde aanmaken
  const no = (await db.lastRoundNo()) + 1;
  const round = await db.createRound({ no, started_at: nu.toISOString(), status: 'bezig', phase: 'analyse', spoed: spoed ? { titel: spoed.titel, url: spoed.url, uitgever: spoed.uitgever, tijd: spoed.tijd, assets: spoed.assets, belang: spoed.belang } : null, aanleiding: aanleiding?.length || agenda?.length ? [...(aanleiding || []), ...(vraagA ? [] : agenda || []).map(k => ({ soort: 'agenda', tekst: `kans: ${k.asset} ${k.richting.toLowerCase()} (${k.score}/10)` }))] : null });
  await db.insertSources(pakket.map(b => ({ round_id: round.id, ...b })));
  await db.insertHeadlines(ruw.nieuws.filter(n => n.url).map(n => ({ round_id: round.id, title: n.titel, publisher: n.uitgever, url: n.url, published_at: n.tijd, category: n.categorie, importance: n.belang })));
  let seq = 0;
  const msg = (phase, extra) => ({ round_id: round.id, seq: ++seq, phase, created_at: new Date().toISOString(), sources: [], ...extra });
  // Vangnetten eerst: stop-loss en winstdoel (zonder debat)
  for (const v of vangnetten(staat, prijzen, nu)) {
    await db.insertTrade({ round_id: round.id, t: nu.toISOString(), actie: 'VERKOOP', asset: v.asset, bedrag: v.bedrag, prijs: v.prijs, qty: v.qty, fee: v.fee, votes_for: null });
    await db.insertMessages([msg('systeem', { text: `${v.reden === 'stop-loss' ? 'Stop-loss' : 'Winstdoel'}: ${v.asset} automatisch verkocht voor €${v.bedrag} (${(v.resultaat * 100).toFixed(1)}%).`, action: { vangnet: v.reden, asset: v.asset } })]);
    log(`vangnet ${v.reden}: ${v.asset} verkocht`);
    await push({ titel: v.reden === 'stop-loss' ? `Stop-loss: ${v.asset} verkocht` : `Winst gepakt: ${v.asset} verkocht`, tekst: `€${v.bedrag} (${(v.resultaat * 100).toFixed(1)}%), automatisch zonder debat.`, prio: 4, tags: [v.reden === 'stop-loss' ? 'chart_with_downwards_trend' : 'moneybag'] });
  }
  if (spoed) await push({ titel: 'Spoedzitting', tekst: `${spoed.titel} (${spoed.uitgever || 'nieuws'})`, prio: 4, tags: ['rotating_light'] });
  await db.insertMessages([
    ...(spoed ? [msg('systeem', { text: `SPOEDZITTING: ${spoed.titel}`, action: { spoed: true, titel: spoed.titel, url: spoed.url, uitgever: spoed.uitgever, assets: spoed.assets } })] : []),
    msg('systeem', { text: `Ronde ${no} geopend. ${pakket.length} bronnen geladen.` }),
    ...(round.aanleiding?.length ? [msg('systeem', { text: `Aanleiding: ${round.aanleiding.map(a => a.tekst).join(' · ')}`, action: { aanleiding: round.aanleiding } })] : []),
    ...wissel.map(w => msg('systeem', { text: w })),
    ...dividendBetaald.map(d => msg('systeem', { text: `Dividend ontvangen: €${d.eur.toFixed(2)} van ${d.sym} (na 15% belasting), apart gezet in de dividendpot.`, action: { dividend: d } })),
  ]);

  const recent = (await db.recentRounds(4)).map(r => `ronde ${r.no}: ${r.proposal ? `${r.proposal.actie} €${r.proposal.bedrag} ${r.proposal.asset}` : 'geen voorstel'} → ${r.outcome}${r.votes_for != null ? ` (${r.votes_for} voor)` : ''}`);
  const spoedBron = spoed && pakket.find(b => b.url === spoed.url);
  const ctx = context({ traders: actief, pakket, staat, prijzen, recent }) + (spoedBron ? `\n\nSPOEDZITTING: deze ronde is extra ingelast vanwege net binnengekomen nieuws: [${spoedBron.id}] ${spoedBron.title} (${spoedBron.publisher}). Het raakt: ${spoed.assets.includes('MARKT') ? 'de hele markt' : spoed.assets.join(', ')}. Bespreek eerst wat dit nieuws betekent: is het goed of slecht nieuws, overdrijft de markt, zit het al in de koers? Kopen, verkopen of niks doen is allemaal mogelijk.` : '');
  const vraag = aanleiding?.find(a => a.soort === 'vraag');
  const ctxAanleiding = (vraag ? `\n\nDEZE ZITTING IS AANGEVRAAGD DOOR DE EIGENAAR met de vraag: "${vraag.tekst.replace(/^vraag van de eigenaar: /, '')}". Beantwoord die vraag als parlement: doe een voorstel dat de vraag beantwoordt (kopen, verkopen of bewust niets doen). Zeg het eerlijk als de bronnen te weinig houvast geven.` : aanleiding?.length ? `\n\nAANLEIDING VAN DEZE ZITTING: ${aanleiding.map(a => a.tekst).join('; ')}.` : '')
    + (agenda?.length && !vraag ? `\nAGENDA VAN DE VOORZITTING (kansen die de voorzitter en de agendacommissie zagen, nog géén besluit): ${agenda.map(k => `${k.asset} ${k.richting} (score ${k.score}/10): ${k.waarom}`).join('; ')}. Bespreek deze kansen eerst, maar beoordeel ze zelf kritisch.` : '');
  const bronTeller = {};
  const telBronnen = (id, lijst) => { bronTeller[id] = (bronTeller[id] || 0) + lijst.length; };

  try {
    // 6. Voorstellen
    await db.updateRound(round.id, { phase: 'voorstel' });
    const voorstellen = controleerVoorstellen(await llm.vraagJson(pitchPrompt(ctx + ctxAanleiding, radarVan(pakket)), { maxTokens: 2500 }), actief, pakket);
    voorstellen.forEach(p => telBronnen(p.id, p.bronnen));
    await db.insertMessages(voorstellen.map(p => msg('voorstel', { trader_id: p.id, text: p.uitleg, sources: p.bronnen, action: { actie: p.actie, asset: p.asset, bedrag: p.bedrag, overtuiging: p.overtuiging, geweigerd: p.geweigerd } })));
    const voorstel = kiesVoorstel(voorstellen, staat, (a, s, _st, _pr, uitPot) => magHandelen(a, s, staat, prijzen, nu, uitPot), prijzen);

    let uitkomst = 'GEEN VOORSTEL', voor = null, trade = null, tradeMelding = null;
    if (!voorstel) {
      await db.insertMessages([msg('uitslag', { trader_id: 'voorzitter', text: 'Geen geldig koop- of verkoopvoorstel. Het parlement doet deze ronde niets.' })]);
    } else {
      await db.updateRound(round.id, { phase: 'debat', proposal: voorstel });
      await db.insertMessages([msg('systeem', { text: `Op tafel: ${voorstel.actie} €${voorstel.bedrag} ${voorstel.asset}`, action: voorstel })]);

      // 7. Debat in delen: de traders (Haiku) en Voorzitter Eva (Sonnet, eigen aanroep) reageren echt op elkaar.
      //    Eva opent → traders → Eva grijpt in → traders → Eva grijpt in → traders → Eva sluit af.
      //    Elk deel gaat eerst door de bronnencheck en komt dan live in de zaal.
      const vastDebat = debatVast(ctx + ctxAanleiding, voorstellen, voorstel, actief);
      const toegestaan = [context({ traders: actief, pakket: [], staat, prijzen, recent: [] }), ...voorstellen.map(p => p.bedrag), voorstel.bedrag];
      const evaModel = spaarstand ? MODELLEN.haiku.id : MODELLEN.sonnet.id;
      const goedeBeurten = [];                       // alles wat in de zaal gezegd is (zonder geschrapte bijdragen)
      const DELEN = 3, PER_DEEL = [4, 4, 3];
      let traderBeurten = 0, geweigerd = 0, geschrapt = 0;
      const naamVan = id => actief.find(t => t.id === id)?.name || id;
      const zegEva = async moment => {
        let b = null;
        try { b = controleerEva(await llm.vraagJson(evaPrompt(goedeBeurten, actief, { moment }), { maxTokens: 700, temperature: 0.5, vastDeel: vastDebat, model: evaModel }), actief, pakket); }
        catch (e) { log('⚠ voorzitter mislukt:', e.message); }
        if (!b && moment !== 'ingreep') b = { id: 'voorzitter', tekst: moment === 'open' ? `Ik open het debat over ${voorstel.actie} €${voorstel.bedrag} ${voorstel.asset}. ${naamVan(voorstel.door)}, u heeft het woord.` : 'Ik dank de leden. De beraadslaging is gesloten.', bronnen: [], emotie: 'zeker', woord: moment === 'open' ? [voorstel.door] : [] };
        if (!b) return [];
        goedeBeurten.push(b);
        await db.insertMessages([msg('debat', { trader_id: 'voorzitter', text: b.tekst, sources: b.bronnen, action: { emotie: b.emotie, woord: b.woord } })]);
        if (beurtPauze) await sleep(beurtPauze);
        return b.woord;
      };
      let woord = await zegEva('open');
      for (let deel = 1; deel <= DELEN && traderBeurten < 14; deel++) {
        let lijst = [];
        try {
          const r = controleerDebat(await llm.vraagJson(debatDeelPrompt(goedeBeurten, actief, { deel, delen: DELEN, woord, aantal: PER_DEEL[deel - 1] }), { maxTokens: 1500, vastDeel: vastDebat }), actief, pakket);
          geweigerd += r.geweigerd; lijst = r.beurten.filter(b => b.id !== 'voorzitter');
        } catch (e) { log(`⚠ debatdeel ${deel} mislukt:`, e.message); }
        if (lijst.length && goedeBeurten.at(-1)?.id === lijst[0].id) { lijst.shift(); geweigerd++; }   // niemand twee keer achter elkaar
        lijst = lijst.slice(0, 14 - traderBeurten);
        // Strengere bronnencheck: eerst de cijfers, daarna een onafhankelijke controleur
        for (const b of lijst) { const c = cijferCheck(b.tekst, b.bronnen, pakket, toegestaan); if (!c.ok) b.geschrapt = c.reden; }
        const teChecken = lijst.filter(b => !b.geschrapt);
        if (teChecken.length) {
          try {
            verwerkControle(await llm.vraagJson(controlePrompt(teChecken, pakket, actief), { maxTokens: 900, temperature: 0 }), teChecken)
              .forEach((o, i) => { if (!o.ok) teChecken[i].geschrapt = o.reden; });
          } catch (e) { log('⚠ bronnencontroleur mislukt, alleen cijfercheck gebruikt:', e.message); }
        }
        for (const b of lijst) {
          if (b.geschrapt) {
            geschrapt++;
            (stats[b.id] ||= { goed: 0, fout: 0 }).geschrapt = (stats[b.id].geschrapt || 0) + 1;
            await db.insertMessages([msg('voorzitter', { trader_id: 'voorzitter', text: `De bijdrage van ${naamVan(b.id)} is geschrapt: ${b.geschrapt}.`, sources: b.bronnen, action: { geschrapt: b.id, tekst: b.tekst } })]);
          } else {
            telBronnen(b.id, b.bronnen); goedeBeurten.push(b); traderBeurten++;
            await db.insertMessages([msg('debat', { trader_id: b.id, text: b.tekst, sources: b.bronnen, action: { emotie: b.emotie } })]);
          }
          if (beurtPauze) await sleep(beurtPauze);
        }
        woord = deel < DELEN ? await zegEva('ingreep') : [];
      }
      await zegEva('slot');
      if (geweigerd) log(`${geweigerd} debatbeurten geweigerd (geen geldige bron of dubbele spreker)`);
      if (geschrapt) log(`${geschrapt} debatbeurten geschrapt door de bronnencheck`);

      // 8. Stemming (de voorzitter stuurt iedereen naar zijn stemhokje)
      await db.updateRound(round.id, { phase: 'stemming' });
      await db.insertMessages([msg('voorzitter', { trader_id: 'voorzitter', text: `De beraadslaging is gesloten. We stemmen geheim over ${voorstel.actie} €${voorstel.bedrag} ${voorstel.asset}. Ik verzoek de leden naar hun stemhokje te gaan.`, action: { fase: 'stemming' } })]);
      // Blind: elke trader stemt in een eigen aanroep (gedeeld deel wordt gecachet)
      // Compact: alleen de bronnen die in het debat genoemd zijn + de koers van de asset op tafel (scheelt kosten)
      const genoemd = new Set(goedeBeurten.flatMap(x => x.bronnen));
      const subset = pakket.filter(x => genoemd.has(x.id) || (x.kind === 'koers' && x.data.sym === voorstel.asset));
      const ctxStem = context({ traders: actief, pakket: subset, staat, prijzen, recent: [] });
      const vast = stemPromptEnkel(ctxStem, voorstel, goedeBeurten, actief, { name: '', role: '', style: '' }).split('TAAK 3')[0];
      // Elke trader stemt met zijn eigen model (4 verschillende breinen). In de spaarstand worden Opus en Fable Sonnet.
      const modelVan = t => { let k = t.model || START_MODEL[t.id] || 'haiku'; if (spaarstand && (k === 'opus' || k === 'fable')) k = 'sonnet'; return k; };
      const losse = await Promise.all(actief.map(t => llm.vraagJson(stemPromptEnkel(ctxStem, voorstel, goedeBeurten, actief, t).slice(vast.length), { maxTokens: 700, vastDeel: vast, model: MODELLEN[modelVan(t)].id })
        .then(r => ({ ...r, id: t.id })).catch(e => { log(`⚠ stem ${t.id} (${modelVan(t)}) mislukt: ${e.message}`); return { id: t.id }; })));
      const stemmen = controleerStemmen({ stemmen: losse }, actief, pakket);
      stemmen.forEach(s => telBronnen(s.id, s.bronnen));
      await db.insertMessages(stemmen.map(s => msg('stem', { trader_id: s.id, text: s.reden, sources: s.bronnen, action: { stem: s.stem, geweigerd: s.geweigerd, bedrag: s.bedrag, model: modelVan(actief.find(t => t.id === s.id) || {}) } })));
      voor = stemmen.filter(s => s.stem === 'VOOR').length;
      for (const s of stemmen) { const st = stats[s.id] ||= { goed: 0, fout: 0 }; st.voor = (st.voor || 0) + (s.stem === 'VOOR'); st.tegen = (st.tegen || 0) + (s.stem !== 'VOOR'); }
      (staat.pending ||= []).push({ t: nu.toISOString(), asset: voorstel.asset, actie: voorstel.actie, prijs: prijzen[voorstel.asset], votes: stemmen.map(s => ({ id: s.id, stem: s.stem })) });

      // 9. Uitslag
      const nodig = voorstel.uitPot ? CONFIG.potStemmen : CONFIG.stemmenNodig;
      if (voor >= nodig) {
        // Het bedrag bepalen de voorstemmers samen: het middelste bedrag (mediaan) van wat zij verstandig vinden
        const bp = bedragUitStemmen(stemmen, voorstel);
        const uitTeVoeren = { ...voorstel, bedrag: voorstel.actie === 'KOOP' ? bp.bedrag : voorstel.bedrag };
        const r = voerUit(uitTeVoeren, staat, prijzen, nu);
        if (r.ok) {
          uitkomst = 'UITGEVOERD'; trade = r;
          await db.insertTrade({ round_id: round.id, t: nu.toISOString(), actie: r.actie, asset: r.asset, bedrag: r.bedrag, prijs: r.prijs, qty: r.qty, fee: r.fee, votes_for: voor });
          await db.insertMessages([msg('uitslag', { trader_id: 'voorzitter', text: `Aangenomen met ${voor} van ${actief.length}. ${r.actie} €${r.bedrag} ${r.asset} uitgevoerd${bp.bron === 'stemmers' && voorstel.actie === 'KOOP' ? ` (bedrag: het middelste van de voorstemmers, die zaten tussen €${bp.spreiding[0]} en €${bp.spreiding[1]})` : ''}${r.opgehoogd ? `, opgehoogd naar het minimum vanwege de vaste kosten` : ''}.`, action: { uitkomst, voor, bedrag: r.bedrag, voorgesteld: voorstel.bedrag } })]);
          tradeMelding = { titel: `${r.actie === 'KOOP' ? 'Gekocht' : 'Verkocht'}: €${r.bedrag} ${r.asset}`, tekst: `Aangenomen met ${voor} van ${actief.length} stemmen${spoed ? ' (spoedzitting)' : ''}.`, prio: 4, tags: [r.actie === 'KOOP' ? 'green_circle' : 'red_circle'] };
        } else {
          uitkomst = 'HUISREGEL';
          await db.insertMessages([msg('uitslag', { trader_id: 'voorzitter', text: `Aangenomen met ${voor} stemmen, maar geblokkeerd: ${r.reden}.`, action: { uitkomst, voor } })]);
        }
      } else {
        uitkomst = 'AFGEWEZEN';
        await db.insertMessages([msg('uitslag', { trader_id: 'voorzitter', text: `Afgewezen: ${voor} van ${actief.length} voor, ${nodig} nodig${voorstel.uitPot ? ' (geld uit de dividendpot)' : ''}.`, action: { uitkomst, voor } })]);
      }
      // 9b. Uitleg in gewone taal: waarom, en wat verwachten we (komt in de app en in de melding)
      let uitleg = null;
      if (stemmen?.length) {
        uitleg = await maakUitleg(llm, { voorstel: trade ? { ...voorstel, bedrag: trade.bedrag } : voorstel, uitkomst, voor, nodig: voorstel.uitPot ? CONFIG.potStemmen : CONFIG.stemmenNodig, totaal: actief.length, stemmen, naamVan,
          koers: marktRows.find(k => k.symbol === voorstel.asset), aanleiding, vraag: vraagA?.tekst?.replace(/^vraag van de eigenaar: /, '') });
        if (uitleg) {
          await db.insertMessages([msg('uitleg', { trader_id: 'voorzitter', text: uitleg.waarom, action: uitleg })]);
          await db.updateRound(round.id, { proposal: { ...voorstel, uitleg_kort: uitleg } });
          if (tradeMelding) tradeMelding = { ...tradeMelding, tekst: `${uitleg.waarom} Verwachting: ${uitleg.verwachting}`.slice(0, 240) };
        }
      }
      if (tradeMelding) await push(tradeMelding);

    }

    // 10. Opslaan (met de koersen van nu, zodat de zittingscheck kan zien wat er sindsdien bewoog)
    await boekKosten();
    staat.laatsteZitting = { t: nu.toISOString(), prijzen: { ...prijzen }, vangnet: Object.entries(staat.positions || {}).filter(([s, p]) => { const r = p.qty * (prijzen[s] || 0) / p.cost - 1; return p.cost > 0 && (r <= CONFIG.stopLoss + 0.02 || r >= CONFIG.winstDoel - 0.02); }).map(([s]) => s) };
    const v = waarde(staat, prijzen), b = benchWaarde(staat, prijzen);
    bewaarIn(staat); await db.saveState(staat);
    await db.insertSnapshot({ t: nu.toISOString(), value: round2(v), cash: round2(staat.cash), bench: round2(b) });
    await db.upsertTraders(actief.map(t => ({
      id: t.id, goed: (t.goed || 0) + (stats[t.id]?.goed || 0), fout: (t.fout || 0) + (stats[t.id]?.fout || 0),
      voor: (t.voor || 0) + (stats[t.id]?.voor || 0), tegen: (t.tegen || 0) + (stats[t.id]?.tegen || 0), bronnen: (t.bronnen || 0) + (bronTeller[t.id] || 0),
      geschrapt: (t.geschrapt || 0) + (stats[t.id]?.geschrapt || 0),
    })));
    await db.updateRound(round.id, { status: 'klaar', phase: 'klaar', outcome: uitkomst, votes_for: voor, trade, finished_at: new Date().toISOString() });
    log(`ronde ${no} klaar: ${uitkomst}${voor != null ? ` (${voor} voor)` : ''} · waarde €${v.toFixed(2)} · vasthouden €${b.toFixed(2)} · AI-calls ${llm.verbruik.calls}, tokens in ${llm.verbruik.input} uit ${llm.verbruik.output}`);
    await vg.stop();
    return { no, uitkomst, voor, waarde: v, bench: b, trade };
  } catch (e) {
    await vg.stop();
    await db.updateRound(round.id, { status: 'fout', phase: 'fout', error: String(e.message).slice(0, 500), finished_at: new Date().toISOString() });
    await boekKosten().catch(() => {});
    bewaarIn(staat); await db.saveState(staat);
    await push({ titel: `Ronde ${no} mislukt`, tekst: String(e.message).slice(0, 200), prio: 5, tags: ['x'] });
    throw e;
  }
}

const fin = v => (Number.isFinite(v) ? v : null);

// De radar: welke assets krijgen de traders deze ronde te zien? (max RADAR_MAX)
// 1. wat we bezitten, 2. assets uit het spoednieuws en het nieuws, 3. grootste bewegers, 4. de grote namen.
export function kiesRadar(ruw, staat, spoed, agenda = null) {
  const beschikbaar = new Set(ruw.koersen.map(k => k.sym));
  const lijst = [];
  const voeg = s => { if (beschikbaar.has(s) && !lijst.includes(s) && lijst.length < RADAR_MAX) lijst.push(s); };
  (agenda || []).map(k => k.asset).forEach(voeg);
  Object.keys(staat?.positions || {}).forEach(voeg);
  (spoed?.assets || []).forEach(voeg);
  ruw.nieuws.slice().sort((a, b) => b.belang - a.belang).flatMap(n => n.assets || []).forEach(voeg);
  (ruw.cijfers || []).filter(c => (new Date(c.datum) - Date.now()) < 2 * 864e5).forEach(c => voeg(c.sym));   // cijfers binnen 2 dagen
  const bewegers = ruw.koersen.filter(k => Number.isFinite(k.chg24h)).sort((a, b) => Math.abs(b.chg24h) - Math.abs(a.chg24h));
  bewegers.slice(0, 8).forEach(k => voeg(k.sym));
  ['BTC', 'ETH', 'SPY', 'QQQ', 'GLD', 'SOL', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'XRP', 'ASML'].forEach(voeg);
  bewegers.forEach(k => voeg(k.sym));
  return lijst;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ronde().catch(e => { console.error('Ronde mislukt:', e.message); process.exit(1); });
}

// Vangnetten elke 5 minuten: stop-loss, winstdoel en winst vastzetten, voor gekochte posities én shorts.
// Draait in de nieuwscheck met de verse koersen. Niet tijdens een zitting (die doet het zelf al).
import { vangnetten, waarde } from './portfolio.js';
import { ZITTING } from './config.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const pct = x => `${Math.abs(x * 100).toFixed(0)}%`;

export function vangnetTekst(v) {
  const kort = v.soort === 'short';
  const wat = kort ? `short op ${v.asset} automatisch gedekt` : `${v.asset} automatisch verkocht`;
  const titel = { 'stop-loss': kort ? `Short op ${v.asset} gestopt met verlies` : `${v.asset} verkocht met verlies`,
    'winst vastgezet': kort ? `Short op ${v.asset}: winst veiliggesteld` : `${v.asset}: winst veiliggesteld`,
    winstdoel: kort ? `Short op ${v.asset} gesloten met winst` : `${v.asset} verkocht met winst` }[v.reden];
  const tekst = {
    'stop-loss': kort ? `De koers steeg te ver tegen ons in (${pct(v.resultaat)} verlies). We hebben de short gesloten zodat het verlies niet groter wordt.` : `De koers zakte ${pct(v.resultaat)}. We hebben automatisch verkocht zodat het verlies niet groter wordt.`,
    'winst vastgezet': `Hij stond eerder ruim in de plus en zakte terug. We hebben ${kort ? 'gedekt' : 'verkocht'} voordat de winst verdwijnt (${v.resultaat >= 0 ? '+' : '−'}${pct(v.resultaat)}).`,
    winstdoel: kort ? `De koers zakte zoals verwacht. We hebben ${pct(v.resultaat)} winst binnengehaald.` : `De koers steeg ${pct(v.resultaat)}. We hebben de winst automatisch binnengehaald.`,
  }[v.reden];
  return { titel, tekst, systeem: `${v.reden === 'stop-loss' ? 'Stop-loss' : v.reden === 'winstdoel' ? 'Winstdoel' : 'Winst vastgezet'}: ${wat} voor €${v.bedrag} (${(v.resultaat * 100).toFixed(1)}%).` };
}

export async function vangnetCheck(db, { nu = new Date(), push = async () => {} } = {}) {
  const staat = await db.loadState();
  if (!staat || (!Object.keys(staat.positions || {}).length && !Object.keys(staat.shorts || {}).length)) return [];
  const rondes = db.laatsteRondes ? await db.laatsteRondes().catch(() => []) : [];
  if (rondes.some(r => r.status === 'bezig' && (nu - new Date(r.started_at)) / 60000 < ZITTING.bezigMaxMin)) return [];   // een zitting is bezig: die doet het zelf
  const prijzen = Object.fromEntries((await db.loadMarket()).map(m => [m.symbol, Number(m.price)]));
  const voor = JSON.stringify([staat.positions, staat.shorts]);
  const uit = vangnetten(staat, prijzen, nu);
  if (!uit.length && voor === JSON.stringify([staat.positions, staat.shorts])) return [];   // niets veranderd (ook geen nieuwe piek)
  await db.saveState(staat);
  for (const v of uit) {
    const t = vangnetTekst(v);
    await db.insertTrade({ round_id: null, t: nu.toISOString(), actie: v.actie, asset: v.asset, bedrag: v.bedrag, prijs: v.prijs, qty: v.qty, fee: v.fee, votes_for: null });
    await push({ titel: t.titel, tekst: t.tekst, prio: 4 });
    log(`vangnet ${v.reden}: ${v.asset} (${v.soort}) €${v.bedrag}, nieuwe waarde €${waarde(staat, prijzen).toFixed(2)}`);
  }
  return uit;
}

// Test: stop-loss en winstdoel (eigen grenzen, winst vastzetten, elke 5 minuten) en short gaan.
import assert from 'node:assert/strict';
import { voerUit, vangnetten, waarde, shortWaarde, magHandelen, vangnetStand } from '../portfolio.js';
import { controleerVoorstellen, kiesVoorstel } from '../debate.js';
import { vangnetCheck } from '../vangnet.js';
import { wedRonde, standVan } from '../wedden.js';
import { kiesWedden } from '../voorspel.js';
import { wedWaarde } from '../portfolio.js';

const open = new Date('2026-11-24T16:00:00Z');   // dinsdag, beurs open

// ---------- 1. eigen grenzen en winst vastzetten ----------
{
  const st = { cash: 1000, pot: 0, positions: {} };
  let r = voerUit({ actie: 'KOOP', asset: 'BTC', bedrag: 200, stop: 5, doel: 30 }, st, { BTC: 100 }, open);
  assert.ok(r.ok);
  assert.equal(st.positions.BTC.stop, -0.05); assert.equal(st.positions.BTC.doel, 0.30);
  // grenzen worden begrensd
  voerUit({ actie: 'KOOP', asset: 'ETH', bedrag: 100, stop: 50, doel: 2 }, st, { ETH: 10, BTC: 100 }, open);
  assert.equal(st.positions.ETH.stop, -0.15); assert.equal(st.positions.ETH.doel, 0.05);
  // BTC +12% → piek boven 10%, nog niets verkocht
  assert.equal(vangnetten(st, { BTC: 112, ETH: 10 }, open).length, 0);
  assert.ok(st.positions.BTC.piek >= 0.10);
  assert.equal(vangnetStand(st.positions.BTC, st.positions.BTC.qty * 112).stop, 0, 'stop schuift naar 0%');
  // terug naar -1%: winst vastgezet → verkocht
  const v = vangnetten(st, { BTC: 99.6, ETH: 10 }, open);
  assert.equal(v.length, 1); assert.equal(v[0].reden, 'winst vastgezet'); assert.ok(!st.positions.BTC);
  // ETH +6% raakt zijn eigen doel van 5%
  const w = vangnetten(st, { ETH: 10.6 }, open);
  assert.equal(w[0].reden, 'winstdoel');
}

// ---------- 2. short gaan ----------
{
  const st = { cash: 1000, pot: 0, positions: {} };
  const p = { SPY: 600, QQQ: 500 };
  assert.match(magHandelen('DEKKEN', 'SPY', st, p, open), /geen short/);
  const r = voerUit({ actie: 'SHORT', asset: 'SPY', bedrag: 100 }, st, p, open);
  assert.ok(r.ok, r.reden); assert.equal(st.cash, 900);
  const start = waarde(st, p);
  assert.ok(Math.abs(start - (1000 - r.fee)) < 0.01, 'direct na de short: alleen de kosten kwijt');
  // koers 10% omlaag → short ~10% winst op de inzet
  const lager = { SPY: 540, QQQ: 500 };
  assert.ok(shortWaarde(st, 'SPY', lager) > 108 && shortWaarde(st, 'SPY', lager) < 110);
  // niet kopen zolang er een short staat, en niet short op iets in bezit
  assert.match(magHandelen('KOOP', 'SPY', st, p, open), /eerst dekken/);
  voerUit({ actie: 'KOOP', asset: 'QQQ', bedrag: 100 }, st, p, open);
  assert.match(magHandelen('SHORT', 'QQQ', st, p, open), /eerst verkopen/);
  // max 15% per short
  const groot = voerUit({ actie: 'SHORT', asset: 'SPY', bedrag: 500 }, st, p, open);
  assert.ok(groot.ok && groot.bedrag <= 1000 * 0.15 - 99 + 1, `begrensd op 15% (${groot.bedrag})`);
  // dekken met winst
  const cashVoor = st.cash;
  const d = voerUit({ actie: 'DEKKEN', asset: 'SPY', bedrag: Infinity }, st, lager, open);
  assert.ok(d.ok && !st.shorts.SPY && st.cash > cashVoor + 160, 'gedekt met winst');
  // stop-loss op een short: koers +9% → automatisch gedekt
  voerUit({ actie: 'SHORT', asset: 'SPY', bedrag: 100 }, st, p, open);
  const v = vangnetten(st, { SPY: 654, QQQ: 500 }, open);
  assert.equal(v.length, 1); assert.equal(v[0].soort, 'short'); assert.equal(v[0].reden, 'stop-loss'); assert.equal(v[0].actie, 'DEKKEN');
  // beurs dicht: aandelen-short kan niet
  assert.match(magHandelen('SHORT', 'SPY', st, p, new Date('2026-11-28T12:00:00Z')), /dicht/);
}

// ---------- 3. voorstellen met SHORT en eigen grenzen ----------
{
  const traders = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const pakket = [{ id: 'B1', kind: 'koers', data: { sym: 'SPY' } }];
  const v = controleerVoorstellen({ voorstellen: [
    { id: 'a', actie: 'SHORT', asset: 'SPY', bedrag: 80, overtuiging: 8, uitleg: 'x', bronnen: ['B1'], stop: 6, doel: 20 },
    { id: 'b', actie: 'SHORT', asset: 'SPY', bedrag: 60, overtuiging: 6, uitleg: 'y', bronnen: ['B1'] },
    { id: 'c', actie: 'NIKS', bronnen: ['B1'] }] }, traders, pakket);
  assert.equal(v[0].actie, 'SHORT'); assert.equal(v[0].stop, 6);
  const k = kiesVoorstel(v, { cash: 1000, positions: {} }, (a, s, st, pr) => magHandelen(a, s, st, pr, open), { SPY: 600 });
  assert.equal(k.actie, 'SHORT'); assert.equal(k.stop, 6); assert.equal(k.doel, 20);
}

// ---------- 4. elke 5 minuten (nieuwscheck), niet tijdens een zitting ----------
{
  const pushes = [], trades = [];
  let opgeslagen = null;
  const staat = { cash: 800, pot: 0, positions: { BTC: { qty: 2, cost: 200, sinds: '' } } };
  const db = { loadState: async () => staat, saveState: async s => { opgeslagen = s; }, laatsteRondes: async () => [],
    loadMarket: async () => [{ symbol: 'BTC', price: 90 }], insertTrade: async t => trades.push(t) };
  const uit = await vangnetCheck(db, { nu: open, push: async m => pushes.push(m) });
  assert.equal(uit.length, 1); assert.equal(trades[0].actie, 'VERKOOP'); assert.ok(opgeslagen && !opgeslagen.positions.BTC);
  assert.match(pushes[0].titel, /verlies/);
  staat.positions.ETH = { qty: 1, cost: 100 };
  const bezig = await vangnetCheck({ ...db, loadMarket: async () => [{ symbol: 'ETH', price: 50 }], laatsteRondes: async () => [{ status: 'bezig', started_at: open.toISOString() }] }, { nu: open });
  assert.equal(bezig.length, 0, 'zitting bezig: wachten');
}

// ---------- 5. wedden op Polymarket ----------
{
  const markten = [{ id: '11', slug: 'fed', vraag: 'Fed cuts in December?', kans: 30, einde: '2026-12-09' }, { id: '12', vraag: 'Ceasefire?', kans: 50 }];
  const k = kiesWedden([{ markt: 'W1', uitkomst: 'JA', onzeKans: 45, reden: 'zachte inflatie' }, { markt: 'W2', uitkomst: 'JA', onzeKans: 55 }, { markt: 'W9', uitkomst: 'JA', onzeKans: 90 }, { markt: 'W1', uitkomst: 'NEE', onzeKans: 10 }], markten);
  assert.deepEqual(k.map(x => [x.id, x.uitkomst, x.verschil]), [['11', 'JA', 15]], 'alleen bij >=10 punten verschil, bestaande markt, één per markt');
  assert.deepEqual(standVan({ outcomes: '["Yes","No"]', outcomePrices: '["0.3","0.7"]' }, 'NEE'), { prijs: 0.7, klaar: false, gewonnen: false });

  const staat = { cash: 500, pot: 0, positions: {} };
  let opgeslagen = 0; const pushes = [];
  let prijs = '["0.30","0.70"]', dicht = false;
  const db = { loadState: async () => staat, saveState: async () => { opgeslagen++; }, laatsteRondes: async () => [] };
  const haal = async () => ({ outcomes: '["Yes","No"]', outcomePrices: prijs, closed: dicht });
  const totaalVoor = waarde(staat, {});
  let r = await wedRonde(db, { nu: open, haal, push: async m => pushes.push(m), voorstellen: k });
  assert.equal(staat.cash, 400); assert.equal(r.geplaatst.length, 1); assert.equal(staat.wedden.open[0].inzet, 10, '15 punten verschil = €10');
  assert.ok(Math.abs(waarde(staat, {}) - (totaalVoor - 0.1)) < 0.01, 'totale waarde gelijk, op de kosten na');
  // niet nog een keer dezelfde dag
  r = await wedRonde(db, { nu: new Date(+open + 6e5), haal, voorstellen: k });
  assert.equal(staat.wedden.open.length, 1);
  // prijs stijgt naar 0.5: waarde stijgt
  prijs = '["0.50","0.50"]';
  await wedRonde(db, { nu: new Date(+open + 3600e3), haal, voorstellen: k });
  assert.ok(wedWaarde(staat) > 106, `wedwaarde gestegen (${wedWaarde(staat)})`);
  // markt sluit, JA wint: uitbetalen
  prijs = '["1","0"]'; dicht = true;
  r = await wedRonde(db, { nu: new Date(+open + 7200e3), haal, push: async m => pushes.push(m), voorstellen: k });
  assert.equal(r.uitbetaald.length, 1); assert.ok(r.uitbetaald[0].gewonnen); assert.equal(staat.wedden.open.length, 0);
  assert.ok(Math.abs(staat.wedden.pot - (90 + 10 * 0.99 / 0.3)) < 0.02, 'uitbetaald: aandelen x €1');
  assert.match(pushes.at(-1).titel, /gewonnen/);
}

console.log('✅ Handelen werkt: eigen stop/doel, winst vastzetten, elke 5 minuten, short gaan met onderpand, limieten en stop-loss, en wedden op Polymarket met uitbetaling.');

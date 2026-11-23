// Rekenwerk: indicatoren, de nep-portefeuille, kopen/verkopen en de benchmark.

import { CONFIG, SYMS, vindAsset, beursOpen } from './config.js';

// Kosten per trade: strenger dan in het echt, zodat winst in de test ook echte winst is.
// Minimale ordergrootte: crypto €10, aandelen en ETF's €50 (vanwege de vaste kosten)
export const minTradeVoor = asset => vindAsset(asset)?.soort === 'crypto' ? CONFIG.minTrade : CONFIG.minTradeAandeel;
// Kosten in euro voor een order: percentage, plus €1 vast bij aandelen en ETF's
export const kostenEur = (asset, bedrag) => bedrag * kostenVoor(asset) + (vindAsset(asset)?.soort === 'crypto' ? 0 : CONFIG.vasteKostenAandeel);
export function kostenVoor(asset) {
  const a = vindAsset(asset);
  const klein = a?.soort === 'crypto' && (a.rank ?? 99) > 20;
  return CONFIG.kosten + CONFIG.spread + (klein ? CONFIG.slippageKlein : 0);
}

// Indicatoren uit onze eigen koersgeschiedenis (1 punt per ronde = 30 min).
export function indicatoren(history = []) {
  const h = history.map(Number).filter(v => v > 0);
  if (h.length < 3) return {};
  const sma = n => { const s = h.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; };
  let rsi = null;
  if (h.length >= 15) {
    let g = 0, l = 0;
    const r = h.slice(-15);
    for (let i = 1; i < r.length; i++) { const d = r[i] - r[i - 1]; if (d > 0) g += d; else l -= d; }
    rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  const kort = sma(Math.min(8, h.length)), lang = sma(Math.min(24, h.length));
  const trend = kort > lang * 1.002 ? 'stijgend' : kort < lang * 0.998 ? 'dalend' : 'zijwaarts';
  return { rsi, trend };
}

export function nieuweStaat(prijzen) {
  return {
    id: 1, cash: CONFIG.startKapitaal, positions: {}, start_value: CONFIG.startKapitaal,
    bench: { ...prijzen }, started_at: new Date().toISOString(), pending: [], last_rotation: maandCode(),
  };
}

export function waarde(staat, prijzen) {
  let v = Number(staat.cash) + Number(staat.pot || 0); // de dividendpot telt mee in de totale waarde
  for (const [s, p] of Object.entries(staat.positions || {})) v += p.qty * (prijzen[s] ?? 0);
  return v;
}
export function posWaarde(staat, s, prijzen) { const p = staat.positions?.[s]; return p ? p.qty * (prijzen[s] ?? 0) : 0; }

// Kopen en vasthouden: startkapitaal gelijk verdeeld over alle assets, nooit verhandeld.
export function benchWaarde(staat, prijzen) {
  const b = staat.bench || {};
  const deel = CONFIG.startKapitaal / SYMS.length;
  let v = 0;
  const groei = staat.dividend?.benchStaking || {};
  for (const s of SYMS) v += b[s] && prijzen[s] ? deel * (prijzen[s] / b[s]) * (groei[s] || 1) : deel;
  return v + (staat.dividend?.bench || 0); // ook kopen & vasthouden ontvangt dividend en staking
}

// Mag deze trade überhaupt? Geeft reden terug als het niet mag.
export function magHandelen(actie, asset, staat, prijzen, nu = new Date(), uitPot = false) {
  const a = vindAsset(asset);
  if (!a) return 'onbekende asset';
  if (!(prijzen[asset] > 0)) return 'geen actuele koers';
  if (a.soort !== 'crypto' && !beursOpen(nu)) return 'de beurs is dicht';
  if (actie === 'VERKOOP' && !(staat.positions?.[asset]?.qty > 0)) return `geen ${asset} in bezit`;
  if (actie === 'KOOP' && (uitPot ? Number(staat.pot || 0) : Number(staat.cash)) < minTradeVoor(asset)) return uitPot ? 'niet genoeg in de dividendpot' : `niet genoeg cash (minimaal €${minTradeVoor(asset)} nodig)`;
  return null;
}

export function voerUit(voorstel, staat, prijzen, nu = new Date()) {
  const { actie, asset } = voorstel;
  const reden = magHandelen(actie, asset, staat, prijzen, nu, !!voorstel.uitPot);
  if (reden) return { ok: false, reden };
  const prijs = prijzen[asset], totaal = waarde(staat, prijzen);
  staat.positions = staat.positions || {};
  if (actie === 'KOOP') {
    const ruimte = Math.max(0, totaal * CONFIG.maxPerAsset - posWaarde(staat, asset, prijzen));
    const uitPot = !!voorstel.uitPot, beschikbaar = uitPot ? Number(staat.pot || 0) : staat.cash;
    const min = minTradeVoor(asset);
    // te klein voor de vaste kosten? Dan automatisch ophogen naar het minimum (als dat past)
    const gewenst = Math.max(voorstel.bedrag, min), opgehoogd = gewenst > voorstel.bedrag;
    const bedrag = Math.min(gewenst, beschikbaar, ruimte);
    if (bedrag < min) return { ok: false, reden: ruimte < min ? `de 25%-regel laat geen €${min} meer toe voor ${asset}` : uitPot ? 'niet genoeg in de dividendpot' : `niet genoeg cash voor minimaal €${min}` };
    const fee = kostenEur(asset, bedrag), qty = (bedrag - fee) / prijs;
    const p = staat.positions[asset] || (staat.positions[asset] = { qty: 0, cost: 0, sinds: nu.toISOString() });
    p.qty += qty; p.cost += bedrag;
    if (uitPot) staat.pot = round2(staat.pot - bedrag); else staat.cash = round2(staat.cash - bedrag);
    return { ok: true, actie, asset, bedrag: round2(bedrag), prijs, qty, fee: round2(fee), uitPot, opgehoogd };
  }
  const p = staat.positions[asset];
  const val = p.qty * prijs;
  let bedrag = Math.min(voorstel.bedrag, val);
  if (val - bedrag < minTradeVoor(asset)) bedrag = val;
  const qty = bedrag / prijs, deel = qty / p.qty, fee = kostenEur(asset, bedrag);
  p.cost -= p.cost * deel; p.qty -= qty; staat.cash = round2(staat.cash + bedrag - fee);
  if (p.qty <= 1e-12) delete staat.positions[asset];
  return { ok: true, actie, asset, bedrag: round2(bedrag), prijs, qty, fee: round2(fee) };
}

// Beoordeel stemmen van eerdere rondes: had VOOR gelijk als de koers de goede kant op ging?
export function beoordeel(staat, prijzen, stats, nu = Date.now()) {
  const blijft = [];
  const uitslagen = [];
  for (const e of staat.pending || []) {
    if (nu - new Date(e.t).getTime() < CONFIG.beoordeelNaMinuten * 60000) { blijft.push(e); continue; }
    if (!prijzen[e.asset]) { blijft.push(e); continue; }
    const beweging = prijzen[e.asset] / e.prijs - 1;
    if (Math.abs(beweging) < CONFIG.minBeweging) continue;
    const goedIdee = e.actie === 'KOOP' ? beweging > 0 : beweging < 0;
    for (const v of e.votes) {
      const st = stats[v.id] || (stats[v.id] = { goed: 0, fout: 0 });
      ((v.stem === 'VOOR') === goedIdee) ? st.goed++ : st.fout++;
    }
    uitslagen.push({ asset: e.asset, actie: e.actie, beweging, goedIdee });
  }
  staat.pending = blijft;
  return uitslagen;
}

// Vangnetten: stop-loss en winstdoel, zonder debat. Geeft de uitgevoerde verkopen terug.
export function vangnetten(staat, prijzen, nu = new Date()) {
  const uit = [];
  for (const [asset, p] of Object.entries(staat.positions || {})) {
    if (!(p.qty > 0) || !(prijzen[asset] > 0) || !(p.cost > 0)) continue;
    const res = (p.qty * prijzen[asset]) / p.cost - 1;
    const reden = res <= CONFIG.stopLoss ? 'stop-loss' : res >= CONFIG.winstDoel ? 'winstdoel' : null;
    if (!reden) continue;
    const r = voerUit({ actie: 'VERKOOP', asset, bedrag: Infinity }, staat, prijzen, nu);
    if (r.ok) uit.push({ ...r, reden, resultaat: res });
  }
  return uit;
}

export function maandCode(d = new Date()) { return d.toISOString().slice(0, 7); }
export const round2 = v => Math.round(v * 100) / 100;

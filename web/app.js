import { avatarUrl } from './avatar.js';
import { laad, abonneer, isLive, session, login, bronnenVoorRonde } from './data.js';
import { Speler } from './player.js';

// ---------- helpers ----------
const $ = s => document.querySelector(s);
// Alleen gewone webadressen: een link als 'javascript:...' uit een bron kan dan nooit code uitvoeren
const veiligeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const prijs = v => { v = Number(v); if (v >= 1) return eur(v); if (v >= 0.01) return eur(v, 4); return '€' + v.toLocaleString('nl-NL', { maximumSignificantDigits: 4, maximumFractionDigits: 10 }); };
const eur = (v, d = 2) => (v < 0 ? '−' : '') + '€' + nf(Math.abs(v), d);
const pct = (v, d = 2) => isFinite(v) ? (v >= 0 ? '+' : '−') + nf(Math.abs(v * 100), d) + '%' : '–';
const tijd = t => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const dag = t => new Date(t).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const geleden = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'zojuist' : m < 60 ? `${m} min geleden` : m < 1440 ? `${Math.round(m / 60)} uur geleden` : dag(t); };
const COIN = { BTC: ['#FFF1DC', '#B45309'], ETH: ['#EEF0FF', '#4338CA'], SOL: ['#F5EBFF', '#7E22CE'], AAPL: ['#EEF1F5', '#334155'], NVDA: ['#E6F8EE', '#15803D'], TSLA: ['#FFE9EC', '#BE123C'], MSFT: ['#E5F4FD', '#0369A1'], XRP: ['#EEF1F5', '#1F2937'], BNB: ['#FEF7DA', '#A16207'], DOGE: ['#FBF3DE', '#92400E'], AMZN: ['#FFF4E5', '#C2410C'], GOOGL: ['#EAF2FE', '#1D4ED8'], META: ['#E8F0FE', '#1E40AF'], ASML: ['#E6F3FB', '#0C4A6E'] };

// De voorzitter leidt het debat (zelfde gegevens als engine/traders.js)
export const VOORZITTER = { id: 'voorzitter', name: 'Voorzitter Eva', role: 'Voorzitter', look: { bg: '#EEF2FF', skin: '#EBC2A2', hair: '#4B3428', shirt: '#1E1B4B', tie: '#B8862B', look: 'bob', glasses: true, beard: false, kleur: '#818CF8' } };

// Met welk AI-model elke trader stemt (live staat dit in de database)
const MODEL_VAN = { noor: 'opus', joost: 'opus', mark: 'sonnet', daan: 'sonnet', lisa: 'sonnet', femke: 'sonnet', sven: 'haiku', yara: 'haiku', ruben: 'haiku', sanne: 'haiku' };
const MODEL_NAAM = { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5', fable: 'Fable 5.2' };
const modelVan = t => t.model || MODEL_VAN[t.id] || 'haiku';

// Gezondheid: draait het parlement nog? (rood als de laatste ronde te lang geleden is of mislukte)
function gezondheid() {
  const k = D.state?.kosten;
  if (k?.gestopt || (k && k.eur >= (k.budget || 50))) return { niveau: 'rood', titel: 'Gepauzeerd: maandbudget op', tekst: `De AI-kosten zijn €${nf(k.eur)} van €${k.budget || 50}. Volgende maand gaat het vanzelf verder.` };
  if (D.demo) return null;
  const r = D.laatste, check = D.voorzittingen?.[0];
  if (!r && !check) return { niveau: 'oranje', titel: 'Nog niets gedraaid', tekst: 'Start in GitHub bij Actions de workflow "Hamerslag uurcheck" met Run workflow.' };
  if (r?.status === 'fout') return { niveau: 'rood', titel: `Zitting ${r.no} is mislukt`, tekst: r.error || 'Onbekende fout. Kijk bij Actions in GitHub.' };
  // De uurcheck draait elk uur, ook als er geen zitting komt
  const t = check?.t || r?.started_at, uur = (Date.now() - new Date(t)) / 3600000;
  if (uur > 2.5) return { niveau: 'rood', titel: 'Het parlement staat stil', tekst: `De laatste uurcheck was ${geleden(t)}. Kijk bij Actions in GitHub of de workflow nog draait.` };
  return null;
}

let D = null;
const speler = new Speler();
window.__speler = speler; // handig voor opnames en debuggen
let traderMap = {};
let prijzen = {};

function bereken() {
  traderMap = Object.fromEntries(D.traders.map(t => [t.id, t]));
  traderMap.voorzitter = VOORZITTER;
  prijzen = Object.fromEntries(D.market.map(m => [m.symbol, Number(m.price)]));
}
const actieveTraders = () => D.traders.filter(t => t.active !== false);
function waarde() {
  let v = Number(D.state?.cash ?? 1000) + Number(D.state?.pot || 0);
  for (const [s, p] of Object.entries(D.state?.positions || {})) v += p.qty * (prijzen[s] || 0);
  return v;
}
function benchWaarde() {
  const b = D.state?.bench || {}, syms = Object.keys(prijzen);
  if (!syms.length) return 1000;
  return syms.reduce((a, s) => a + (1000 / syms.length) * (b[s] ? prijzen[s] / b[s] : 1), 0) + Number(D.state?.dividend?.bench || 0);
}
const score = t => { const n = (t.goed || 0) + (t.fout || 0); return { n, acc: n ? t.goed / n : null }; };
const opSchopstoel = t => { const { n, acc } = score(t); return n >= 100 && acc < 0.48; };

// ---------- status + breaking ----------
function volgendeRonde() {
  // de uurcheck draait elk heel uur (GitHub kan een paar minuten later starten)
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0);
}
function tikStatus() {
  if (!D) return;
  const s = speler.s;
  const bezig = D.round?.status === 'bezig' || (D.demo && s.fase !== 'wachten' && s.fase !== 'uitslag');
  $('#status').textContent = bezig ? (s.spoed ? 'Spoedzitting · nu live' : `Zitting ${D.round?.no ?? ''} · nu live`) : `Volgende check om ${String(volgendeRonde().getHours()).padStart(2, '0')}:00`;
}

function renderBreaking() {
  const h = (D.headlines || []).slice();
  const sp = D.round?.spoed;
  if (sp && !h.some(x => x.url === sp.url)) h.unshift({ title: sp.titel, publisher: sp.uitgever, url: sp.url, published_at: sp.tijd || D.round.started_at, importance: 9 });
  else if (sp) h.sort((a, b) => (b.url === sp.url) - (a.url === sp.url));
  if (!h.length) { $('#breaking').innerHTML = ''; return; }
  const top = h[0], hard = (top.importance || 0) >= 3;
  const items = h.slice(0, 8).map(x => `<a href="${esc(veiligeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.title)}<span>${esc(x.publisher)} · ${geleden(x.published_at)}</span></a>`).join('');
  $('#breaking').innerHTML = `<div class="breaking ${hard ? '' : 'calm'}"><span class="lbl">${hard ? '<span class="dot red" style="background:#fff"></span>BELANGRIJK' : 'NIEUWS'}</span><div class="ticker"><div class="ticker-inner">${items}${items}</div></div></div>`;
}

// ---------- grafiek ----------
function lijn(canvas, reeksen, { pad = 6, labels = false } = {}) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const all = reeksen.flatMap(r => r.data).filter(isFinite);
  if (all.length < 2) return;
  let mx = Math.max(...all), mn = Math.min(...all); const sp = (mx - mn) || 1; mx += sp * .1; mn -= sp * .1;
  const L = labels ? 44 : pad, y = v => pad + (1 - (v - mn) / (mx - mn)) * (h - pad * 2);
  if (labels) {
    g.font = '600 11px Inter, system-ui, sans-serif'; g.fillStyle = '#8A93A8'; g.strokeStyle = '#EEF1F6';
    for (let k = 0; k <= 3; k++) { const v = mn + (mx - mn) * k / 3; g.beginPath(); g.moveTo(L, y(v)); g.lineTo(w, y(v)); g.stroke(); g.fillText('€' + Math.round(v), 0, y(v) + 4); }
  }
  for (const r of reeksen) {
    const n = r.data.length, x = i => L + i / (n - 1) * (w - L - pad);
    if (r.fill) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, r.fill); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.beginPath(); r.data.forEach((v, i) => i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))); g.lineTo(x(n - 1), h); g.lineTo(x(0), h); g.closePath(); g.fillStyle = gr; g.fill();
    }
    g.setLineDash(r.dash ? [5, 5] : []); g.lineWidth = r.w || 2; g.strokeStyle = r.color; g.lineJoin = 'round';
    g.beginPath(); r.data.forEach((v, i) => i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))); g.stroke();
    if (r.glow) { g.shadowColor = r.color; g.shadowBlur = 12; g.stroke(); g.shadowBlur = 0; }
  }
  g.setLineDash([]);
}
const spark = (h, w = 64, hh = 26, upForce = null) => {
  const s = (h || []).slice(-48).map(Number); if (s.length < 2) return '';
  const mx = Math.max(...s), mn = Math.min(...s), r = (mx - mn) || 1;
  const up = upForce ?? (s[s.length - 1] >= s[0]);
  const pts = s.map((v, i) => `${(i / (s.length - 1) * w).toFixed(1)},${(hh - 2 - (v - mn) / r * (hh - 4)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${up ? '#059669' : '#E11D48'}" stroke-width="1.8" points="${pts}"/></svg>`;
};

// ---------- HOME ----------
// Welkom: in één zin wat dit is (wegklikbaar, onthouden in deze browser)
const leesOnthoud = k => { try { return localStorage.getItem(k); } catch { return null; } };
const zetOnthoud = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function welkomKaart() {
  if (leesOnthoud('hs-welkom-weg')) return '';
  return `<div class="welkom" id="welkom"><img src="icon.svg" alt="" width="44" height="44">
    <div><b>Welkom bij Hamerslag${D.demo ? ' <span class="demo-tag">DEMO</span>' : ''}</b>
    <p>Tien AI-traders lezen het nieuws, debatteren en stemmen. Bij 6 stemmen voor wordt er gehandeld, met nepgeld.</p></div>
    <button type="button" class="sluit" id="welkomWeg" aria-label="Welkomstbericht sluiten">×</button></div>`;
}
// Live: alleen zichtbaar als er nu een zitting bezig is
function isBezig(s = speler.s) { return D.round?.status === 'bezig' || (D.demo && s.fase !== 'wachten' && s.fase !== 'uitslag'); }
function toonLive(s) {
  const el = $('#liveKaart'); if (!el) return;
  if (!isBezig(s)) { el.innerHTML = ''; return; }
  const naam = s.spoed ? 'Spoedzitting' : `Zitting ${D.round?.no ?? ''}`;
  el.innerHTML = `<a class="livekaart" href="#zaal"><span class="pols"><span class="dot red" style="background:#fff"></span>NU LIVE</span>
    <span class="lk-t"><b>${esc(naam)} is bezig</b><small>${esc(faseTekst(s))}</small></span><span class="lk-k">Kijk mee →</span></a>`;
}
// Laatste besluit: wat het parlement het laatst besloot, met de knop naar de zaal
function besluitKaart() {
  const r = D.besluit || (D.round?.status === 'klaar' ? D.round : null);
  if (!r) return '';
  const p = r.proposal, ok = r.outcome === 'UITGEVOERD';
  const n = actieveTraders().length || 10;
  const actie = p ? (p.actie === 'KOOP' ? (ok ? 'Gekocht' : 'Niet gekocht') : (ok ? 'Verkocht' : 'Niet verkocht')) : 'Geen trade';
  const [bg, fg] = p ? kleurVan(p.asset) : ['#F1F3F8', '#5B6478'];
  const voor = Number(r.votes_for ?? 0);
  return `<div class="card besluit"><div class="card-h"><h2>Laatste besluit</h2><span class="tag ${ok ? 'VOOR' : 'TEGEN'}">${ok ? 'AANGENOMEN' : 'AFGEWEZEN'}</span></div>
    <div class="card-b">
      <div class="bs-rij">${p ? `<div class="ico" style="background:${bg};color:${fg}">${esc(p.asset)}</div>` : ''}
        <div style="flex:1;min-width:0"><div class="bs-wat">${actie}${p ? ` <b>${eur(p.bedrag, 0)} ${esc(p.asset)}</b>` : ''}</div>
        <div class="mut" style="font-size:13px">${voor} van de ${n} stemden voor · ${r.spoed ? 'spoedzitting' : 'zitting ' + esc(r.no)} · ${geleden(r.finished_at || r.started_at)}</div></div></div>
      <div class="votebar" style="margin-top:12px"><i class="v" style="width:${voor / n * 100}%"></i><i class="t" style="width:${(n - voor) / n * 100}%"></i></div>
      <a class="btn" href="#zaal" style="margin-top:14px">Bekijk de zitting <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></a>
    </div></div>`;
}
// 'Crypto Fear & Greed Index: 32/100 (Fear), gisteren 28' -> 'Stemming op de markt: 32/100 (angstig), gisteren 28'
const STEMMING = { 'Extreme Fear': 'heel angstig', Fear: 'angstig', Neutral: 'neutraal', Greed: 'hebberig', 'Extreme Greed': 'heel hebberig' };
const stemmingTekst = t => String(t || '').replace(/^.*Fear & Greed( Index)?:?\s*/i, 'Stemming op de markt: ').replace(/\((Extreme Fear|Extreme Greed|Fear|Neutral|Greed)\)/, (_, w) => `(${STEMMING[w]})`);

function renderHome() {
  const v = waarde(), b = benchWaarde(), r = v / 1000 - 1, br = b / 1000 - 1;
  const [heel, cent] = nf(v).split(',');
  const belegd = v - Number(D.state?.cash ?? v);
  const bronnen = Object.values(D.sources || {}).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const g = gezondheid(), k = D.state?.kosten;
  const kostPct = k ? Math.min(1, k.eur / (k.budget || 50)) : 0;
  $('#v-home').innerHTML = `
  ${g ? `<div class="alarm ${g.niveau}"><b>${esc(g.titel)}</b><span>${esc(g.tekst)}</span></div>` : ''}
  ${welkomKaart()}
  <div id="liveKaart"></div>
  ${besluitKaart()}
  <div class="grid">
    <div class="col">
      <div class="card hero">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="eyebrow">Portefeuille · nepgeld</span><span class="chip">start €1.000</span></div>
        <div class="money"><span class="cur">€</span><span class="big">${heel}</span><span class="cents">,${cent}</span></div>
        <div class="chips"><span class="chip ${r >= 0 ? 'up' : 'dn'}">${r >= 0 ? '▲' : '▼'} ${eur(v - 1000)} · ${pct(r)}</span><span class="mut" style="font-size:12.5px" title="Wat je had gehad als je bij de start van alles een beetje had gekocht en niets meer had gedaan">gewoon laten liggen: ${pct(br)}</span></div>
        <canvas id="heroChart" aria-label="Verloop van de portefeuille"></canvas>
        <div class="stats"><div><b>${eur(D.state?.cash ?? 0)}</b><span>Vrij geld</span></div><div><b>${eur(belegd)}</b><span>Belegd</span></div><div><b class="${r - br >= 0 ? 'up' : 'dn'}">${(r - br >= 0 ? '+' : '−') + nf(Math.abs((r - br) * 100), 2)}%</b><span>${r - br >= 0 ? 'beter' : 'slechter'} dan laten liggen</span></div></div>
      </div>

      <div class="card">
        <div class="card-h"><h2>De zaal <span class="pill" id="livePill" style="padding:3px 8px;font-size:10px"><span class="dot red"></span>LIVE</span></h2><span class="mut" id="miniFase" style="font-size:12px"></span></div>
        <div id="spoedBalk"></div>
        <div id="aanleidingBalk"></div>
        <div class="zaal-mini" id="zaalMini"></div>
        <div style="padding:0 16px 16px"><a class="btn" href="#zaal">Stap de 3D-zaal in <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></a></div>
      </div>

      <div class="card" id="voorstelCard"></div>
      <div class="card" id="argumentenCard" hidden></div>
      ${voorzittingKaart()}
    </div>
    <div class="col">
      ${k ? `<div class="card"><div class="card-h"><h2>AI-kosten deze maand</h2><span class="chip ${kostPct >= 0.7 ? 'dn' : ''}">${kostPct >= 0.7 ? 'spaarstand' : 'normaal'}</span></div>
        <div class="card-b"><div class="kosten"><b>€${nf(k.eur)}</b><span class="mut">van €${k.budget || 50}</span></div>
        <div class="kbar"><i style="width:${kostPct * 100}%;background:${kostPct >= 0.9 ? 'var(--red)' : kostPct >= 0.7 ? 'var(--gold)' : 'var(--iris)'}"></i><s style="left:70%"></s></div>
        <p class="mut" style="font-size:12px;margin-top:8px">Vanaf €${Math.round((k.budget || 50) * 0.7)} gebruiken de duurste traders een goedkoper AI-model. Bij €${k.budget || 50} pauzeert het parlement tot volgende maand.</p></div></div>` : ''}
      <div class="card">
        <div class="card-h"><h2>Grootste bewegers</h2><a href="#markt" style="font-size:12.5px;font-weight:700">Hele markt →</a></div>
        <div id="marktLijst" style="margin-top:6px"></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Bronnen van deze zitting</h2><span class="mut" style="font-size:12px">${bronnen.length} stuks</span></div>
        <div style="margin-top:6px">${bronnen.map(s => `<div class="bron"><span class="id">${esc(s.id)}</span><div style="flex:1;min-width:0"><a href="${esc(veiligeUrl(s.url))}" target="_blank" rel="noopener" style="color:var(--tx)">${esc(s.title)}</a><small>${esc(s.publisher)} · ${geleden(s.published_at)}</small></div></div>`).join('') || '<div class="card-b mut">Nog geen bronnen.</div>'}</div>
      </div>
    </div>
  </div>`;
  $('#welkomWeg')?.addEventListener('click', () => { zetOnthoud('hs-welkom-weg', '1'); $('#welkom')?.remove(); });
  renderMarkt();
  requestAnimationFrame(() => {
    const snaps = D.snapshots || [];
    lijn($('#heroChart'), [
      { data: snaps.map(s => Number(s.bench)), color: '#A3AAC2', dash: true, w: 1.5 },
      { data: snaps.map(s => Number(s.value)).concat(v), color: '#F25600', w: 2.4, fill: 'rgba(242,86,0,.12)' },
    ]);
    updateMini(speler.s);
  });
}

function renderMarkt() {
  const el = $('#marktLijst'); if (!el) return;
  const rows = D.market.slice().sort((a, b) => Math.abs(Number(b.chg24h)) - Math.abs(Number(a.chg24h))).slice(0, 6);
  el.innerHTML = rows.map(m => {
    const [bg, fg] = kleurVan(m.symbol);
    const c = Number(m.chg24h);
    const vers = Date.now() - new Date(m.updated_at) < 45 * 60000;
    return `<div class="row"><div class="coin" style="background:${bg};color:${fg}">${esc(m.symbol)}</div>
      <div class="nm"><b>${esc(m.name)}${vers ? '<span class="lv">LIVE</span>' : ''}</b><span>${esc(m.symbol)} · ${m.kind === 'etf' ? 'ETF' : esc(m.source || '')}</span></div>
      ${spark(m.history, 64, 26, c >= 0)}
      <div class="px"><b>${prijs(m.price)}</b><span class="${c >= 0 ? 'up' : 'dn'}">${pct(c)}</span></div></div>`;
  }).join('');
}

function renderVoorstel(s) {
  const el = $('#voorstelCard'); if (!el) return;
  let p = s.voorstel || D.round?.proposal;
  // na de stemming: het uitgevoerde bedrag (mediaan van de voorstemmers) in plaats van het voorgestelde
  const uitgevoerd = s.uitslag?.bedrag && p && s.uitslag.bedrag !== p.bedrag ? s.uitslag.bedrag : null;
  if (uitgevoerd) p = { ...p, bedrag: uitgevoerd, voorgesteld: p.bedrag };
  if (!p) { el.innerHTML = `<div class="card-h"><h2>Voorstel</h2></div><div class="card-b mut">Er ligt nog geen voorstel op tafel.</div>`; return; }
  const [bg, fg] = kleurVan(p.asset);
  const n = actieveTraders().length || 10;
  const voor = s.fase === 'stemming' || s.fase === 'uitslag' ? s.voor : 0, tegen = s.fase === 'stemming' || s.fase === 'uitslag' ? s.tegen : 0;
  const status = s.uitslag ? (s.uitslag.uitkomst === 'UITGEVOERD' ? '<span class="tag VOOR">AANGENOMEN</span>' : `<span class="tag TEGEN">${esc(s.uitslag.uitkomst || 'AFGEWEZEN')}</span>`) : `<span class="tag NIKS">${s.fase === 'stemming' ? 'STEMMING' : 'DEBAT LOOPT'}</span>`;
  el.innerHTML = `<div class="card-h"><h2>Voorstel op tafel</h2>${status}</div>
  <div class="card-b">
    <div class="prop"><div class="ico" style="background:${bg};color:${fg}">${esc(p.asset)}</div>
      <div style="flex:1"><span class="tag ${esc(p.actie)}">${esc(p.actie)}</span><div class="amt">${eur(p.bedrag)}</div>${p.voorgesteld ? `<div class="mut" style="font-size:12px">voorgesteld ${eur(p.voorgesteld, 0)}</div>` : ''}</div>
      <div style="text-align:right;font-size:12px" class="mut">ingediend door<br><b style="color:${darken(traderMap[p.door]?.look?.kleur)};font-size:14px">${esc(traderMap[p.door]?.name || '')}</b></div></div>
    <div class="votebar"><i class="v" style="width:${voor / n * 100}%"></i><i class="t" style="width:${tegen / n * 100}%"></i></div>
    <div class="threshold"></div>
    <div class="vlabels"><b class="up">${voor} voor</b><span class="mut">6 nodig · ${n - voor - tegen} open</span><b style="color:#C2410C">${tegen} tegen</b></div>
    ${s.uitslag ? `<p class="mut" style="font-size:13px;margin-top:10px">${esc(s.uitslag.tekst)}</p>` : ''}
  </div>`;
}

// 2D-zaal op het beginscherm
function updateMini(s) {
  const box = $('#zaalMini'); if (!box) return;
  const tr = actieveTraders();
  const w = box.clientWidth || 360, h = 420, cx = w / 2, by = 335, r = Math.min(w * 0.42, 210), ry = Math.min(r * 1.05, 190);
  box.style.height = h + 'px';
  const pos = tr.map((t, i) => { const a = Math.PI - (i / (tr.length - 1)) * Math.PI; return { t, x: cx + r * Math.cos(a), y: by - ry * Math.sin(a) }; });
  pos.push({ t: VOORZITTER, x: cx, y: by - ry * 0.46, vz: true });
  const arcs = `<svg class="arcs" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M${cx - r - 30} ${by + 20} A ${r + 30} ${ry + 30} 0 0 1 ${cx + r + 30} ${by + 20}" fill="none" stroke="#D5DBE8" stroke-width="1.2"/><path d="M${cx - r + 40} ${by + 20} A ${r - 40} ${ry - 40} 0 0 1 ${cx + r - 40} ${by + 20}" fill="none" stroke="#E4E8F1" stroke-width="1"/><ellipse cx="${cx}" cy="${by + 46}" rx="70" ry="14" fill="#FFF1E8" stroke="#FED7AA"/></svg>`;
  const seats = pos.map(({ t, x, y, vz }) => {
    const st = s.stemmen[t.id]?.stem; const cls = [vz ? 'vz' : '', s.spreker === t.id ? 'spreekt' : '', st === 'VOOR' ? 'voor' : st === 'TEGEN' ? 'tegen' : ''].join(' ');
    return `<div class="seat ${cls}" style="left:${x - 23}px;top:${y - 23}px"><div class="ring"><img src="${avatarUrl(t.look, { size: 64 })}" alt=""></div><span class="nm">${vz ? 'Voorzitter' : esc(t.name)}</span></div>`;
  }).join('');
  const p = s.uitslag?.bedrag && s.voorstel ? { ...s.voorstel, bedrag: s.uitslag.bedrag } : s.voorstel;
  const podium = `<div class="podium"><span class="eyebrow">${s.fase === 'uitslag' ? 'Uitslag' : 'Op tafel'}</span><b>${p ? `${esc(p.actie === 'KOOP' ? 'Koop' : 'Verkoop')} ${eur(p.bedrag, 0)} ${esc(p.asset)}` : 'Analyse…'}</b>${s.fase === 'stemming' || s.fase === 'uitslag' ? `<span style="font-size:12px"><b class="up" style="display:inline;font-size:12px">${s.voor} voor</b> · <span style="color:#C2410C">${s.tegen} tegen</span></span>` : ''}</div>`;
  let bubble = '';
  const sp = pos.find(q => q.t.id === s.spreker);
  if (sp && s.tekst) {
    const bw = Math.min(250, w - 16), left = Math.max(8, Math.min(w - bw - 8, sp.x - bw / 2));
    const txt = s.tekst.length > 150 ? s.tekst.slice(0, 147) + '…' : s.tekst;
    bubble = `<div class="bubble" id="miniBubble" style="width:${bw}px;left:${left}px;top:0;--tail:${Math.max(14, Math.min(bw - 30, sp.x - left - 9))}px;visibility:hidden"><div class="who" style="color:${darken(sp.t.look?.kleur)}">${sp.vz ? '🔨 ' : ''}${esc(sp.t.name)}</div>${esc(txt)}<div>${bronChips(s.bronnen, false)}</div></div>`;
  }
  box.innerHTML = arcs + seats + podium + bubble;
  const bEl = $('#miniBubble');
  if (bEl && sp) { bEl.style.top = Math.max(-4, sp.y - 23 - 12 - bEl.offsetHeight) + 'px'; bEl.style.visibility = 'visible'; }
  $('#miniFase').textContent = faseTekst(s);
  toonLive(s);
  toonSpoed(s);
  renderVoorstel(s);
  renderArgumenten(s);
}
// Uurcheck en voorzitting: wat er elk uur gebeurde en waarom er wel of geen zitting kwam
function voorzittingKaart() {
  const lijst = D.voorzittingen || []; if (!lijst.length) return '';
  const BES = { ZITTING: ['VOOR', 'Zitting'], GEEN_ZITTING: ['NIKS', 'Geen zitting'], RUSTIG: ['NIKS', 'Rustig'] };
  return `<div class="card"><div class="card-h"><h2>Elk uur: is er een zitting nodig?</h2></div>
    <p class="mut" style="font-size:12.5px;padding:0 16px">Elk uur kijkt de app of er iets gebeurt. Zo ja, dan bekijken Voorzitter Eva, Daan en Noor eerst de kansen. Alleen bij een echte kans (score 6 of hoger) komt er een zitting.</p>
    ${lijst.slice(0, 6).map(v => { const [cls, lbl] = BES[v.besluit] || ['NIKS', v.besluit]; return `<div class="vz"><div class="vzt"><span class="mono">${tijd(v.t)}</span><span class="tag ${cls}">${lbl}</span>${v.besluit !== 'RUSTIG' ? `<span class="modeltag ${/haiku/.test(v.model || '') ? 'haiku' : 'sonnet'}">${/haiku/.test(v.model || '') ? 'Haiku 5.5' : 'Sonnet 5.5'}</span>` : ''}</div>
      ${v.aanleiding?.length ? `<div class="vza">${v.aanleiding.slice(0, 3).map(a => `<span class="chip">${esc(a.tekst)}</span>`).join('')}</div>` : ''}
      ${(v.kansen || []).map(k => `<div class="vzk"><b>${esc(k.asset)}</b> <span class="tag ${k.richting === 'VERKOOP' ? 'VERKOOP' : 'KOOP'}">${esc(k.richting)}</span><span class="score ${k.score >= 6 ? 'hoog' : ''}">${k.score}/10</span><span class="mut">${esc(k.waarom)}</span></div>`).join('')}
      ${v.reden ? `<div class="mut" style="font-size:12px">${esc(v.reden)}</div>` : ''}</div>`; }).join('')}
  </div>`;
}
// Na de stemming: alle argumenten voor en tegen, per trader
function argumentLijst(s) {
  const regels = Object.entries(s.stemmen || {}).map(([id, v]) => {
    const t = traderMap[id] || { name: id, look: {} };
    const debat = s.transcript.filter(m => m.trader_id === id && m.phase === 'debat').at(-1);
    return { id, t, ...v, debat };
  });
  return { voor: regels.filter(r => r.stem === 'VOOR'), tegen: regels.filter(r => r.stem !== 'VOOR') };
}
function argumentRij(r) {
  return `<div class="arg"><img src="${avatarUrl(r.t.look, { size: 64 })}" width="34" height="34" alt=""><div><b style="color:${darken(r.t.look?.kleur)}">${esc(r.t.name)}</b> <span class="modeltag ${modelVan(r.t)}">${MODEL_NAAM[modelVan(r.t)] || ''}</span>${r.stem === 'VOOR' && r.bedrag ? ` <span class="chip" style="font-size:11px;padding:2px 7px">wil €${nf(r.bedrag, 0)}</span>` : ''}<p>${esc(r.reden || '')}</p>${r.debat ? `<small>In het debat: “${esc(r.debat.text.length > 140 ? r.debat.text.slice(0, 137) + '…' : r.debat.text)}”</small>` : ''}<div>${bronChips(r.bronnen)}</div></div></div>`;
}
function renderArgumenten(s) {
  const el = $('#argumentenCard'); if (!el) return;
  const klaar = s.fase === 'uitslag' && Object.keys(s.stemmen || {}).length;
  el.hidden = !klaar; if (!klaar) return;
  const { voor, tegen } = argumentLijst(s);
  el.innerHTML = `<div class="card-h"><h2>Argumenten na de stemming</h2><span class="tag ${s.uitslag?.uitkomst === 'UITGEVOERD' ? 'VOOR' : 'TEGEN'}">${s.uitslag?.uitkomst === 'UITGEVOERD' ? 'AANGENOMEN' : esc(s.uitslag?.uitkomst || 'AFGEWEZEN')}</span></div>
    <div class="args"><div class="argkol voor"><h3>Voor <b>${voor.length}</b></h3>${voor.map(argumentRij).join('') || '<p class="mut">Niemand.</p>'}</div>
    <div class="argkol tegen"><h3>Tegen <b>${tegen.length}</b></h3>${tegen.map(argumentRij).join('') || '<p class="mut">Niemand.</p>'}</div></div>`;
}
function toonAanleiding(s) {
  const el = $('#aanleidingBalk'); if (!el) return;
  const a = s.aanleiding || D.round?.aanleiding;
  el.innerHTML = a?.length && !s.spoed ? `<div class="aanleiding"><span class="eyebrow">Waarom deze zitting</span>${a.map(x => `<span class="chip">${esc(x.tekst)}</span>`).join('')}</div>` : '';
}
function toonSpoed(s) {
  toonAanleiding(s);
  const el = $('#spoedBalk'); if (!el) return;
  const pill = $('#livePill');
  if (!s.spoed) { el.innerHTML = ''; if (pill) pill.innerHTML = '<span class="dot red"></span>LIVE'; return; }
  if (pill) { pill.innerHTML = '<span class="dot red"></span>SPOEDZITTING'; pill.style.color = 'var(--red)'; pill.style.borderColor = '#FECDD6'; }
  el.innerHTML = `<a class="spoed" href="${esc(veiligeUrl(s.spoed.url))}" target="_blank" rel="noopener"><span class="lbl">SPOED</span><span><b>${esc(s.spoed.titel)}</b><small>${esc(s.spoed.uitgever || '')} · raakt ${esc((s.spoed.assets || []).map(a => a === 'MARKT' ? 'de hele markt' : a).join(', '))}</small></span></a>`;
}
const faseTekst = s => ({ wachten: 'wacht op de volgende zitting', analyse: 'traders lezen het nieuws', voorstel: `voorstellen (${s.voorstellen.length})`, debat: `debat · beurt ${s.transcript.filter(m => m.trader_id !== 'voorzitter').length}${s.hierna ? ` · hierna ${traderMap[s.hierna]?.name || ''}` : ''}`, stemming: s.voor + s.tegen ? `stemming ${s.voor + s.tegen}/${actieveTraders().length}` : 'leden lopen naar de stemhokjes', uitslag: 'uitslag' }[s.fase] || '');
const darken = c => ({ '#60A5FA': '#1D4ED8', '#FB923C': '#C2410C', '#A78BFA': '#6D28D9', '#FACC15': '#A16207', '#F472B6': '#BE185D', '#22D3EE': '#0E7490', '#4ADE80': '#15803D', '#CBD5E1': '#475569', '#2DD4BF': '#0F766E', '#FB7185': '#BE123C' }[c] || '#C2410C');
const bronChips = (ids = [], dark = true) => ids.map(id => { const s = D.sources?.[id]; return `<button class="src" data-src="${esc(id)}" type="button">${esc(id)}${s ? ' · ' + esc(s.publisher) : ''}</button>`; }).join('');

// ---------- MARKT ----------
let marktFilter = 'alles';
const _bo = 0;
const BEURS_OPEN = () => { const d = new Date(), dag = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return dag > 0 && dag < 6 && m >= 870 && m <= 1255; };
function nieuwsVoor(m) {
  const w = [m.symbol.toLowerCase(), m.name.toLowerCase().split(' ')[0]];
  return (D.headlines || []).filter(h => w.some(x => new RegExp(`(^|[^a-z])${x}([^a-z]|$)`, 'i').test(h.title)));
}
let marktZoek = '', marktSort = 'groot', marktOpen = null;
function kleurVan(sym) {
  if (COIN[sym]) return COIN[sym];
  let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 360;
  return [`hsl(${h} 70% 95%)`, `hsl(${h} 55% 32%)`];
}
function renderMarktView() {
  const el = $('#v-markt');
  if (!el.querySelector('#mzoek')) {
    const fg = Object.values(D.sources || {}).find(x => x.kind === 'sentiment');
    el.innerHTML = `
    <h2 class="pagetitle">Markt</h2>
    <div class="chips" style="margin-bottom:12px">
      <span class="chip"><span class="dot" style="${BEURS_OPEN() ? '' : 'background:#8A93A8;animation:none'}"></span>Amerikaanse beurs ${BEURS_OPEN() ? 'open' : 'dicht'}</span>
      <span class="chip">Crypto: altijd open</span>
      ${fg ? `<span class="chip">${esc(stemmingTekst(fg.title))}</span>` : ''}
    </div>
    <input id="mzoek" class="zoek" type="search" placeholder="Zoek munt of aandeel…" aria-label="Zoek munt of aandeel" value="${esc(marktZoek)}">
    <div class="seg" id="mfilter" style="margin:10px 0 8px"></div>
    <div class="catchips" id="mcat"></div>
    <div class="sorts" id="msort"></div>
    <div class="card" id="mlijst"></div>
    <p class="bronvermelding">Cryptokoersen: data provided by <a href="https://www.coingecko.com" target="_blank" rel="noopener">CoinGecko</a>. Aandelen: Finnhub en Financial Modeling Prep.</p>`;
    $('#mzoek').addEventListener('input', e => { marktZoek = e.target.value; tekenMarktLijst(); });
  }
  tekenMarktLijst();
}
function tekenMarktLijst() {
  const past = (m, k) => k === 'alles' || m.kind === k || m.cat === k;
  const tel = k => D.market.filter(m => past(m, k)).length;
  $('#mfilter').innerHTML = [['alles', 'Alles'], ['crypto', 'Crypto'], ['aandeel', 'Aandelen'], ['etf', 'ETF\'s']].map(([k, l]) => `<button type="button" data-markt="${k}" class="${k === marktFilter ? 'on' : ''}">${l}<small> ${tel(k)}</small></button>`).join('')
;
  $('#mcat').innerHTML = `${[['vastgoed', '🏢 Vastgoed'], ['obligatie', '🏛 Obligaties'], ['grondstof', '🛢 Grondstoffen'], ['europa', '🇪🇺 Europa'], ['dividend', '💶 Dividend'], ['staking', '🔒 Staking']].map(([k, l]) => `<button type="button" data-markt="${k}" class="${k === marktFilter ? 'on' : ''}">${l}</button>`).join('')}`;
  $('#msort').innerHTML = [['groot', 'Grootste'], ['stijgers', 'Stijgers'], ['dalers', 'Dalers'], ['bezit', 'In bezit']].map(([k, l]) => `<button type="button" data-msort="${k}" class="${k === marktSort ? 'on' : ''}">${l}</button>`).join('');
  const z = marktZoek.trim().toLowerCase();
  const divRend = s => D.state?.dividend?.rendement?.[s]?.pct || 0, heeftDiv = s => divRend(s) > 0 || (D.state?.dividend?.events || []).some(e => e.sym === s);
  let lijst = D.market.filter(m => marktFilter === 'dividend' ? heeftDiv(m.symbol) : marktFilter === 'staking' ? STAKING[m.symbol] : past(m, marktFilter))
    .filter(m => !z || m.symbol.toLowerCase().includes(z) || m.name.toLowerCase().includes(z));
  const c = m => Number(m.chg24h) || 0;
  const SOORT = { crypto: 0, aandeel: 1, etf: 2 };
  if (marktSort === 'groot') lijst.sort((a, b) => (SOORT[a.kind] ?? 3) - (SOORT[b.kind] ?? 3) || (a.rank ?? 999) - (b.rank ?? 999));
  if (marktSort === 'stijgers') lijst.sort((a, b) => c(b) - c(a));
  if (marktSort === 'dalers') lijst.sort((a, b) => c(a) - c(b));
  if (marktSort === 'bezit') lijst = lijst.filter(m => D.state?.positions?.[m.symbol]);
  const chip = (lbl, v) => isFinite(v) && v !== null ? `<span class="chg ${v >= 0 ? 'up' : 'dn'}"><small>${lbl}</small>${pct(v, 1)}</span>` : '';
  $('#mlijst').innerHTML = lijst.map(m => {
    const [bg, fgc] = kleurVan(m.symbol), p = Number(m.price), ch = c(m), open = marktOpen === m.symbol;
    const pos = D.state?.positions?.[m.symbol], nw = nieuwsVoor(m).slice(0, 2);
    return `<button type="button" class="row mrow" data-mopen="${esc(m.symbol)}" aria-expanded="${open}">
        <div class="coin" style="background:${bg};color:${fgc}">${esc(m.symbol.slice(0, 5))}</div>
        <div class="nm"><b>${esc(m.name)}${pos ? '<span class="lv" style="background:#FFF1E8;color:#C2410C">BEZIT</span>' : ''}</b><span>${m.kind === 'etf' ? 'ETF · ' : m.rank ? '#' + m.rank + ' · ' : ''}${esc(m.symbol)}${CAT_LABEL[m.cat] ? ' · ' + CAT_LABEL[m.cat] : ''}${STAKING[m.symbol] ? ` · staking ${nf(STAKING[m.symbol] * 100, 1)}%` : divRend(m.symbol) ? ` · dividend ${nf(divRend(m.symbol), 1)}%` : ''}</span></div>
        ${spark(m.history, 64, 26, ch >= 0)}
        <div class="px"><b>${prijs(p)}</b><span class="${ch >= 0 ? 'up' : 'dn'}">${pct(ch)}</span></div>
      </button>
      ${open ? `<div class="mdetail">
        <div class="mspark">${spark(m.history, 320, 64, ch >= 0)}</div>
        <div class="mchips">${chip('1u', Number(m.chg1h))}${chip('24u', Number(m.chg24h))}${chip('7d', Number(m.chg7d))}${m.rsi != null ? `<span class="chg"><small>RSI</small>${Math.round(m.rsi)}</span>` : ''}${m.trend ? `<span class="chg"><small>trend</small>${esc(m.trend)}</span>` : ''}</div>
        ${opbrengstInfo(m.symbol)}
        ${pos ? `<div class="mpos">In bezit: <b>${eur(pos.qty * p)}</b> <span class="${pos.qty * p >= pos.cost ? 'up' : 'dn'}">${pct(pos.qty * p / pos.cost - 1, 1)}</span></div>` : ''}
        ${nw.map(n => `<a class="mnews" href="${esc(veiligeUrl(n.url))}" target="_blank" rel="noopener"><span class="tag NIKS">NIEUWS</span>${esc(n.title)}</a>`).join('')}
        <div class="mut" style="font-size:11.5px;margin-top:8px">Bron: ${esc(m.source || '')} · ${geleden(m.updated_at)}</div>
      </div>` : ''}`;
  }).join('') || '<div class="card-b mut">Niets gevonden.</div>';
}
// ---------- dividend en staking ----------
const STAKING = { ETH: 0.025, SOL: 0.055, ADA: 0.022, DOT: 0.10, ATOM: 0.12, AVAX: 0.055, NEAR: 0.06, TRX: 0.035, SUI: 0.025, APT: 0.06, TON: 0.03, POL: 0.025, INJ: 0.08, TIA: 0.08, SEI: 0.04 };
const CAT_LABEL = { vastgoed: 'vastgoed', obligatie: 'obligaties', grondstof: 'grondstof', europa: 'Europa' };
function opbrengstInfo(sym) {
  const d = D.state?.dividend, vandaag = new Date().toISOString().slice(0, 10);
  const e = (d?.events || []).filter(e => e.sym === sym && e.ex >= vandaag).sort((a, b) => a.ex.localeCompare(b.ex))[0];
  const delen = [];
  if (STAKING[sym]) delen.push(`🔒 Staking: ongeveer <b>${nf(STAKING[sym] * 100, 1)}%</b> per jaar zolang het parlement het bezit (schatting, na commissie).`);
  if (e) delen.push(`💶 Volgende ex-dividenddatum <b>${new Date(e.ex).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</b>: $${e.bedrag} per aandeel, betaald ${new Date(e.pay).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}.`);
  else if (d?.rendement?.[sym]?.pct) delen.push(`💶 Dividendrendement ongeveer <b>${nf(d.rendement[sym].pct, 1)}%</b> per jaar.`);
  return delen.length ? `<div class="mopbr">${delen.join('<br>')}</div>` : '';
}
function extraOpbrengsten() {
  const st = D.state || {}, d = st.dividend || {};
  const ontv = (d.ontvangen || []).slice().reverse(), totDiv = ontv.reduce((a, r) => a + r.eur, 0);
  const stak = Object.entries(st.staking || {}), totStak = stak.reduce((a, [, v]) => a + v, 0);
  return `<div class="card"><div class="card-h"><h2>Extra opbrengsten</h2><span class="chip" style="background:#FFF8E6;border-color:#F5DFA8;color:#8A6418">pot €${nf(st.pot || 0)}</span></div>
    <div class="card-b">
      <div class="stats" style="margin:0 0 6px"><div><b>${eur(totDiv)}</b><span>Dividend ontvangen</span></div><div><b>${eur(totStak)}</b><span>Staking</span></div><div><b>${eur(Number(st.pot || 0))}</b><span>In de pot</span></div></div>
      <p class="mut" style="font-size:12.5px">Dividend komt na 15% belasting apart in de <b>dividendpot</b>. De traders gebruiken die alleen als het echt moet, met 7 van de 10 stemmen. Staking wordt direct bij de munt opgeteld.</p>
    </div>
    ${ontv.slice(0, 6).map(r => `<div class="row"><div class="coin" style="background:#FFF8E6;color:#8A6418">${esc(r.sym)}</div><div class="nm"><b>Dividend ${esc(r.sym)}</b><span>${new Date(r.datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}${r.soort === 'schatting' ? ' · schatting' : ''}</span></div><div class="px"><b class="up">+${eur(r.eur)}</b></div></div>`).join('')}
    ${stak.map(([s, v]) => `<div class="row"><div class="coin" style="background:#EEF0FF;color:#4338CA">${esc(s)}</div><div class="nm"><b>Staking ${esc(s)}</b><span>${nf((STAKING[s] || 0) * 100, 1)}% per jaar</span></div><div class="px"><b class="up">+${eur(v)}</b></div></div>`).join('')}
  </div>`;
}

// ---------- PORTEFEUILLE ----------
let bereik = '1W';
function renderPortefeuille() {
  const v = waarde(), b = benchWaarde(), r = v / 1000 - 1;
  const [heel, cent] = nf(v).split(',');
  const pos = Object.entries(D.state?.positions || {}).filter(([, p]) => p.qty > 0).map(([s, p]) => ({ s, p, val: p.qty * (prijzen[s] || 0) })).sort((a, b) => b.val - a.val);
  const kleuren = ['#F25600', '#0891B2', '#059669', '#7E22CE', '#E11D48', '#D97706', '#0369A1'];
  const delen = [{ naam: 'Vrij geld', val: Number(D.state?.cash || 0), kleur: '#CBD2E1' }, ...(D.state?.pot ? [{ naam: 'Dividendpot', val: Number(D.state.pot), kleur: '#B8862B' }] : []), ...pos.map((x, i) => ({ naam: x.s, val: x.val, kleur: kleuren[i % kleuren.length] }))];
  $('#v-portefeuille').innerHTML = `
  <h2 class="pagetitle">Portefeuille</h2>
  <div class="grid">
    <div class="col">
      <div class="card hero">
        <span class="eyebrow">Totale waarde · nepgeld</span>
        <div class="money"><span class="cur">€</span><span class="big">${heel}</span><span class="cents">,${cent}</span></div>
        <div class="chips"><span class="chip ${r >= 0 ? 'up' : 'dn'}">${eur(v - 1000)} · ${pct(r)}</span><span class="chip">gewoon laten liggen: ${pct(b / 1000 - 1)}</span></div>
        <div class="seg" style="margin-top:14px">${['1D', '1W', '1M', 'Alles'].map(k => `<button type="button" data-bereik="${k}" class="${k === bereik ? 'on' : ''}">${k}</button>`).join('')}</div>
        <canvas id="pfChart" style="height:190px" aria-label="Portefeuille tegen gewoon laten liggen"></canvas>
        <div class="legend" style="grid-template-columns:repeat(2,auto);justify-content:start;gap:8px 18px"><span><i style="background:#F25600"></i>Parlement</span><span><i style="background:#A3AAC2"></i>Gewoon laten liggen</span></div>
      </div>
      <div class="card"><div class="card-h"><h2>Verdeling</h2><span class="mut" style="font-size:12px">max 25% per asset</span></div>
        <div class="card-b"><div class="alloc">${delen.filter(d => d.val > 0).map(d => `<i style="width:${d.val / v * 100}%;background:${d.kleur}"></i>`).join('')}</div>
        <div class="legend">${delen.map(d => `<span><i style="background:${d.kleur}"></i>${esc(d.naam)}<b>${Math.round(d.val / v * 100)}%</b></span>`).join('')}</div></div></div>
    </div>
    <div class="col">
      <div class="card"><div class="card-h"><h2>Posities</h2></div>
        ${pos.map(({ s, p, val }) => { const [bg, fg] = kleurVan(s); const res = val / p.cost - 1; return `<div class="row"><div class="coin" style="background:${bg};color:${fg}">${esc(s)}</div><div class="nm"><b>${esc(D.market.find(m => m.symbol === s)?.name || s)}</b><span>${nf(p.qty, p.qty < 1 ? 5 : 3)} stuks · ingelegd ${eur(p.cost)}</span></div><div class="px"><b>${eur(val)}</b><span class="${res >= 0 ? 'up' : 'dn'}">${pct(res, 1)}</span></div></div>`; }).join('') || '<div class="card-b mut">Nog geen posities: alles staat in cash.</div>'}
      </div>
      ${extraOpbrengsten()}
      <div class="card"><div class="card-h"><h2>Laatste besluiten</h2></div>
        ${(D.trades || []).slice(0, 12).map(t => `<div class="row"><span class="tag ${esc(t.actie)}">${esc(t.actie)}</span><div class="nm"><b>${eur(Number(t.bedrag))} ${esc(t.asset)}</b><span>${dag(t.t)} · tegen ${prijs(t.prijs)}</span></div><span class="mono" style="font-size:13px">${t.votes_for}/10</span></div>`).join('') || '<div class="card-b mut">Nog geen trades.</div>'}
      </div>
    </div>
  </div>`;
  requestAnimationFrame(tekenPf);
}
function tekenPf() {
  const c = $('#pfChart'); if (!c) return;
  const uren = { '1D': 24, '1W': 168, '1M': 720, Alles: 1e9 }[bereik];
  const grens = Date.now() - uren * 3600000;
  const s = (D.snapshots || []).filter(x => new Date(x.t) >= grens);
  lijn(c, [
    { data: s.map(x => Number(x.bench)), color: '#A3AAC2', dash: true, w: 1.6 },
    { data: s.map(x => Number(x.value)), color: '#F25600', w: 2.6, fill: 'rgba(242,86,0,.12)' },
  ], { labels: true, pad: 10 });
}

// ---------- TRADERS ----------
function renderTraders() {
  const act = actieveTraders().map(t => ({ t, ...score(t) })).sort((a, b) => (b.acc ?? -1) - (a.acc ?? -1) || b.n - a.n);
  const weg = D.traders.filter(t => t.active === false);
  const top = act.slice(0, 3);
  const podium = [top[1], top[0], top[2]].filter(Boolean).map(x => {
    const plek = act.indexOf(x) + 1, hgt = { 1: 96, 2: 70, 3: 52 }[plek], col = { 1: '#FDE68A', 2: '#E2E8F0', 3: '#FED7AA' }[plek], sz = plek === 1 ? 72 : 58;
    return `<div class="p"><img src="${avatarUrl(x.t.look, { size: 96 })}" width="${sz}" height="${sz}" alt=""><b>${esc(x.t.name)}</b><span class="mono mut">${x.acc == null ? '–' : Math.round(x.acc * 100) + '%'}</span><div class="blk" style="height:${hgt}px;background:${col}">${plek}</div></div>`;
  }).join('');
  const nu = new Date(), wissel = new Date(nu.getFullYear(), nu.getMonth() + 1, 1);
  $('#v-traders').innerHTML = `
  <h2 class="pagetitle">Traders</h2>
  <div class="grid">
    <div class="col">
      <div class="card" style="background:linear-gradient(180deg,#EEF0FF,#fff 75%)"><div class="podium3">${podium}</div></div>
      <div class="card"><div class="card-h"><h2>Maandelijkse wissel</h2><span class="chip">${wissel.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}</span></div>
        <div class="card-b mut" style="font-size:13.5px">Op de 1e van de maand verlaat de slechtste trader de zaal, als hij minstens 100 beoordeelde stemmen heeft én onder de 48% scoort (slechter dan een muntje opgooien). Stemmen worden na 3 dagen beoordeeld. Een nieuwe trader met een andere stijl neemt zijn plek in.</div>
        ${weg.length ? `<div class="card-b" style="padding-top:0"><span class="eyebrow">Vertrokken</span>${weg.map(t => `<div class="tr" style="padding-left:0;padding-right:0"><img src="${avatarUrl(t.look, { size: 64 })}" width="36" height="36" alt="" style="filter:grayscale(1);opacity:.6"><div class="info"><b>${esc(t.name)}</b><span class="rol">${esc(t.role)}</span><div class="mut" style="font-size:12px">${esc(t.left_reason || '')} · ${t.left_at ? dag(t.left_at) : ''}</div></div></div>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="col"><div class="card">
      ${act.map((x, i) => { const d = opSchopstoel(x.t); return `<div class="tr ${d ? 'danger' : ''}"><span class="rank">#${i + 1}</span><img src="${avatarUrl(x.t.look, { size: 96 })}" width="46" height="46" alt=""><div class="info"><b style="color:${darken(x.t.look?.kleur)}">${esc(x.t.name)}</b><span class="rol">${esc(x.t.role)}</span> <span class="modeltag ${modelVan(x.t)}">${MODEL_NAAM[modelVan(x.t)]}</span>${d ? '<span class="danger-tag">SCHOPSTOEL</span>' : ''}<div class="bar"><i style="width:${(x.acc ?? 0) * 100}%"></i></div><span class="mut" style="font-size:11.5px">${x.t.goed || 0} goed · ${x.t.fout || 0} fout · ${x.t.bronnen || 0} bronnen gebruikt${x.t.geschrapt ? ` · ${x.t.geschrapt}× geschrapt` : ''}</span></div><span class="score">${x.acc == null ? '–' : Math.round(x.acc * 100) + '%'}</span></div>`; }).join('')}
    </div></div>
  </div>`;
}

// ---------- 3D ZAAL ----------
let zaal = null, zaalLaden = null;
async function openZaal() {
  $('#zaal3d').classList.add('on'); document.body.classList.add('inzaal');
  if (!zaal) {
    zaalLaden ||= import('./zaal3d.js').then(m => m.maakZaal($('#zaal3d'), actieveTraders(), { bubble: $('#bubble3d'), bronChips, voorzitter: VOORZITTER, onCamera: m => document.querySelectorAll('[data-cam]').forEach(x => x.classList.toggle('on', x.dataset.cam === m)) }));
    zaal = await zaalLaden;
    speler.op(s => { zaal.update(s); renderTranscript(s); });
  }
  zaal.start(); zaal.update(speler.s);
  if (!D.demo && D.round?.status !== 'bezig') speler.speel(D.round, D.messages); // herhaling van de laatste ronde
}
function sluitZaal() { $('#zaal3d').classList.remove('on'); document.body.classList.remove('inzaal'); zaal?.stop(); }
function renderTranscript(s) {
  $('#zaalSub').textContent = `${s.spoed ? 'Spoedzitting' : 'Zitting ' + (D.round?.no ?? '')} · ${faseTekst(s)}`;
  $('#zaalLive').innerHTML = `<span class="dot red"></span>${s.spoed ? 'SPOEDZITTING' : 'LIVE'}`;
  $('#zaalLive').classList.toggle('spoedpill', !!s.spoed);
  const lijst = s.fase === 'stemming' || s.fase === 'uitslag'
    ? Object.entries(s.stemmen).map(([id, v]) => ({ trader_id: id, text: v.reden, sources: v.bronnen, stem: v.stem }))
    : s.transcript.slice().reverse();
  $('#sheetTitle').textContent = s.fase === 'stemming' || s.fase === 'uitslag' ? 'Stemmen' : 'Eerder in dit debat';
  const smal = innerWidth < 820, open = $('.sheet').classList.contains('open');
  $('#sheetCount').textContent = s.fase === 'uitslag' && s.uitslag ? s.uitslag.tekst : `${lijst.length} berichten${smal ? (open ? ' · tik om te sluiten' : ' · tik voor alles') : ''}`;
  if (s.fase === 'uitslag' && Object.keys(s.stemmen || {}).length) {
    const { voor, tegen } = argumentLijst(s);
    $('#sheetTitle').textContent = 'Argumenten na de stemming';
    $('#transcript').innerHTML = `<div class="argkol voor"><h3>Voor <b>${voor.length}</b></h3>${voor.map(argumentRij).join('')}</div><div class="argkol tegen"><h3>Tegen <b>${tegen.length}</b></h3>${tegen.map(argumentRij).join('')}</div>`;
    return;
  }
  $('#transcript').innerHTML = lijst.map(m => { const t = traderMap[m.trader_id] || { name: m.trader_id, look: {} }; return `<div class="tline ${m.action?.geschrapt ? 'geschrapt' : ''}"><img src="${avatarUrl(t.look, { size: 64 })}" width="30" height="30" alt=""><div><b style="color:${darken(t.look?.kleur)}">${esc(t.name)}</b>${m.stem ? ` <span class="tag ${esc(m.stem)}">${esc(m.stem)}</span>` : ''} <span>${esc(m.text)}</span>${m.action?.geschrapt && m.action.tekst ? `<del>${esc(m.action.tekst)}</del>` : ''}<div>${bronChips(m.sources)}</div></div></div>`; }).join('') || '<p class="mut" style="font-size:13px;padding:8px 0">De traders analyseren de bronnen…</p>';
}

// ---------- bron-popover ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-src]');
  const pop = $('#popover');
  if (b) {
    const s = D.sources?.[b.dataset.src];
    pop.innerHTML = s ? `<div class="eyebrow" style="color:var(--iris)">Bron ${esc(s.id)} · ${esc(s.kind)}</div><p style="margin:6px 0 4px;font-weight:600">${esc(s.title)}</p><p class="mut" style="font-size:12.5px">${esc(s.publisher)} · ${dag(s.published_at)}</p>${s.url ? `<a class="btn ghost" style="margin-top:12px;min-height:42px" href="${esc(veiligeUrl(s.url))}" target="_blank" rel="noopener">Open de bron</a>` : ''}` : `<p>Bron ${esc(b.dataset.src)} niet gevonden.</p>`;
    pop.classList.add('on'); e.stopPropagation(); return;
  }
  if (!e.target.closest('#popover')) pop.classList.remove('on');
  const mf = e.target.closest('[data-markt]');
  if (mf) { marktFilter = mf.dataset.markt; tekenMarktLijst(); return; }
  const ms = e.target.closest('[data-msort]');
  if (ms) { marktSort = ms.dataset.msort; tekenMarktLijst(); return; }
  const mo = e.target.closest('[data-mopen]');
  if (mo) { marktOpen = marktOpen === mo.dataset.mopen ? null : mo.dataset.mopen; tekenMarktLijst(); return; }
  const k = e.target.closest('[data-bereik]');
  if (k) { bereik = k.dataset.bereik; renderPortefeuille(); }
});
$('#btnReplay').onclick = () => speler.speel(D.round, D.messages, { lus: D.demo });
document.querySelectorAll('.sheet .grip, .sheet .hd').forEach(el => el.onclick = () => { $('.sheet').classList.toggle('open'); renderTranscript(speler.s); });
document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => { zaal?.camera(b.dataset.cam); document.querySelectorAll('[data-cam]').forEach(x => x.classList.toggle('on', x === b)); });

// ---------- router ----------
function route() {
  const h = (location.hash || '#home').slice(1);
  const tab = ['home', 'markt', 'zaal', 'portefeuille', 'traders', 'bronnen'].includes(h) ? h : 'home';
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (tab === 'zaal') { openZaal(); return; }
  sluitZaal();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + tab));
  if (tab === 'home') renderHome(); else if (tab === 'markt') renderMarktView(); else if (tab === 'portefeuille') renderPortefeuille(); else if (tab === 'bronnen') renderBronnen(); else renderTraders();
}
addEventListener('hashchange', route);
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const h = location.hash.slice(1) || 'home'; if (h === 'home') renderHome(); if (h === 'portefeuille') tekenPf(); }, 150); });

// ---------- BRONNEN ----------
// Alle bronnen van Hamerslag, met een lampje: werkt hij nu? De motor schrijft na elke check per bron
// in state.bronStatus: { [id]: { ok, t, melding, aantal } }.
const BRONNEN_LIJST = [
  { groep: 'Koersen', id: 'coingecko', naam: 'CoinGecko', wat: 'Crypto-koersen', sleutel: true, elk: 'uur', url: 'https://www.coingecko.com' },
  { groep: 'Koersen', id: 'bitvavo', naam: 'Bitvavo', wat: 'Controle van de crypto-koersen, en reserve', sleutel: false, elk: 'uur', url: 'https://bitvavo.com' },
  { groep: 'Koersen', id: 'finnhub_koers', naam: 'Finnhub', wat: 'Koersen van aandelen, ETF\'s en goud', sleutel: true, elk: 'uur', url: 'https://finnhub.io' },
  { groep: 'Koersen', id: 'fmp', naam: 'Financial Modeling Prep', wat: 'Reserve voor aandelen en exact dividend', sleutel: true, elk: 'dag', url: 'https://financialmodelingprep.com' },
  { groep: 'Koersen', id: 'frankfurter', naam: 'ECB-wisselkoers', wat: 'Dollar naar euro (via Frankfurter)', sleutel: false, elk: 'uur', url: 'https://www.frankfurter.app' },
  { groep: 'Nieuws', id: 'finnhub_nieuws', naam: 'Finnhub nieuws', wat: 'Algemeen beurs- en cryptonieuws', sleutel: true, elk: 'uur', url: 'https://finnhub.io' },
  { groep: 'Nieuws', id: 'finnhub_bedrijf', naam: 'Nieuws per aandeel', wat: 'Nieuws over wat ze bezitten en wat beweegt (Finnhub)', sleutel: true, elk: 'zitting', url: 'https://finnhub.io' },
  { groep: 'Nieuws', id: 'nos', naam: 'NOS', wat: 'Algemeen en economie', sleutel: false, elk: 'uur', url: 'https://nos.nl' },
  { groep: 'Nieuws', id: 'coindesk', naam: 'CoinDesk', wat: 'Cryptonieuws', sleutel: false, elk: 'uur', url: 'https://www.coindesk.com' },
  { groep: 'Officieel en economie', id: 'ecb', naam: 'ECB', wat: 'Persberichten en rentebesluiten', sleutel: false, elk: 'uur', url: 'https://www.ecb.europa.eu' },
  { groep: 'Officieel en economie', id: 'fed', naam: 'Federal Reserve', wat: 'Rentebesluiten van de VS', sleutel: false, elk: 'uur', url: 'https://www.federalreserve.gov' },
  { groep: 'Officieel en economie', id: 'sec', naam: 'SEC EDGAR', wat: 'Officiële meldingen van bedrijven', sleutel: false, elk: 'zitting', url: 'https://www.sec.gov/edgar' },
  { groep: 'Officieel en economie', id: 'cijfers', naam: 'Cijferkalender', wat: 'Wie de komende 7 dagen kwartaalcijfers brengt (Finnhub)', sleutel: true, elk: 'zitting', url: 'https://finnhub.io' },
  { groep: 'Officieel en economie', id: 'fred', naam: 'FRED', wat: 'Rente, inflatie, werkloosheid en de VIX', sleutel: true, elk: 'zitting', url: 'https://fred.stlouisfed.org' },
  { groep: 'Officieel en economie', id: 'feargreed', naam: 'Fear & Greed', wat: 'Stemming op de cryptomarkt', sleutel: false, elk: 'zitting', url: 'https://alternative.me/crypto/fear-and-greed-index/' },
  { groep: 'AI', id: 'anthropic', naam: 'Claude (Anthropic)', wat: 'De hersenen van de traders en de voorzitter', sleutel: true, betaald: true, elk: 'zitting', url: 'https://console.anthropic.com' },
];
// Hoe oud mag het laatste goede contact zijn voor een groen lampje?
const MAX_UUR = { '5min': 1, uur: 3, zitting: 26, dag: 50 };
function bronLamp(b, s) {
  if (!s) return { kleur: 'grijs', tekst: 'Nog niet gebruikt' };
  if (s.uit) return { kleur: 'grijs', tekst: s.melding || 'Niet ingesteld' };
  if (s.ok === false) return { kleur: 'rood', tekst: s.melding || 'Werkt niet' };
  const uur = (Date.now() - new Date(s.t)) / 3600e3;
  if (uur > MAX_UUR[b.elk]) return { kleur: 'oranje', tekst: `Laatst gelukt ${geleden(s.t)}` };
  return { kleur: 'groen', tekst: 'Actief' };
}
function renderBronnen() {
  const st = D.state?.bronStatus || {};
  const rijen = BRONNEN_LIJST.map(b => ({ b, s: st[b.id], l: bronLamp(b, st[b.id]) }));
  const tel = k => rijen.filter(r => r.l.kleur === k).length;
  const leeg = rijen.filter(r => !r.s).length, uit = tel('grijs') - leeg;
  const groepen = [...new Set(BRONNEN_LIJST.map(b => b.groep))];
  const laatst = Object.values(st).map(s => s?.t).filter(Boolean).sort().at(-1);
  const ELK = { '5min': 'elke 5 min', uur: 'elk uur', zitting: 'bij elke zitting', dag: 'dagelijks' };
  $('#v-bronnen').innerHTML = `
  <h2 class="pagetitle">Bronnen</h2>
  <div class="card bronsamen"><div class="card-b">
    <div class="bs-top"><div class="bs-groot"><b style="${tel('groen') ? '' : 'color:var(--mut)'}">${tel('groen')}</b><span>van de ${rijen.length} actief</span></div>
    <div class="bs-chips">${tel('rood') ? `<span class="chip dn">${tel('rood')} werkt niet</span>` : ''}${tel('oranje') ? `<span class="chip" style="color:#B45309">${tel('oranje')} lang stil</span>` : ''}${uit ? `<span class="chip">${uit} niet ingesteld</span>` : ''}${leeg ? `<span class="chip">${leeg} nog niet gebruikt</span>` : ''}</div></div>
    <div class="bs-balk">${rijen.map(r => `<i class="${r.l.kleur}"></i>`).join('')}</div>
    <p class="mut" style="font-size:12.5px;margin-top:10px">${laatst ? `Laatste contact ${geleden(laatst)}. ` : 'De lampjes gaan aan na de eerste uurcheck. '}Elk uur haalt de app koersen en nieuws op (de nieuwsreflex kijkt daarnaast elke 5 minuten), en bij een zitting alles.</p>
  </div></div>
  <div class="grid"><div class="col">
  ${groepen.map(g => `<div class="card"><div class="card-h"><h2>${esc(g)}</h2></div>
    ${rijen.filter(r => r.b.groep === g).map(({ b, s, l }) => `<a class="bronrij" href="${esc(b.url)}" target="_blank" rel="noopener">
      <span class="lamp ${l.kleur}"></span>
      <div class="br-m"><b>${esc(b.naam)}</b><span>${esc(b.wat)}</span><small>${ELK[b.elk]} · ${b.betaald ? 'betaald uit je tegoed' : b.sleutel ? 'gratis sleutel' : 'geen sleutel'}</small></div>
      <div class="br-s ${l.kleur}"><b>${esc(l.tekst)}</b>${s?.t && l.kleur !== 'grijs' ? `<span>${tijd(s.t)}${s.aantal != null ? ' · ' + s.aantal : ''}</span>` : ''}</div></a>`).join('')}
  </div>`).join('')}
  </div></div>
  <p class="bronvermelding">Cryptokoersen: data provided by <a href="https://www.coingecko.com" target="_blank" rel="noopener">CoinGecko</a>. This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.</p>`;
}

// ---------- start ----------
async function start() {
  D = await laad(); bereken(); window.__D = D;
  $('#demoTag').hidden = !D.demo;
  $('#sub').textContent = `${actieveTraders().length} AI-traders · nepgeld${D.demo ? ' · voorbeelddata' : ''}`;
  renderBreaking();
  speler.op(s => { if ((location.hash || '#home') === '#home') updateMini(s); });
  if (D.demo) speler.speel(D.round, D.messages, { lus: true });
  else if (D.round?.status === 'bezig') speler.speel(D.round, D.messages);
  else speler.eindstand(D.round, D.messages);
  route();
  setInterval(tikStatus, 1000); tikStatus();

  let herlaad;
  await abonneer({
    onMessage: async m => {
      if (m.round_id !== D.round?.id) {
        D.round = { id: m.round_id, no: (D.round?.no || 0) + 1, status: 'bezig' };
        D.messages = []; D.sources = await bronnenVoorRonde(m.round_id); speler.reset(D.round);
      }
      D.messages.push(m); speler.voegToe(m);
    },
    onRound: r => {
      if (r.id === D.round?.id) Object.assign(D.round, r);
      if (r.status === 'klaar') { clearTimeout(herlaad); herlaad = setTimeout(async () => { const n = await laad(); Object.assign(D, { ...n, round: D.round, messages: D.messages, sources: D.sources }); bereken(); renderBreaking(); route(); }, 4000); }
    },
    onMarket: m => { const i = D.market.findIndex(x => x.symbol === m.symbol); i >= 0 ? (D.market[i] = m) : D.market.push(m); bereken(); renderMarkt(); if (location.hash === '#markt') renderMarktView(); },
  });
}

(async function boot() {
  if (isLive() && !(await session())) {
    $('#login').hidden = false;
    $('#loginForm').onsubmit = async e => {
      e.preventDefault(); $('#loginErr').textContent = '';
      try { await login($('#em').value, $('#pw').value); $('#login').hidden = true; start(); }
      catch (err) { $('#loginErr').textContent = 'Inloggen mislukt: ' + (err.message || 'controleer je gegevens'); }
    };
    return;
  }
  start().catch(e => { console.error(e); $('#status').textContent = 'Fout bij laden'; $('#v-home').classList.add('on'); $('#v-home').innerHTML = `<div class="card"><div class="card-b">Kon de data niet laden: ${esc(e.message)}</div></div>`; });
})();

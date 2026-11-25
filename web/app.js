import { avatarUrl } from './avatar.js';
import { laad, abonneer, isLive, session, login, bronnenVoorRonde, laadRonde, stelVraag, laadVragen, laadNu, bewaarAbonnement, verwijderAbonnement } from './data.js';
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
// Statusbalk bovenaan het homescherm: wat doet de app nu? (rustig, uurcheck, voorzitting, zitting, jouw vraag)
// Tik erop: de voortgang met percentage en welke bronnen er al binnen zijn.
let statusOpen = false;
const liveVers = () => { const L = D.live; return L && L.t && Date.now() - new Date(L.t) < 15 * 60000 ? L : null; };
function stappenDeel(L) {
  const st = L?.stappen || []; if (!st.length) return 0;
  return st.reduce((a, x) => a + (['ok', 'fout', 'uit', 'overgeslagen'].includes(x.status) ? 1 : x.status === 'bezig' ? 0.5 : 0), 0) / st.length;
}
const FASEN = ['Bronnen', 'Voorstellen', 'Debat', 'Stemming', 'Uitslag'];
function voortgang(s = speler.s) {
  const L = liveVers();
  if (isBezig(s)) {
    if (L?.fase === 'zitting' && !L.bronnenKlaar) return { pct: Math.round(stappenDeel(L) * 50), fase: 0 };
    const f = s.fase, n = (s.transcript || []).filter(m => m.phase === 'debat').length;
    if (f === 'analyse') return { pct: 52, fase: 1 };
    if (f === 'voorstel') return { pct: 56, fase: 1 };
    if (f === 'debat') return { pct: Math.min(86, 60 + n * 2), fase: 2 };
    if (f === 'stemming') return { pct: 90 + Math.min(8, Object.keys(s.stemmen || {}).length), fase: 3 };
    if (f === 'uitslag') return { pct: 100, fase: 4 };
    return { pct: 50, fase: 1 };
  }
  if (L?.fase === 'zitting') return { pct: Math.round(stappenDeel(L) * 50), fase: 0 };
  if (L?.fase === 'check') return { pct: Math.round(stappenDeel(L) * 80), fase: null };
  if (L?.fase === 'voorzitting') return { pct: 90, fase: null };
  return null;
}
function statusBalk(s = speler.s) {
  const pls = '<i class="pls"></i>', L = liveVers(), vg = voortgang(s);
  const pijl = vg ? `<span class="rt" data-statusopen>${vg.pct}% ${statusOpen ? '▾' : '▴'}</span>` : '';
  if (isBezig(s) || L?.fase === 'zitting') {
    const naam = s.spoed || L?.spoed ? 'Spoedzitting' : `Zitting ${isBezig(s) ? (D.round?.no ?? '') : ''}`.trim();
    const p = isBezig(s) ? (s.voorstel || D.round?.proposal) : null;
    const wat = p ? `Op tafel: ${p.actie === 'KOOP' ? 'Koop' : 'Verkoop'} ${eur(p.bedrag, 0)} ${esc(p.asset)} · ${esc(faseTekst(s))}` : `${L?.onderwerp ? esc(L.onderwerp) + ' · ' : ''}${vg?.fase === 0 ? 'bronnen ophalen' : esc(faseTekst(s))}`;
    return `<div class="nb zit" data-statusopen><span class="ic">🔨</span><span class="tx"><b>${pls}${esc(naam)} · nu live</b><span>${wat}</span></span>${pijl}<a class="kijk" href="#zaal">Kijk mee →</a></div>`;
  }
  if (L?.fase === 'voorzitting') return `<div class="nb nvz" data-statusopen><span class="ic">⚖</span><span class="tx"><b>${pls}Voorzitting${L.assets?.length ? ' over ' + esc(L.assets.slice(0, 2).join(' en ')) : ''}</b><span>Eva, Daan en Noor bekijken: ${esc(L.onderwerp || 'wat er het afgelopen uur gebeurde')}</span></span>${pijl}</div>`;
  if (L?.fase === 'check') return `<div class="nb check" data-statusopen><span class="ic">⟳</span><span class="tx"><b>${pls}Uurcheck bezig</b><span>Koersen en nieuws ophalen: is er iets gebeurd?</span></span>${pijl}</div>`;
  const vraag = (D.vragen || []).find(v => v.status === 'wacht' || v.status === 'gestart');
  if (vraag) return `<div class="nb vraag"><span class="ic">?</span><span class="tx"><b>Jouw vraag staat klaar</b><span>"${esc(vraag.vraag)}" · ${esc(vraag.reden || 'start binnen 5 minuten')}</span></span><span class="rt">${/15:30/.test(vraag.reden || '') ? '15:30' : '≤ 5 min'}</span></div>`;
  const vz = (D.voorzittingen || [])[0], volgende = volgendeRonde(), min = Math.max(0, Math.round((volgende - Date.now()) / 60000));
  const vorige = vz ? `laatste: ${tijd(vz.t)}, ${vz.besluit === 'ZITTING' ? 'zitting gehouden' : vz.besluit === 'RUSTIG' ? 'niets bijzonders' : `geen zitting${vz.kansen?.[0] ? ` (${vz.kansen[0].asset} ${vz.kansen[0].score}/10)` : ''}`}` : 'nog geen check gehad';
  return `<div class="nb rust"><span class="ic">◷</span><span class="tx"><b>Alles rustig</b><span>Volgende check om ${String(volgende.getHours()).padStart(2, '0')}:00 · ${esc(vorige)}</span></span><span class="rt">over ${min} min</span></div>`;
}
function statusPaneel(s = speler.s) {
  const vg = voortgang(s), L = liveVers();
  if (!statusOpen || !vg) return '';
  const st = L?.stappen || [];
  const TEKST = { ok: a => a || 'binnen', fout: () => 'mislukt', uit: () => 'niet ingesteld', overgeslagen: () => 'niet nodig', bezig: () => 'bezig…', wacht: () => 'wacht' };
  const titel = L?.fase === 'check' ? 'Uurcheck' : L?.fase === 'voorzitting' ? 'Voorzitting' : 'Verloop van de zitting';
  return `<div class="pan">
    <div class="pt"><b>${titel}</b><span class="pc">${vg.pct}%</span></div>
    <div class="pbar"><i style="width:${vg.pct}%"></i></div>
    ${vg.fase != null ? `<div class="fasen">${FASEN.map((f, i) => `<span class="${i < vg.fase ? 'ok' : i === vg.fase ? 'on' : ''}">${i === vg.fase ? '● ' : i < vg.fase ? '✓ ' : ''}${f}</span>`).join('')}</div>` : L?.fase === 'voorzitting' ? '<div class="fasen"><span class="ok">✓ Bronnen</span><span class="on">● Voorzitter beslist</span><span>Zitting?</span></div>' : ''}
    ${st.map(x => `<div class="st ${x.status}"><span class="l">${x.status === 'ok' ? '✓' : x.status === 'fout' ? '!' : ''}</span><span class="n">${esc(x.naam)}<small>${esc(x.bron)}</small></span><span class="a">${esc(TEKST[x.status]?.(x.aantal) || x.status)}</span></div>`).join('') || '<p class="mut" style="font-size:12.5px;margin-top:8px">De bronnen zijn al binnen.</p>'}
    ${isBezig(s) || L?.fase === 'zitting' ? '<a class="btn" href="#zaal" style="margin-top:12px">Kijk mee in de zaal →</a>' : ''}
  </div>`;
}
function toonLive(s) {
  const el = $('#liveKaart'); if (!el) return;
  const html = statusBalk(s) + statusPaneel(s);
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
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


// ---------- MELDINGEN van de app zelf (Web Push) ----------
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isBeginscherm = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
let meldStand = null;   // 'aan' | 'uit' | 'geblokkeerd' | 'beginscherm' | 'kan-niet'
async function meldingStatus() {
  if (!('serviceWorker' in navigator)) return 'kan-niet';
  if (isIos && !isBeginscherm()) return 'beginscherm';
  if (!('PushManager' in window) || !('Notification' in window)) return isIos ? 'beginscherm' : 'kan-niet';
  if (Notification.permission === 'denied') return 'geblokkeerd';
  try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) ? 'aan' : 'uit'; } catch { return 'uit'; }
}
const sleutelBytes = b => { const s = atob((b + '='.repeat((4 - b.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function meldingenAan() {
  const key = D.state?.vapidPublic;
  if (!key && !D.demo) throw new Error('De meldingen worden ingesteld bij de eerstvolgende uurcheck. Probeer het daarna opnieuw.');
  const toestemming = await Notification.requestPermission();
  if (toestemming !== 'granted') throw new Error(toestemming === 'denied' ? 'Je hebt meldingen geweigerd. Zet ze aan in de instellingen van je telefoon.' : 'Geen toestemming gegeven.');
  const reg = await navigator.serviceWorker.ready;
  if (D.demo) { await reg.showNotification('Hamerslag', { body: 'Voorbeeld: zo ziet een melding eruit.', icon: 'icon-192.png?v=2' }).catch(() => {}); return; }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: sleutelBytes(key) });
  const j = sub.toJSON();
  await bewaarAbonnement({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, apparaat: navigator.userAgent.slice(0, 160) });
  await reg.showNotification('Meldingen staan aan', { body: 'Je krijgt nu een melding bij elke trade, spoedzitting en als er iets misgaat.', icon: 'icon-192.png?v=2', tag: 'hamerslag-aan' }).catch(() => {});
}
async function meldingenUit() {
  const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
  if (sub) { await verwijderAbonnement(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
}
function meldingenKaart(klein = false) {
  const st = meldStand;
  if (!st) return '';
  if (klein && (st === 'aan' || st === 'kan-niet' || st === 'geblokkeerd' || leesOnthoud('hs-meld-weg'))) return '';
  const UITLEG = {
    aan: 'Meldingen staan aan op dit apparaat.',
    uit: 'Krijg een melding bij elke trade, een spoedzitting, stop-loss of winst, en als er iets misgaat.',
    geblokkeerd: 'Meldingen zijn geblokkeerd voor deze app. Zet ze aan bij de instellingen van je telefoon of browser.',
    beginscherm: 'Op de iPhone werken meldingen alleen vanaf je beginscherm: tik in Safari op Deel → Zet op beginscherm, open Hamerslag daar en zet dan de meldingen aan.',
    'kan-niet': 'Deze browser ondersteunt geen meldingen.',
  };
  const knop = st === 'uit' ? '<button type="button" class="btn" data-meld="aan">Zet meldingen aan</button>' : st === 'aan' ? '<button type="button" class="btn licht" data-meld="uit">Zet meldingen uit op dit apparaat</button>' : '';
  if (klein) return `<div class="meld-balk"><span class="ic">🔔</span><span class="tx"><b>Meldingen</b><span>${esc(st === 'beginscherm' ? 'Zet de app op je beginscherm om meldingen te krijgen.' : 'Krijg een melding bij elke trade en spoedzitting.')}</span></span>${st === 'uit' ? '<button type="button" data-meld="aan">Aanzetten</button>' : ''}<button type="button" class="x" data-meld="weg" aria-label="Sluiten">✕</button></div>`;
  return `<div class="card"><div class="card-h"><h2>Meldingen <span class="tag ${st === 'aan' ? 'VOOR' : 'NIKS'}">${st === 'aan' ? 'AAN' : 'UIT'}</span></h2></div><div class="card-b">
    <p class="mut" style="font-size:13px;line-height:1.5;margin-bottom:10px">${UITLEG[st]}</p>${knop}<p class="mut" id="meldMelding" style="font-size:12px;margin-top:8px"></p></div></div>`;
}
async function verversMeldingen() {
  meldStand = await meldingStatus();
  const k = $('#meldKaart'); if (k) k.innerHTML = meldingenKaart();
  const b = $('#meldBalk'); if (b) b.innerHTML = meldingenKaart(true);
}

// ---------- HOME: overzicht in vakken ----------
const NODIG_STEMMEN = 6;
function stemmenVan(msgs) { return (msgs || []).filter(m => m.phase === 'stem' && m.action?.stem).map(m => ({ id: m.trader_id, stem: m.action.stem, reden: m.text })); }
let vraagBezig = false, logboekOpen = false;
function vraagKaart() {
  const open = (D.vragen || []).filter(v => v.status === 'wacht' || v.status === 'gestart');
  const recent = (D.vragen || []).filter(v => Date.now() - new Date(v.behandeld_at || v.t) < 24 * 3600e3 && ['gestart', 'klaar'].includes(v.status) && v.uitkomst !== 'GEEN VOORSTEL').length;
  const over = Math.max(0, 5 - recent);
  const STATUS = { wacht: 'start binnen 5 minuten', gestart: 'zitting is bezig' };
  return `<div class="card vraag"><div class="card-b">
    <div class="vr-kop"><b>Start een zitting</b><span>Leg een vraag voor aan de zaal</span></div>
    <form class="vr-in" id="vraagForm"><input id="vraagIn" maxlength="300" placeholder="Moeten we in goud investeren?" aria-label="Vraag aan de zaal" autocomplete="off"><button type="submit" ${vraagBezig ? 'disabled' : ''}>${vraagBezig ? 'Versturen…' : 'Start zitting'}</button></form>
    <div class="vr-chips">${[['Goud', 'Moeten we in goud investeren?'], ['Bitcoin', 'Is dit een goed moment voor Bitcoin?'], ['Nvidia', 'Moeten we Nvidia kopen?'], ['Iets verkopen?', 'Moeten we iets verkopen?']].map(([l, q]) => `<button type="button" data-vraagvoorbeeld="${esc(q)}">${l}</button>`).join('')}</div>
    ${open.map(v => `<div class="vr-open"><span class="dot ${v.status === 'gestart' ? 'red' : ''}"></span><b>${esc(v.vraag)}</b><span class="mut">${esc(v.status === 'wacht' && v.reden ? v.reden : STATUS[v.status])}</span></div>`).join('')}
    <div class="vr-voet mut" id="vraagMelding">${over ? `Nog ${over} eigen zitting${over === 1 ? '' : 'en'} vandaag` : 'Je eigen zittingen voor vandaag zijn op'}</div>
  </div></div>`;
}
function pfKaart() {
  const v = waarde(), b = benchWaarde(), r = v / 1000 - 1, br = b / 1000 - 1;
  const [heel, cent] = nf(v).split(',');
  const cash = D.state?.cash ?? 0;
  return `<div class="card pfk"><div class="card-b"><div style="display:flex;justify-content:space-between;align-items:center"><span class="eyebrow">Portefeuille · nepgeld</span><span class="chip ${r >= 0 ? 'up' : 'dn'}">${r >= 0 ? '▲' : '▼'} ${eur(v - 1000)} · ${pct(r)}</span></div>
    <div class="money sm"><span class="cur">€</span><span class="big">${heel}</span><span class="cents">,${cent}</span></div>
    <canvas id="heroChart" aria-label="Verloop van de portefeuille"></canvas>
    <div class="pfk-st"><span><b>${eur(cash)}</b> vrij</span><span><b>${eur(v - cash)}</b> belegd</span><span title="Wat je had gehad als je niets had gedaan"><b class="${r - br >= 0 ? 'up' : 'dn'}">${(r - br >= 0 ? '+' : '') + pct(r - br).replace('+', '')}</b> t.o.v. laten liggen</span><a href="#portefeuille">Details →</a></div></div></div>`;
}
function tegelsKaart(r, vz) {
  const bezig = isBezig(); if (bezig && D.round) r = D.round;
  const k = (vz?.kansen || [])[0], n = actieveTraders().length || 10, voor = Number(r?.votes_for ?? 0), ok = r?.outcome === 'UITGEVOERD', p = r?.proposal;
  const vandaag = d => d && new Date(d).toDateString() === new Date().toDateString();
  const zitV = (D.rondes || []).filter(x => vandaag(x.started_at) && x.status !== 'fout').length, chkV = (D.voorzittingen || []).filter(x => vandaag(x.t)).length;
  return `<div class="tegels">
    <a class="tegel" href="#zaal"><span class="eyebrow">${bezig ? 'Nu in de zaal' : 'Laatste zitting'}</span><b>${p ? `${esc(p.asset)} ${p.actie === 'KOOP' ? 'kopen' : 'verkopen'}` : bezig ? 'Debat loopt' : r ? 'Geen voorstel' : 'Nog geen'}</b>${bezig ? '<span class="tag ZIT">LIVE</span>' : r && p && r.votes_for != null ? `<span class="tag ${ok ? 'VOOR' : 'AF'}">${ok ? 'JA' : 'NEE'} · ${voor}–${n - voor}</span>` : r ? `<span class="tag NIKS">${r.status === 'fout' ? 'MISLUKT' : 'GEEN TRADE'}</span>` : ''}</a>
    <div class="tegel"><span class="eyebrow">Voorzitting ${vz ? tijd(vz.t) : ''}</span><b>${k ? `${esc(k.asset)} · kans ${k.score}/10` : vz ? 'Rustig uur' : 'Nog geen'}</b>${vz ? `<span class="tag ${vz.besluit === 'ZITTING' ? 'VOOR' : vz.besluit === 'RUSTIG' ? 'NIKS' : 'GEEL'}">${vz.besluit === 'ZITTING' ? 'ZITTING' : vz.besluit === 'RUSTIG' ? 'RUSTIG' : 'GEEN ZITTING'}</span>` : ''}</div>
    <div class="tegel"><span class="eyebrow">Volgende check</span><b id="tegelCheck">${String(volgendeRonde().getHours()).padStart(2, '0')}:00</b><span class="mut" style="font-size:11.5px">elk heel uur</span></div>
    <div class="tegel"><span class="eyebrow">Vandaag</span><b>${zitV} zitting${zitV === 1 ? '' : 'en'}</b><span class="mut" style="font-size:11.5px">${chkV} voorzitting${chkV === 1 ? '' : 'en'}</span></div>
  </div>`;
}
const uitlegVan = (r, msgs = []) => r?.proposal?.uitleg_kort || (msgs.find(m => m.phase === 'uitleg')?.action) || null;
function uitlegBlok(u, r) {
  if (!u) return '';
  const ok = r.outcome === 'UITGEVOERD', koop = r.proposal?.actie === 'KOOP';
  return `<div class="vak uitleg">
    <div class="ul-r"><span class="ul-i">💬</span><div><span class="eyebrow">${ok ? (koop ? 'Waarom gekocht' : 'Waarom verkocht') : 'Waarom afgewezen'}</span><p>${esc(u.waarom)}</p></div></div>
    ${u.verwachting ? `<div class="ul-r"><span class="ul-i">🔮</span><div><span class="eyebrow">Verwachting</span><p>${esc(u.verwachting)}</p></div></div>` : ''}
    ${u.plan ? `<div class="ul-r"><span class="ul-i">📌</span><div><span class="eyebrow">Plan</span><p>${esc(u.plan)}</p></div></div>` : ''}
  </div>`;
}
function zittingInhoud(r, msgs, { kort = false } = {}) {
  if (!r) return '';
  const p = r.proposal, ok = r.outcome === 'UITGEVOERD', n = actieveTraders().length || 10, voor = Number(r.votes_for ?? 0);
  const st = stemmenVan(msgs), naam = id => traderMap[id]?.name || id;
  const sv = st.find(x => x.stem === 'VOOR'), stg = st.find(x => x.stem === 'TEGEN');
  const [bg, fg] = p ? kleurVan(p.asset) : ['#F1F3F8', '#5B6478'];
  const vraag = (r.aanleiding || []).find(a => a.soort === 'vraag');
  const waarom = vraag ? vraag.tekst.replace(/^vraag van de eigenaar: /, 'Jouw vraag: ') : r.spoed ? `Spoednieuws: ${r.spoed.titel}` : (r.aanleiding || []).filter(a => a.soort !== 'agenda').map(a => a.tekst).join(' · ');
  return `<div class="vakken">
      ${uitlegBlok(uitlegVan(r, msgs), r)}
      ${waarom ? `<div class="vak vak-waarom"><span class="eyebrow">Aanleiding</span><p>${esc(waarom)}</p></div>` : ''}
      <div class="vak vak-tafel">${p ? `<div class="ico" style="background:${bg};color:${fg}">${esc(p.asset)}</div>` : ''}<div style="flex:1;min-width:0"><span class="eyebrow">Op tafel</span><div class="zk-wat">${p ? `${p.actie === 'KOOP' ? 'Kopen' : 'Verkopen'} <b>${eur(r.trade?.bedrag ?? p.bedrag, 0)} ${esc(p.asset)}</b>` : 'Geen voorstel'}</div>${!p && r.outcome === 'GEEN VOORSTEL' ? '<div class="mut" style="font-size:12.5px;margin-top:2px">De traders vonden geen trade die nu kon of verstandig was.</div>' : ''}</div>${kort ? '' : uitkomstTag(r)}</div>
      ${r.votes_for != null ? `<div class="vak"><div class="zk-stand"><span class="up">${voor} voor</span><span class="mut">${NODIG_STEMMEN} nodig</span><span class="dn">${n - voor} tegen</span></div><div class="votebar dun"><i class="v" style="width:${voor / n * 100}%"></i><i class="t" style="width:${(n - voor) / n * 100}%"></i></div></div>` : ''}
      ${sv ? `<div class="vak arg v"><span class="eyebrow">Sterkste voor</span><p><b>${esc(naam(sv.id))}</b> ${esc(sv.reden)}</p></div>` : ''}
      ${stg ? `<div class="vak arg t"><span class="eyebrow">Sterkste tegen</span><p><b>${esc(naam(stg.id))}</b> ${esc(stg.reden)}</p></div>` : ''}
      ${r.id && r.status !== 'fout' ? `<button type="button" class="btn licht" data-logdebat="${r.id}">Bekijk het hele debat →</button>` : ''}
    </div>`;
}
function voorzittingenKaart() {
  if (logboekOpen) return `${logboekKaart()}<button type="button" class="btn licht" data-logboek="dicht" style="margin-top:-4px">Logboek inklappen</button>`;
  const lijst = (D.voorzittingen || []).slice(0, 4);
  return `<div class="card"><div class="card-h"><h2>Voorzittingen</h2><span class="mut" style="font-size:12px">elk uur</span></div>
    <div class="card-b vakken" style="padding-top:6px">${lijst.map(v => {
      const kk = (v.kansen || [])[0], zit = v.besluit === 'ZITTING', rust = v.besluit === 'RUSTIG';
      const ond = v.aanleiding?.[0]?.tekst?.replace(/^nieuws: /, '') || 'Niets bewogen, geen nieuw nieuws';
      return `<div class="vak vz-vak"><div class="vz-boven"><span class="mono mut">${wanneer(v.t)}</span><span class="tag ${zit ? 'VOOR' : rust ? 'NIKS' : 'GEEL'}">${zit ? 'ZITTING' : rust ? 'RUSTIG' : 'GEEN ZITTING'}</span>${kk ? `<span class="score-mini ${kk.score >= 6 ? 'hoog' : ''}">${esc(kk.asset)} ${kk.score}/10</span>` : ''}</div><div class="vz-ond">${esc(ond)}</div>${v.reden && !rust ? `<div class="vz-reden">${esc(v.reden)}</div>` : ''}</div>`;
    }).join('') || '<p class="mut" style="font-size:13px">Na de eerste uurcheck zie je hier wat de voorzitter elk uur besloot.</p>'}
    <button type="button" class="btn licht" data-logboek="open">Hele logboek: alle zittingen en checks →</button></div></div>`;
}

// ---------- UUR VOOR UUR: elke uurcheck, voorzitting en zitting op een tijdlijn ----------
let tlDag = 0, tlOuder = false; const tlOpen = new Set();
const twee = n => String(n).padStart(2, '0');
// Kleuren: groen = gekocht/verkocht, rood = afgewezen, oranje = zitting gestart, geel = voorzitting zonder zitting, grijs = rustig/niets
const tlKleurZit = r => r.status === 'bezig' ? 'live' : r.outcome === 'UITGEVOERD' ? 'groen' : r.outcome === 'AFGEWEZEN' ? 'rood' : 'grijs';
const tlUitkomst = r => r.status === 'bezig' ? 'nu live' : r.status === 'fout' ? 'mislukt' : r.outcome === 'UITGEVOERD' ? 'aangenomen' : r.outcome === 'AFGEWEZEN' ? 'afgewezen' : 'geen voorstel';
const tlKleurVz = v => ({ ZITTING: 'oranje', GEEN_ZITTING: 'geel', RUSTIG: 'licht', OVERGESLAGEN: 'grijs' }[v.besluit] || 'licht');
const KLEURRANG = ['live', 'groen', 'rood', 'oranje', 'geel', 'grijs', 'licht'];
function tlVoorzitting(v) {
  const k = (v.kansen || [])[0], open = tlOpen.has('v' + (v.id ?? v.t));
  const B = { ZITTING: ['VOOR', 'Voorzitting · zitting'], GEEN_ZITTING: ['GEEL', 'Voorzitting · geen zitting'], RUSTIG: ['NIKS', 'Uurcheck · rustig'], OVERGESLAGEN: ['NIKS', 'Uurcheck'] }[v.besluit] || ['NIKS', v.besluit];
  const ond = v.besluit === 'RUSTIG' ? 'Niets bewogen, geen nieuw nieuws' : v.besluit === 'OVERGESLAGEN' ? (v.reden || '') : (v.aanleiding?.[0]?.tekst || '').replace(/^nieuws: /, '');
  const meer = v.besluit !== 'RUSTIG' && v.besluit !== 'OVERGESLAGEN';
  return `<${meer ? 'button type="button"' : 'div'} class="tl-it tl-vz k-${tlKleurVz(v)}" ${meer ? `data-tlopen="v${v.id ?? v.t}"` : ''}>
    <div class="tl-rij"><span class="mono tl-t">${tijd(v.t)}</span><span class="tl-naam">${B[1].split(' · ')[0]}</span>${B[1].includes(' · ') || v.besluit === 'OVERGESLAGEN' ? `<span class="tl-uit">${v.besluit === 'OVERGESLAGEN' ? 'overgeslagen' : B[1].split(' · ')[1]}</span>` : ''}${meer ? `<span class="tl-pijl">${open ? '▴' : '▾'}</span>` : ''}</div>
    ${ond || k ? `<div class="tl-onder">${ond ? `<div class="tl-ond">${esc(ond)}</div>` : '<span></span>'}${k ? `<span class="score-mini">${esc(k.asset)} ${k.score}/10</span>` : ''}</div>` : ''}
    ${open ? `${(v.aanleiding || []).slice(1, 4).map(a => `<div class="tl-ond">${esc(a.tekst.replace(/^nieuws: /, ''))}</div>`).join('')}
      ${(v.kansen || []).length ? `<div class="tl-kansen">${v.kansen.map(x => `<span class="score-mini ${x.score >= 6 ? 'hoog' : ''}">${esc(x.asset)} ${esc(x.richting?.toLowerCase() || '')} ${x.score}/10</span>`).join('')}<span class="mut">nodig: 6</span></div>` : ''}
      ${v.reden ? `<div class="tl-reden"><b>Eva:</b> ${esc(v.reden)}</div>` : ''}` : ''}
  </${meer ? 'button' : 'div'}>`;
}
function tlZitting(r, nieuwste) {
  const p = r.proposal, n = actieveTraders().length || 10, voor = Number(r.votes_for ?? 0), open = nieuwste || tlOpen.has('z' + r.id);
  const msgs = r === D.round || (r.id && r.id === D.round?.id) ? D.messages : [];
  const vraag = (r.aanleiding || []).some(a => a.soort === 'vraag');
  return `<div class="tl-it tl-zit k-${tlKleurZit(r)} ${open ? 'open' : ''}">
    <button type="button" class="tl-rij tl-kop" ${nieuwste ? '' : `data-tlopen="z${r.id}"`}><span class="mono tl-t">${tijd(r.started_at)}</span><span class="tl-naam">${r.spoed ? 'Spoedzitting' : 'Zitting ' + esc(r.no)}</span><span class="tl-uit">${tlUitkomst(r)}</span>${nieuwste ? '' : `<span class="tl-pijl">${open ? '▴' : '▾'}</span>`}</button>
    ${vraag && !open ? `<div class="tl-vraag">Jouw vraag: ${esc((r.aanleiding.find(a => a.soort === 'vraag').tekst || '').replace(/^vraag van de eigenaar: /, ''))}</div>` : ''}
    ${open ? zittingInhoud(r, msgs, { kort: true }) : `<div class="tl-ond"><b>${p ? `${p.actie === 'KOOP' ? 'Kopen' : 'Verkopen'} ${eur(p.bedrag, 0)} ${esc(p.asset)}` : r.status === 'fout' ? 'Technische fout, telde niet mee' : 'Geen voorstel'}</b>${r.votes_for != null ? ` · ${voor} voor, ${n - voor} tegen` : ''}</div>${uitlegVan(r) ? `<div class="tl-waarom">${esc(uitlegVan(r).waarom)}</div>` : ''}`}
  </div>`;
}
function tijdlijnKaart() {
  const begin = new Date(); begin.setHours(0, 0, 0, 0); begin.setDate(begin.getDate() - tlDag);
  const eind = new Date(begin); eind.setDate(eind.getDate() + 1);
  const binnen = t => { const d = new Date(t); return d >= begin && d < eind; };
  const rondes = (D.rondes || []).filter(r => binnen(r.started_at) && (r.status !== 'bezig' || Date.now() - new Date(r.started_at) < 30 * 60000));
  const vzs = (D.voorzittingen || []).filter(v => binnen(v.t));
  const items = [...vzs.map(v => ({ t: v.t, v, html: () => tlVoorzitting(v) })), ...rondes.map(r => ({ t: r.started_at, r }))];
  const nieuwsteZit = tlDag === 0 ? rondes.filter(r => r.status !== 'bezig')[0] : null;
  const perUur = new Map();
  for (const it of items) { const u = new Date(it.t).getHours(); if (!perUur.has(u)) perUur.set(u, []); perUur.get(u).push(it); }
  const uren = [...perUur.keys()];
  const hoogste = tlDag === 0 ? new Date().getHours() : Math.max(...uren, 0), laagste = uren.length ? Math.min(...uren) : hoogste;
  let html = '', ouder = '', nOuder = { zit: 0, chk: 0, uren: 0 };
  const grens = tlDag === 0 ? hoogste - 2 : -1;   // vandaag: het huidige uur en de 2 uur ervoor open
  for (let u = hoogste; u >= laagste; u--) {
    const lijst = (perUur.get(u) || []).sort((a, b) => new Date(b.t) - new Date(a.t));
    const nu = tlDag === 0 && u === new Date().getHours();
    const kleur = lijst.map(it => it.r ? tlKleurZit(it.r) : tlKleurVz(it.v)).sort((a, b) => KLEURRANG.indexOf(a) - KLEURRANG.indexOf(b))[0] || 'leeg';
    const blok = `<div class="tl-uur ${lijst.length ? '' : 'leeg'} u-${kleur}"><div class="tl-label"><b>${twee(u)}:00</b>${nu ? '<span>nu</span>' : ''}</div><div class="tl-items">${lijst.map(it => it.r ? tlZitting(it.r, it.r === nieuwsteZit) : it.html()).join('') || `<div class="tl-geen">${nu ? 'Check volgt om ' + twee(volgendeRonde().getHours()) + ':00' : 'Geen check gedraaid'}</div>`}</div></div>`;
    if (u >= grens) html += blok;
    else { ouder += blok; nOuder.uren++; nOuder.zit += lijst.filter(it => it.r).length; nOuder.chk += lijst.filter(it => !it.r).length; }
  }
  if (ouder) html += `<button type="button" class="tl-ouder" data-tlouder>${tlOuder ? '▴ Inklappen' : `▾ Eerder vandaag · ${nOuder.uren} uur`}<span>${nOuder.zit} zitting${nOuder.zit === 1 ? '' : 'en'} · ${nOuder.chk} check${nOuder.chk === 1 ? '' : 's'}</span></button>${tlOuder ? ouder : ''}`;
  const z = rondes.filter(r => r.status === 'klaar').length, c = vzs.filter(v => v.besluit !== 'OVERGESLAGEN').length;
  return `<div class="card tijdlijn"><div class="card-h"><h2>Uur voor uur</h2><div class="lg-filter">
      <button type="button" data-tldag="1" class="${tlDag === 1 ? 'on' : ''}">Gisteren</button><button type="button" data-tldag="0" class="${tlDag === 0 ? 'on' : ''}">Vandaag</button></div></div>
    <div class="tl-legenda"><span class="lg groen">Gekocht/verkocht</span><span class="lg rood">Afgewezen</span><span class="lg oranje">Zitting gestart</span><span class="lg geel">Geen zitting</span><span class="lg licht">Rustig</span></div>
    <div class="tl-som mut">${c} uurcheck${c === 1 ? '' : 's'} · ${z} zitting${z === 1 ? '' : 'en'} ${tlDag === 0 ? 'vandaag' : 'gisteren'}</div>
    <div class="tl-lijst">${html || '<p class="mut" style="padding:8px 0">Nog niets gebeurd op deze dag.</p>'}</div></div>`;
}
const tekenTijdlijn = () => { const el = $('#tijdlijn'); if (el) el.innerHTML = tijdlijnKaart(); };

function renderHome() {
  const g = gezondheid();
  const r = D.besluit || (D.round?.status === 'klaar' ? D.round : null) || D.round;
  const msgs = r && (r === D.round || (r.id && r.id === D.round?.id)) ? D.messages : [];
  const vz = (D.voorzittingen || [])[0];
  $('#v-home').innerHTML = `<div class="home">
  ${g ? `<div class="alarm ${g.niveau}"><b>${esc(g.titel)}</b><span>${esc(g.tekst)}</span></div>` : ''}
  ${welkomKaart()}
  <div id="liveKaart"></div>
  <div id="meldBalk">${meldingenKaart(true)}</div>
  <div class="home-grid">
  <div class="hg-pf">${pfKaart()}</div>
  <div class="hg-tegels alleen-pc">${tegelsKaart(r, vz)}</div>
  <div class="hg-tl" id="tijdlijn">${tijdlijnKaart()}</div>
  <div class="hg-vraag" id="vraagVak">${vraagKaart()}</div>
  </div>
  <div class="card"><div class="card-h"><h2>De zaal <span class="pill" id="livePill" style="padding:3px 8px;font-size:10px"><span class="dot red"></span>LIVE</span></h2><span class="mut" id="miniFase" style="font-size:12px"></span></div>
    <div id="aanleidingBalk"></div>
    <div class="zaal-mini" id="zaalMini"></div>
    <div style="padding:0 16px 16px"><a class="btn" href="#zaal">Stap de 3D-zaal in <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></a></div>
  </div>
  </div>`;
  $('#welkomWeg')?.addEventListener('click', () => { zetOnthoud('hs-welkom-weg', '1'); $('#welkom')?.remove(); });
  koppelVraag();
  requestAnimationFrame(() => {
    const snaps = D.snapshots || [], v = waarde();
    lijn($('#heroChart'), [
      { data: snaps.map(s => Number(s.bench)), color: '#A3AAC2', dash: true, w: 1.5 },
      { data: snaps.map(s => Number(s.value)).concat(v), color: '#F25600', w: 2.4, fill: 'rgba(242,86,0,.12)' },
    ]);
    updateMini(speler.s);
  });
}
function koppelVraag() {
  const f = $('#vraagForm'); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const tekst = $('#vraagIn').value.trim(), meld = $('#vraagMelding');
    if (tekst.length < 3) { meld.textContent = 'Typ eerst een vraag, bijvoorbeeld: moeten we in goud investeren?'; meld.style.color = 'var(--red)'; return; }
    vraagBezig = true; f.querySelector('button').disabled = true; f.querySelector('button').textContent = 'Versturen…';
    try {
      await stelVraag(tekst);
      D.vragen = await laadVragen();
      vraagBezig = false; $('#vraagVak').innerHTML = vraagKaart(); koppelVraag();
      $('#vraagMelding').textContent = 'Verstuurd. De zitting start binnen 5 minuten; je ziet hem hier en in de zaal.';
      $('#vraagMelding').style.color = 'var(--up)';
    } catch (err) {
      vraagBezig = false; f.querySelector('button').disabled = false; f.querySelector('button').textContent = 'Start zitting';
      meld.textContent = 'Versturen lukte niet. Probeer het opnieuw.'; meld.style.color = 'var(--red)'; console.error(err);
    }
  };
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
// Logboek: alle zittingen (standaard) of alles wat er elk uur gebeurde, met de voorzittingen ertussen
let logFilter = 'zittingen', logOpen = null;
const NODIG = 6;
function wanneer(t) {
  const d = new Date(t), nu = new Date(), gist = new Date(nu); gist.setDate(nu.getDate() - 1);
  const zelfde = (a, b) => a.toDateString() === b.toDateString();
  return zelfde(d, nu) ? tijd(t) : zelfde(d, gist) ? `gisteren ${tijd(t)}` : `${d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} ${tijd(t)}`;
}
function uitkomstTag(r) {
  if (r.status === 'fout') return '<span class="tag AF">MISLUKT</span>';
  if (r.status === 'bezig') return '<span class="tag ZIT">NU LIVE</span>';
  if (r.outcome === 'UITGEVOERD') return '<span class="tag VOOR">AANGENOMEN</span>';
  if (r.outcome === 'AFGEWEZEN') return '<span class="tag AF">AFGEWEZEN</span>';
  return `<span class="tag NIKS">${esc(r.outcome || 'GEEN TRADE')}</span>`;
}
const opTafel = p => p ? `${p.actie === 'VERKOOP' ? 'Verkopen' : 'Kopen'}: ${esc(p.asset)} voor ${eur(p.bedrag, 0)}` : 'Geen voorstel op tafel';
function logZitting(r, open) {
  const p = r.proposal, n = actieveTraders().length || 10, voor = Number(r.votes_for ?? 0);
  const kop = `<div class="lg-kop"><span class="mono mut">${wanneer(r.started_at)}</span><span class="tag ZIT">${r.spoed ? 'SPOEDZITTING' : 'ZITTING ' + esc(r.no)}</span><span class="lg-rechts">${uitkomstTag(r)}</span></div>`;
  if (!open) return `<button type="button" class="lg-item lg-zit dicht" data-logopen="${r.id}">${kop}
    <div class="lg-rij"><b>${opTafel(p)}</b>${r.votes_for != null ? `<span class="mut">· ${voor} voor, ${n - voor} tegen</span>` : ''}<span class="lg-pijl" aria-hidden="true">⌄</span></div></button>`;
  const waarom = r.spoed ? [`${r.spoed.titel} (${r.spoed.uitgever || 'nieuws'})`] : (r.aanleiding || []).map(a => a.tekst);
  const door = p?.door ? (traderMap[p.door]?.name || p.door) : null;
  return `<div class="lg-item lg-zit">${kop}
    <div class="lg-l">Waarom deze zitting</div><div class="lg-waarom">${waarom.length ? waarom.map(esc).join(' · ') : 'Geen aanleiding opgeslagen'}</div>
    <div class="lg-l">Op tafel</div><div class="lg-tafel">${opTafel(p)}${door ? ` <span class="mut">· voorstel van ${esc(door)}</span>` : ''}</div>
    ${r.votes_for != null ? `<div class="votebar"><i class="v" style="width:${voor / n * 100}%"></i><i class="t" style="width:${(n - voor) / n * 100}%"></i></div>
    <div class="lg-stem"><span>${voor} voor</span><span>${n - voor} tegen · ${NODIG} nodig</span></div>` : ''}
    ${r.status === 'fout' ? `<div class="mut" style="font-size:12.5px">Deze zitting liep vast door een technische fout en telde niet mee.</div>` : ''}
    ${r.status !== 'fout' ? `<button type="button" class="btn" data-logdebat="${r.id}">Bekijk het hele debat →</button>` : ''}
  </div>`;
}
function logCheck(v) {
  if (v.besluit === 'RUSTIG') return `<div class="lg-item lg-rust"><span class="mono mut">${wanneer(v.t)}</span><span class="tag NIKS">RUSTIG</span><span class="mut">Niets bewogen, geen nieuw nieuws</span></div>`;
  const zit = v.besluit === 'ZITTING';
  return `<div class="lg-item lg-check"><div class="lg-kop"><span class="mono mut">${wanneer(v.t)}</span><span class="tag ${zit ? 'VOOR' : 'GEEL'}">VOORZITTING · ${zit ? 'ZITTING' : 'GEEN ZITTING'}</span></div>
    ${v.aanleiding?.length ? `<div class="lg-l">Onderwerp</div><div class="lg-onderwerp">${v.aanleiding.slice(0, 3).map(a => esc(a.tekst)).join('<br>')}</div>` : ''}
    ${(v.kansen || []).map(k => `<div class="lg-kans"><b>${esc(k.asset)}</b><span class="tag ${k.richting === 'VERKOOP' ? 'VERKOOP' : 'KOOP'}">${esc(k.richting)}</span><span class="mut">kans ${k.score}/10 · nodig 6</span><span class="lg-meter"><i style="width:${Math.min(10, k.score) * 10}%" class="${k.score >= 6 ? 'hoog' : ''}"></i></span></div>`).join('')}
    ${v.reden ? `<div class="lg-reden">Voorzitter Eva: ${esc(v.reden)}</div>` : ''}</div>`;
}
function logboekKaart() {
  const rondes = (D.rondes || []).filter(r => r.status !== 'bezig' || Date.now() - new Date(r.started_at) < 30 * 60000);
  const checks = D.voorzittingen || [];
  if (!rondes.length && !checks.length) return '';
  const eerste = rondes[0]?.id;
  const items = logFilter === 'zittingen'
    ? rondes.map(r => ({ t: r.started_at, html: logZitting(r, (logOpen ?? eerste) === r.id) }))
    : [...rondes.map(r => ({ t: r.started_at, html: logZitting(r, (logOpen ?? eerste) === r.id) })), ...checks.map(v => ({ t: v.t, html: logCheck(v) }))].sort((a, b) => new Date(b.t) - new Date(a.t));
  return `<div class="card logboek"><div class="card-h"><h2>Logboek</h2><div class="lg-filter">
      <button type="button" data-logf="zittingen" class="${logFilter === 'zittingen' ? 'on' : ''}">Zittingen</button>
      <button type="button" data-logf="alles" class="${logFilter === 'alles' ? 'on' : ''}">Alles</button></div></div>
    <div class="lg-lijst">${items.map(i => i.html).join('') || '<p class="mut" style="padding:6px 0">Nog geen zittingen. Tik op Alles om de uurchecks te zien.</p>'}</div>
    ${logFilter === 'alles' ? '<p class="mut lg-voet">Elk uur kijkt de app of er iets gebeurt. Zo ja, dan bekijken Voorzitter Eva, Daan en Noor de kansen. Alleen bij een kans van 6 of hoger komt er een zitting.</p>' : ''}
  </div>`;
}
const tekenLogboek = () => { const el = $('#logboek'); if (el) el.innerHTML = voorzittingenKaart(); };
async function bekijkDebat(id) {
  const r = (D.rondes || []).find(x => x.id === id); if (!r) return;
  const { messages, sources } = await laadRonde(id);
  D.round = r; D.messages = messages; D.sources = sources;
  speler.reset(r); speler.eindstand(r, messages);
  location.hash = '#zaal';
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
  const mk = e.target.closest('[data-meld]');
  if (mk) {
    const wat = mk.dataset.meld;
    if (wat === 'weg') { zetOnthoud('hs-meld-weg', '1'); $('#meldBalk').innerHTML = ''; return; }
    mk.disabled = true; mk.textContent = 'Even geduld…';
    (wat === 'aan' ? meldingenAan() : meldingenUit()).then(verversMeldingen).catch(err => { verversMeldingen().then(() => { const m = $('#meldMelding'); if (m) m.textContent = err.message; else alert(err.message); }); });
    return;
  }
  const so = e.target.closest('[data-statusopen]');
  if (so && !e.target.closest('a.kijk')) { statusOpen = !statusOpen; toonLive(speler.s); return; }
  const to = e.target.closest('[data-tlopen]');
  if (to) { const k = to.dataset.tlopen; tlOpen.has(k) ? tlOpen.delete(k) : tlOpen.add(k); tekenTijdlijn(); return; }
  if (e.target.closest('[data-tlouder]')) { tlOuder = !tlOuder; tekenTijdlijn(); return; }
  const td = e.target.closest('[data-tldag]');
  if (td) { tlDag = Number(td.dataset.tldag); tekenTijdlijn(); return; }
  const vv = e.target.closest('[data-vraagvoorbeeld]');
  if (vv) { const i = $('#vraagIn'); if (i) { i.value = vv.dataset.vraagvoorbeeld; i.focus(); } return; }
  const lb = e.target.closest('[data-logboek]');
  if (lb) { logboekOpen = lb.dataset.logboek === 'open'; const el = $('#logboek'); if (el) el.innerHTML = voorzittingenKaart(); if (logboekOpen) el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const lf = e.target.closest('[data-logf]');
  if (lf) { logFilter = lf.dataset.logf; tekenLogboek(); return; }
  const lo = e.target.closest('[data-logopen]');
  if (lo) { logOpen = Number(lo.dataset.logopen); tekenLogboek(); return; }
  const ld = e.target.closest('[data-logdebat]');
  if (ld) { ld.textContent = 'Debat laden…'; bekijkDebat(Number(ld.dataset.logdebat)).catch(err => { ld.textContent = 'Laden mislukt, probeer opnieuw'; console.error(err); }); return; }
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
  if (s.ok === false && (Date.now() - new Date(s.t)) / 3600e3 > 6) return { kleur: 'grijs', tekst: `Laatste poging ${geleden(s.t)} mislukt, sindsdien niet meer nodig geweest` };
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
  const k = D.state?.kosten, kostPct = k ? Math.min(1, k.eur / (k.budget || 50)) : 0;
  $('#v-bronnen').innerHTML = `
  <h2 class="pagetitle">Bronnen</h2>
  <div id="meldKaart">${meldingenKaart()}</div>
  ${k ? `<div class="card"><div class="card-h"><h2>AI-kosten deze maand</h2><span class="chip ${kostPct >= 0.7 ? 'dn' : ''}">${kostPct >= 0.7 ? 'spaarstand' : 'normaal'}</span></div>
        <div class="card-b"><div class="kosten"><b>€${nf(k.eur)}</b><span class="mut">van €${k.budget || 50}</span></div>
        <div class="kbar"><i style="width:${kostPct * 100}%;background:${kostPct >= 0.9 ? 'var(--red)' : kostPct >= 0.7 ? 'var(--gold)' : 'var(--iris)'}"></i><s style="left:70%"></s></div>
        <p class="mut" style="font-size:12px;margin-top:8px">Vanaf €${Math.round((k.budget || 50) * 0.7)} gebruiken de duurste traders een goedkoper AI-model. Bij €${k.budget || 50} pauzeert het parlement tot volgende maand.</p></div></div>` : ''}
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(verversMeldingen).catch(() => {});
  $('#demoTag').hidden = !D.demo;
  $('#sub').textContent = `${actieveTraders().length} AI-traders · nepgeld${D.demo ? ' · voorbeelddata' : ''}`;
  renderBreaking();
  speler.op(s => { if ((location.hash || '#home') === '#home') updateMini(s); });
  if (D.demo) speler.speel(D.round, D.messages, { lus: true });
  else if (D.round?.status === 'bezig') speler.speel(D.round, D.messages);
  else speler.eindstand(D.round, D.messages);
  route();
  setInterval(tikStatus, 1000); tikStatus();
  setInterval(() => toonLive(speler.s), 20000);
  const peil = async () => {
    let wacht = 30000;
    if (!D.demo && !document.hidden) {
      try {
        const n = await laadNu();
        if (n) {
          D.live = n.live; D.vragen = n.vragen || D.vragen;
          if (n.nieuweCheck) { D.voorzittingen = n.voorzittingen; if ((location.hash || '#home') === '#home') renderHome(); } else toonLive(speler.s);
          if (n.live || isBezig()) wacht = 5000;
        }
      } catch {}
    }
    setTimeout(peil, wacht);
  };
  setTimeout(peil, 5000);

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

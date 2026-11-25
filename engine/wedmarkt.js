// Wedmarkten (Polymarket): kansen waar mensen met echt geld op inzetten. Openbare API, geen sleutel nodig.
// We houden alleen markten over die beurs, crypto of grondstoffen kunnen raken, en die binnen 4 maanden aflopen.

const TIMEOUT = 15000;
const RELEVANT = /\b(fed|fomc|rate|rates|interest|inflation|cpi|recession|gdp|jobs|unemployment|tariffs?|trade|china|taiwan|iran|israel|russia|ukraine|war|ceasefire|strike|invade|sanction|opec|oil|gold|bitcoin|btc|ethereum|eth|solana|crypto|etf|nvidia|apple|tesla|microsoft|meta|amazon|google|openai|anthropic|ceo|ipo|s&p|nasdaq|dow|stock|shutdown|debt|trump|president|election|powell|warsh|treasury|dollar|yen|euro)\b/i;
const SPORT = /\b(nba|nfl|nhl|mlb|ufc|fifa|premier league|champions league|super bowl|world cup|grand prix|f1|tennis|golf|match|vs\.?|beat the)\b/i;

const lijst = s => { try { const a = typeof s === 'string' ? JSON.parse(s) : s; return Array.isArray(a) ? a : []; } catch { return []; } };

export function kiesWedmarkten(events, { nu = new Date(), max = 14 } = {}) {
  const grens = nu.getTime() + 120 * 864e5, uit = [];
  for (const e of Array.isArray(events) ? events : []) {
    const tags = (e.tags || []).map(t => String(t.label || '')).join(' ');
    if (/sports/i.test(tags) || SPORT.test(e.title || '')) continue;
    if (!RELEVANT.test(`${e.title} ${tags}`)) continue;
    const markten = (e.markets || []).filter(m => m.active !== false && !m.closed).map(m => {
      const uitk = lijst(m.outcomes), prijs = lijst(m.outcomePrices).map(Number);
      const ja = uitk.findIndex(o => /^yes$/i.test(o));
      return { vraag: String(m.question || e.title).slice(0, 140), kans: ja >= 0 ? prijs[ja] : prijs[0], einde: m.endDate || e.endDate, volume: Number(m.volume24hr ?? m.volume ?? 0) };
    }).filter(m => Number.isFinite(m.kans) && m.kans >= 0.03 && m.kans <= 0.97 && (!m.einde || new Date(m.einde).getTime() <= grens) && (!m.einde || new Date(m.einde) > nu));
    // per gebeurtenis de 3 drukste uitkomsten
    for (const m of markten.sort((a, b) => b.volume - a.volume).slice(0, 3)) uit.push({ ...m, event: String(e.title || '').slice(0, 100), eventVolume: Number(e.volume24hr || 0) });
  }
  return uit.sort((a, b) => b.eventVolume - a.eventVolume || b.volume - a.volume).slice(0, max)
    .map(m => ({ vraag: m.vraag, kans: Math.round(m.kans * 100), einde: m.einde ? String(m.einde).slice(0, 10) : null, event: m.event }));
}

export async function fetchWedmarkten({ nu = new Date(), haal } = {}) {
  const get = haal || (async url => { const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) }); if (!r.ok) throw new Error(`${r.status} Polymarket`); return r.json(); });
  const events = await get('https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr&ascending=false&limit=200');
  return kiesWedmarkten(events, { nu });
}

export const wedRegel = w => `- ${w.vraag}: ${w.kans}% kans${w.einde ? ` (loopt tot ${w.einde})` : ''}`;

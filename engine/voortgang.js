// Live voortgang voor de statusbalk in de app: welke bronnen zijn binnen, en in welke fase zit de motor?
// Staat in een eigen tabel 'live' (één rij), los van de staat, zodat er nooit iets overschreven wordt.

import { luister } from './bronstatus.js';

export const STAPPEN = [
  { id: 'wissel', naam: 'Wisselkoers', bron: 'ECB via Frankfurter', ids: ['frankfurter'] },
  { id: 'crypto', naam: 'Cryptokoersen', bron: 'CoinGecko, gecontroleerd met Bitvavo', ids: ['coingecko', 'bitvavo'] },
  { id: 'aandelen', naam: "Aandelen en ETF's", bron: 'Finnhub (FMP als reserve)', ids: ['finnhub_koers', 'fmp'] },
  { id: 'nieuws', naam: 'Nieuws', bron: 'Finnhub, NOS, CoinDesk, ECB, Fed', ids: ['finnhub_nieuws', 'nos', 'coindesk', 'ecb', 'fed'] },
  { id: 'sentiment', naam: 'Stemming op de markt', bron: 'Fear & Greed', ids: ['feargreed'] },
  { id: 'bedrijf', naam: 'Bedrijfsnieuws', bron: 'Finnhub', ids: ['finnhub_bedrijf'] },
  { id: 'sec', naam: 'Officiële meldingen', bron: 'SEC EDGAR', ids: ['sec'] },
  { id: 'fred', naam: 'Rente en inflatie', bron: 'FRED', ids: ['fred'] },
  { id: 'cijfers', naam: 'Cijferkalender', bron: 'Finnhub', ids: ['cijfers'] },
];

export function maakVoortgang(db, basis, { stappen = STAPPEN.map(s => s.id) } = {}) {
  const lijst = STAPPEN.filter(s => stappen.includes(s.id)).map(({ ids, ...s }) => ({ ...s, ids, status: 'wacht' }));
  let data = { ...basis, t: new Date().toISOString(), stappen: lijst.map(({ ids, ...s }) => s) };
  let timer = null, gestopt = false, laatste = Promise.resolve();
  const schrijf = () => { if (gestopt || !db.zetLive) return; laatste = db.zetLive(data).catch(() => {}); };
  const later = () => { if (!timer) timer = setTimeout(() => { timer = null; schrijf(); }, 1500); };
  const uit = luister((id, status, aantal) => {
    const st = lijst.find(s => s.ids.includes(id)); if (!st) return;
    const hoofd = st.ids[0] === id;
    if (status === 'bezig' && st.status === 'wacht') st.status = 'bezig';
    if (status !== 'bezig' && (hoofd || st.status !== 'ok')) {
      if (hoofd || status === 'ok') st.status = status === 'ok' ? 'ok' : status === 'uit' ? 'uit' : (st.status === 'ok' ? 'ok' : 'fout');
      if (aantal && (hoofd || !st.aantal)) st.aantal = aantal;
    }
    data = { ...data, stappen: lijst.map(({ ids, ...s }) => s) };
    later();
  });
  schrijf();
  return {
    zet(extra) { data = { ...data, ...extra, stappen: lijst.map(({ ids, ...s }) => s) }; clearTimeout(timer); timer = null; schrijf(); },
    bronnenKlaar(extra = {}) { for (const s of lijst) if (s.status === 'wacht' || s.status === 'bezig') s.status = s.status === 'bezig' ? 'ok' : 'overgeslagen'; this.zet({ bronnenKlaar: true, ...extra }); },
    async stop() { uit(); clearTimeout(timer); gestopt = true; await laatste; if (db.zetLive) await db.zetLive(null).catch(() => {}); },
  };
}

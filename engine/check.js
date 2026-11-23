// Controle van de installatie: zijn alle sleutels en verbindingen in orde?
//   In GitHub: Actions → "Hamerslag controle" → Run workflow
//   Lokaal:    node check.js   (met de sleutels als omgevingsvariabelen)
// Kost een fractie van een cent: elk AI-model krijgt één piepklein vraagje.

import { MODELLEN, START_MODEL, env } from './config.js';

const TABELLEN = {
  traders: 'id,model,geschrapt', rounds: 'id,spoed,aanleiding', sources: 'id', messages: 'id', trades: 'id',
  snapshots: 't', market: 'symbol,rank,cat', headlines: 'url', state: 'id,data', voorzittingen: 'id,model',
};

export async function controle({ fetchFn = fetch, log = console.log } = {}) {
  const uit = { ok: 0, waarschuwing: 0, fout: 0 };
  const goed = t => { uit.ok++; log(`✅ ${t}`); };
  const let_op = (t, hulp) => { uit.waarschuwing++; log(`⚠️  ${t}${hulp ? `\n   → ${hulp}` : ''}`); };
  const fout = (t, hulp) => { uit.fout++; log(`❌ ${t}${hulp ? `\n   → ${hulp}` : ''}`); };
  const haal = async (url, opts = {}) => {
    const r = await fetchFn(url, { ...opts, signal: AbortSignal.timeout(20000) });
    const tekst = await r.text();
    let json = null; try { json = JSON.parse(tekst); } catch {}
    return { status: r.status, ok: r.ok, json, tekst };
  };
  const secret = n => `zet "${n}" in GitHub: Settings → Secrets and variables → Actions → New repository secret`;

  log('Hamerslag · controle van de installatie\n');

  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  major >= 20 ? goed(`Node ${process.versions.node}`) : fout(`Node ${process.versions.node} is te oud`, 'gebruik Node 20 of nieuwer');

  // 2. Sleutels aanwezig?
  for (const [n, verplicht, wat] of [
    ['ANTHROPIC_API_KEY', true, 'de AI'], ['SUPABASE_URL', true, 'de database'], ['SUPABASE_SERVICE_KEY', true, 'de database'],
    ['COINGECKO_KEY', true, 'cryptokoersen'], ['FINNHUB_KEY', true, 'aandelenkoersen en nieuws'],
    ['FMP_KEY', false, 'exact dividend (zonder: schatting)'], ['NTFY_TOPIC', false, 'pushmeldingen'],
    ['FRED_KEY', false, 'rente, inflatie, werkloosheid en VIX'],
  ]) {
    if (env(n)) goed(`${n} is ingesteld (${wat})`);
    else verplicht ? fout(`${n} ontbreekt (${wat})`, secret(n)) : let_op(`${n} ontbreekt (${wat})`, secret(n));
  }
  if (!env('SEC_CONTACT')) let_op('SEC_CONTACT ontbreekt: de officiële SEC-meldingen worden overgeslagen', 'zet je e-mailadres als Variable "SEC_CONTACT" (de SEC vraagt een contactadres van wie hun gratis bron gebruikt)');
  if (!env('APP_URL')) let_op('APP_URL ontbreekt: een tik op een melding opent dan niet je app', 'zet de link van je app als Variable "APP_URL" (Settings → Secrets and variables → Actions → Variables)');

  // 3. Anthropic: elk gebruikt model één keer kort proberen
  if (env('ANTHROPIC_API_KEY')) {
    const nodig = new Set(['haiku', 'sonnet', ...Object.values(START_MODEL)]);
    for (const k of nodig) {
      const m = MODELLEN[k];
      try {
        const r = await haal('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: m.id, max_tokens: 10, messages: [{ role: 'user', content: 'Antwoord alleen met: ok' }] }),
        });
        if (r.ok) goed(`AI-model ${m.naam} (${m.id}) werkt`);
        else if (r.status === 401) { fout('Anthropic-sleutel wordt geweigerd', 'controleer ANTHROPIC_API_KEY: maak eventueel een nieuwe sleutel op console.anthropic.com'); break; }
        else if (r.status === 400 && /credit|balance/i.test(r.tekst)) { fout('Anthropic: geen tegoed', 'zet tegoed op je account: console.anthropic.com → Billing'); break; }
        else if (r.status === 404 || /model/i.test(r.json?.error?.message || '')) fout(`AI-model ${m.id} bestaat niet of is niet beschikbaar`, `zet de juiste naam als Variable "MODEL_${k.toUpperCase()}" (zie docs.claude.com → Models)`);
        else fout(`AI-model ${m.naam}: fout ${r.status}`, (r.json?.error?.message || r.tekst).slice(0, 160));
      } catch (e) { fout(`AI-model ${m.naam}: geen verbinding`, e.message); }
    }
  }

  // 4. Supabase: tabellen, nieuwe kolommen en aanmelden dicht
  const sb = env('SUPABASE_URL')?.replace(/\/$/, ''), sk = env('SUPABASE_SERVICE_KEY');
  if (sb && sk) {
    const h = { apikey: sk, Authorization: `Bearer ${sk}` };
    let schemaFout = false;
    for (const [t, kol] of Object.entries(TABELLEN)) {
      try {
        const r = await haal(`${sb}/rest/v1/${t}?select=${kol}&limit=1`, { headers: h });
        if (r.ok) continue;
        schemaFout = true;
        if (r.status === 401 || r.status === 403) { fout('Supabase-sleutel wordt geweigerd', 'gebruik de service_role key (Project Settings → API), niet de anon key'); break; }
        fout(`Supabase: tabel "${t}" mist of is verouderd (${(r.json?.message || r.tekst).slice(0, 90)})`, 'plak supabase/schema.sql opnieuw in Supabase → SQL Editor → Run (veilig: bestaande data blijft)');
      } catch (e) { fout('Supabase: geen verbinding', `controleer SUPABASE_URL (${e.message})`); schemaFout = true; break; }
    }
    if (!schemaFout) goed('Supabase: alle 10 tabellen en kolommen zijn er');
    try {
      const r = await haal(`${sb}/auth/v1/settings`, { headers: { apikey: sk } });
      if (r.json?.disable_signup === true) goed('Supabase: nieuwe aanmeldingen staan uit (veilig)');
      else if (r.json) let_op('Supabase: nieuwe aanmeldingen staan nog AAN: iedereen met je link kan een account maken en je data lezen', 'Authentication → Sign In / Providers → "Allow new users to sign up" uit (eerst je eigen account maken)');
    } catch {}
  }

  // 5. Databronnen: antwoorden ze, én zitten de velden erin die de motor gebruikt?
  //    (een bron die een veld anders noemt, zie je hier meteen in plaats van dagen later)
  const bron = async (naam, url, { headers = {}, hulp = '', velden = () => [] } = {}) => {
    try {
      const r = await haal(url, { headers });
      if (!r.ok) return fout(`${naam}: fout ${r.status}`, hulp || (r.json?.error || r.json?.message || r.tekst || '').toString().slice(0, 140));
      const mist = velden(r.json).filter(([, ok]) => !ok).map(([v]) => v);
      mist.length ? fout(`${naam}: antwoord mist ${mist.join(', ')}`, 'de bron is veranderd: stuur deze melding door, dan pas ik de motor aan') : goed(`${naam} werkt en de velden kloppen`);
      return r.json;
    } catch (e) { fout(`${naam}: geen verbinding`, e.message); }
  };
  const getal = v => Number.isFinite(Number(v)) && Number(v) !== 0;
  if (env('COINGECKO_KEY')) await bron('CoinGecko (crypto)', 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&per_page=3&page=1&price_change_percentage=1h,24h,7d', {
    headers: { 'x-cg-demo-api-key': env('COINGECKO_KEY') }, hulp: 'controleer COINGECKO_KEY (Demo-key van coingecko.com/en/api)',
    velden: j => { const c = j?.[0] || {}; return [['lijst', Array.isArray(j) && j.length > 0], ['symbol', !!c.symbol], ['current_price', getal(c.current_price)], ['market_cap_rank', getal(c.market_cap_rank)], ['price_change_percentage_24h_in_currency', c.price_change_percentage_24h_in_currency !== undefined]]; },
  });
  await bron('Bitvavo (prijscontrole en reserve voor crypto)', 'https://api.bitvavo.com/v2/ticker/24h', {
    velden: j => { const b = (Array.isArray(j) ? j : []).find(x => x.market === 'BTC-EUR') || {}; return [['lijst', Array.isArray(j)], ['market BTC-EUR', !!b.market], ['last', getal(b.last)], ['open', getal(b.open)]]; },
  });
  if (env('FINNHUB_KEY')) {
    await bron('Finnhub koersen', `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${env('FINNHUB_KEY')}`, { hulp: 'controleer FINNHUB_KEY (finnhub.io → Dashboard)',
      velden: j => [['c (prijs)', getal(j?.c)], ['dp (dagverandering)', j?.dp !== undefined], ['t (tijd)', getal(j?.t)]] });
    await bron('Finnhub nieuws', `https://finnhub.io/api/v1/news?category=general&token=${env('FINNHUB_KEY')}`, {
      velden: j => { const n = j?.[0] || {}; return [['lijst', Array.isArray(j) && j.length > 0], ['headline', !!n.headline], ['datetime', getal(n.datetime)], ['url', !!n.url]]; } });
    await bron('Finnhub dividendrendement (schatting)', `https://finnhub.io/api/v1/stock/metric?symbol=KO&metric=all&token=${env('FINNHUB_KEY')}`, {
      velden: j => [['metric', !!j?.metric], ['dividendYieldIndicatedAnnual of currentDividendYieldTTM', getal(j?.metric?.dividendYieldIndicatedAnnual) || getal(j?.metric?.currentDividendYieldTTM)]] });
  }
  if (env('FMP_KEY')) {
    await bron('Financial Modeling Prep dividend', `https://financialmodelingprep.com/stable/dividends?symbol=KO&apikey=${env('FMP_KEY')}`, { hulp: 'controleer FMP_KEY (financialmodelingprep.com → Dashboard)',
      velden: j => { const d = j?.[0] || {}; return [['lijst', Array.isArray(j) && j.length > 0], ['date (ex-datum)', !!(d.date || d.exDividendDate)], ['dividend of adjDividend', getal(d.dividend ?? d.adjDividend)], ['paymentDate', !!d.paymentDate]]; } });
    const van = new Date().toISOString().slice(0, 10), tot = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await bron('Financial Modeling Prep dividendkalender', `https://financialmodelingprep.com/stable/dividends-calendar?from=${van}&to=${tot}&apikey=${env('FMP_KEY')}`, {
      velden: j => [['lijst', Array.isArray(j)]] });
    await bron('Financial Modeling Prep koers (reserve voor aandelen)', `https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${env('FMP_KEY')}`, {
      velden: j => { const q = Array.isArray(j) ? j[0] : j; return [['price', getal(q?.price)], ['changePercentage', q?.changePercentage !== undefined || q?.changesPercentage !== undefined]]; } });
  }
  if (env('FINNHUB_KEY')) {
    const van = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), tot = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await bron('Finnhub nieuws per aandeel', `https://finnhub.io/api/v1/company-news?symbol=AAPL&from=${van}&to=${tot.slice(0, 10)}&token=${env('FINNHUB_KEY')}`, {
      velden: j => { const n = j?.[0] || {}; return [['lijst', Array.isArray(j) && j.length > 0], ['headline', !!n.headline], ['datetime', getal(n.datetime)], ['url', !!n.url]]; } });
    await bron('Finnhub cijferkalender', `https://finnhub.io/api/v1/calendar/earnings?from=${van}&to=${tot}&token=${env('FINNHUB_KEY')}`, {
      velden: j => { const e = j?.earningsCalendar?.[0] || {}; return [['earningsCalendar', Array.isArray(j?.earningsCalendar) && j.earningsCalendar.length > 0], ['symbol', !!e.symbol], ['date', !!e.date]]; } });
  }
  if (env('SEC_CONTACT')) {
    const ua = { 'user-agent': `Hamerslag/1.0 (${env('SEC_CONTACT')})` };
    await bron('SEC EDGAR lijst met bedrijven', 'https://www.sec.gov/files/company_tickers.json', { headers: ua, hulp: 'de SEC weigert: controleer of SEC_CONTACT een echt e-mailadres is',
      velden: j => { const c = Object.values(j || {})[0] || {}; return [['cik_str', getal(c.cik_str)], ['ticker', !!c.ticker]]; } });
    await bron('SEC EDGAR meldingen (Apple)', 'https://data.sec.gov/submissions/CIK0000320193.json', { headers: ua, hulp: 'de SEC weigert: controleer of SEC_CONTACT een echt e-mailadres is',
      velden: j => { const r = j?.filings?.recent || {}; return [['form', Array.isArray(r.form) && r.form.length > 0], ['acceptanceDateTime', Array.isArray(r.acceptanceDateTime)], ['accessionNumber', Array.isArray(r.accessionNumber)], ['primaryDocument', Array.isArray(r.primaryDocument)], ['items', Array.isArray(r.items)]]; } });
  }
  if (env('FRED_KEY')) await bron('FRED (rente, inflatie, VIX)', `https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${env('FRED_KEY')}&file_type=json&sort_order=desc&limit=2`, { hulp: 'controleer FRED_KEY (fredaccount.stlouisfed.org → API Keys)',
    velden: j => { const o = j?.observations?.[0] || {}; return [['observations', Array.isArray(j?.observations) && j.observations.length > 0], ['date', !!o.date], ['value', o.value !== undefined]]; } });
  await bron('Wisselkoers (ECB via Frankfurter)', 'https://api.frankfurter.app/latest?from=USD&to=EUR', { hulp: 'tijdelijk probleem bij frankfurter.app: de app gebruikt dan 0,93',
    velden: j => [['rates.EUR', getal(j?.rates?.EUR)], ['date', !!j?.date]] });
  await bron('Fear & Greed-index', 'https://api.alternative.me/fng/?limit=2', {
    velden: j => [['data', Array.isArray(j?.data) && j.data.length > 0], ['value', getal(j?.data?.[0]?.value)]] });
  // Nieuwsfeeds: kan de motor er koppen, links en datums uit halen?
  const { RSS, parseRss } = await import('./sources.js');
  for (const f of RSS) {
    try {
      const r = await fetchFn(f.url, { headers: { 'user-agent': 'Hamerslag/1.0 (leerproject)' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { let_op(`Nieuws ${f.naam}: fout ${r.status}`, 'de andere nieuwsbronnen gaan gewoon door'); continue; }
      const items = parseRss(await r.text(), f);
      const goedeItems = items.filter(n => n.headline && /^https?:\/\//.test(n.url) && n.datetime > 1e9);
      goedeItems.length ? goed(`Nieuws ${f.naam}: ${goedeItems.length} berichten met kop, link en datum`) : let_op(`Nieuws ${f.naam}: geen bruikbare berichten gevonden`, 'de andere nieuwsbronnen gaan gewoon door; stuur deze melding door');
    } catch (e) { let_op(`Nieuws ${f.naam}: geen verbinding`, e.message); }
  }

  // 6. Pushmelding
  if (env('NTFY_TOPIC')) {
    try {
      const r = await fetchFn(env('NTFY_SERVER', 'https://ntfy.sh'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: env('NTFY_TOPIC'), title: 'Hamerslag: test', message: 'Meldingen werken! Je krijgt voortaan een melding bij trades, stop-loss, spoedzittingen en fouten.', tags: ['white_check_mark'] }), signal: AbortSignal.timeout(10000) });
      r.ok ? goed('Testmelding verstuurd: kijk op je telefoon in ntfy') : fout(`ntfy: fout ${r.status}`, 'controleer NTFY_TOPIC');
    } catch (e) { fout('ntfy: geen verbinding', e.message); }
  }

  log(`\nKlaar: ${uit.ok} goed, ${uit.waarschuwing} waarschuwing${uit.waarschuwing === 1 ? '' : 'en'}, ${uit.fout} fout${uit.fout === 1 ? '' : 'en'}.`);
  log(uit.fout ? 'Los eerst de ❌ op en draai de controle opnieuw.' : 'Alles in orde. Start de eerste zitting: Actions → "Hamerslag uurcheck" → Run workflow.');
  return uit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  controle().then(u => process.exit(u.fout ? 1 : 0)).catch(e => { console.error('Controle mislukt:', e.message); process.exit(1); });
}

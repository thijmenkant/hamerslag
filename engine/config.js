// Alle instellingen op één plek. Geheime sleutels komen uit omgevingsvariabelen
// (GitHub Secrets), nooit uit de code.

// Lege waarden tellen als 'niet ingesteld' (GitHub geeft een lege tekst door voor een variabele die niet bestaat)
export const env = (k, d = undefined) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export const CONFIG = {
  model: env('CLAUDE_MODEL', 'claude-haiku-5-5'),   // voorstellen, debat en controle (snel en goedkoop)
  budgetEur: Number(env('BUDGET_EUR', 50)),          // harde stop per maand voor de AI-kosten
  spaarstandVanaf: 0.7,                              // vanaf 70% van het budget stemmen Opus-traders met Sonnet
  startKapitaal: 1000,          // euro nepgeld
  kosten: 0.0025,               // 0,25% transactiekosten (zoals een exchange)
  spread: 0.001,                // +0,1% spread: je koopt net duurder en verkoopt net goedkoper
  slippageKlein: 0.003,         // +0,3% extra bij kleine munten (crypto buiten de top 20)
  stopLoss: -0.08,              // automatisch verkopen bij -8% op een positie
  winstDoel: 0.15,              // automatisch winst pakken bij +15%
  stopGrenzen: [-0.15, -0.03],  // traders mogen zelf een stop-loss kiezen tussen -15% en -3%
  doelGrenzen: [0.05, 0.40],    // en een winstdoel tussen +5% en +40%
  vastzettenVanaf: 0.10,        // staat een positie ooit +10%, dan schuift de stop-loss naar 0% (winst vastzetten)
  maxPerShort: 0.15,            // short gaan: max 15% van de totale waarde per short
  maxShortTotaal: 0.30,         // en max 30% in alle shorts samen
  wedpot: 100,                  // wedden op Polymarket: aparte pot uit het startkapitaal
  maxPerWed: 20,                // max €20 per weddenschap
  maxOpenWedden: 5,             // max 5 weddenschappen tegelijk
  wedVerschil: 0.10,            // alleen wedden als we minstens 10 procentpunt anders denken dan de markt
  maxPerAsset: 0.25,            // max 25% van totale waarde per asset
  minTrade: 10,                 // minimaal €10 per trade (crypto)
  minTradeAandeel: 50,          // aandelen en ETF's: minimaal €50, zodat de vaste orderkosten niet te zwaar wegen
  vasteKostenAandeel: 1,        // €1 vaste kosten per order bij aandelen en ETF's (zoals bij veel brokers)
  stemmenNodig: 6,              // 6 van de 10
  nieuwsMaxUren: 24,            // ouder nieuws gaat niet in het bronnenpakket
  maxNieuws: 12,
  beoordeelNaMinuten: 72 * 60,  // een stem wordt na 3 dagen beoordeeld (minder toeval)
  minBeweging: 0.001,           // kleiner dan 0,1% telt niet als goed of fout
  rotatie: { minBeoordeeld: 100, maxScore: 0.48 }, // wie eruit kan bij de maandwissel
  historiePunten: 336,
  dividendBelasting: 0.15,      // 15% dividendbelasting (VS met W-8BEN, en ook in Nederland)
  potStemmen: 7,                // geld uit de dividendpot uitgeven kan alleen met 7 van de 10 stemmen          // 7 dagen x 48 rondes
};

// Vier verschillende Claude-modellen: elke trader stemt met zijn eigen 'brein'.
// Prijzen in dollar per miljoen tokens (bron: platform.claude.com/docs/en/about-claude/pricing, nov 2026).
export const MODELLEN = {
  haiku:  { id: env('MODEL_HAIKU',  'claude-haiku-5-5'),  naam: 'Haiku 5.5',  in: 0.10, uit: 0.50, schrijf: 0.125, lees: 0.01 },
  sonnet: { id: env('MODEL_SONNET', 'claude-sonnet-5-5'), naam: 'Sonnet 5.5', in: 2,    uit: 10,   schrijf: 2.5,   lees: 0.10 },
  opus:   { id: env('MODEL_OPUS',   'claude-opus-5-5'),   naam: 'Opus 5.5',   in: 4,    uit: 20,   schrijf: 5,     lees: 0.20 },
  fable:  { id: env('MODEL_FABLE',  'claude-fable-5-2'),  naam: 'Fable 5.2',  in: 8,    uit: 40,   schrijf: 10,    lees: 0.20 },
};
export const prijsVan = id => Object.values(MODELLEN).find(m => m.id === id) || MODELLEN.opus; // onbekend: reken voorzichtig
// Verdeling 4/4/2 over drie modellen: de zwaarste denkers krijgen het sterkste model.
// Fable staat erbij voor later, maar is twee keer zo duur als Opus en wordt nu niet gebruikt.
export const START_MODEL = { noor: 'opus', joost: 'opus', mark: 'sonnet', daan: 'sonnet', lisa: 'sonnet', femke: 'sonnet', sven: 'haiku', yara: 'haiku', ruben: 'haiku', sanne: 'haiku' };

export const ASSETS = [
  { sym: 'BTC',  naam: 'Bitcoin',   soort: 'crypto',  cg: 'bitcoin', rank: 1 },
  { sym: 'ETH',  naam: 'Ethereum',  soort: 'crypto',  cg: 'ethereum', rank: 2 },
  { sym: 'SOL',  naam: 'Solana',    soort: 'crypto',  cg: 'solana' },
  { sym: 'XRP',  naam: 'XRP',       soort: 'crypto',  cg: 'ripple', rank: 3 },
  { sym: 'BNB',  naam: 'BNB',       soort: 'crypto',  cg: 'binancecoin' },
  { sym: 'DOGE', naam: 'Dogecoin',  soort: 'crypto',  cg: 'dogecoin' },
  { sym: 'AAPL', naam: 'Apple',     soort: 'aandeel', fh: 'AAPL' },
  { sym: 'NVDA', naam: 'Nvidia',    soort: 'aandeel', fh: 'NVDA' },
  { sym: 'TSLA', naam: 'Tesla',     soort: 'aandeel', fh: 'TSLA' },
  { sym: 'MSFT', naam: 'Microsoft', soort: 'aandeel', fh: 'MSFT' },
  { sym: 'AMZN', naam: 'Amazon',    soort: 'aandeel', fh: 'AMZN' },
  { sym: 'GOOGL', naam: 'Alphabet (Google)', soort: 'aandeel', fh: 'GOOGL' },
  { sym: 'META', naam: 'Meta',      soort: 'aandeel', fh: 'META' },
  { sym: 'ASML', naam: 'ASML',      soort: 'aandeel', fh: 'ASML' },
];
// KERN: vaste lijst voor de benchmark (kopen & vasthouden) en als startradar.
export const SYMS = ASSETS.map(a => a.sym);
export const assetBySym = Object.fromEntries(ASSETS.map(a => [a.sym, a]));

// Het hele universum dat in de app getoond wordt.
export const CRYPTO_TOP = 40;   // top 40 crypto op marktwaarde (live van CoinGecko)
export const STABLES = new Set(['usdt', 'usdc', 'dai', 'fdusd', 'usde', 'usds', 'tusd', 'pyusd', 'usdd', 'busd', 'frax', 'usd1', 'rlusd', 'usdtb', 'bsc-usd', 'susde', 'susds', 'wbtc', 'weth', 'steth', 'wsteth', 'weeth', 'cbbtc', 'reth', 'wbeth', 'lbtc', 'solvbtc', 'jitosol', 'bnsol', 'msol', 'buidl', 'usyc', 'ustb', 'xaut', 'paxg', 'gho', 'usdg', 'usdf', 'eurc']);
const EUROPA = new Set(['ASML', 'NVO', 'SHEL', 'ING']);
export const AANDELEN = [
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet (Google)'], ['META', 'Meta'], ['TSLA', 'Tesla'],
  ['AVGO', 'Broadcom'], ['AMD', 'AMD'], ['TSM', 'TSMC'], ['ASML', 'ASML'], ['NFLX', 'Netflix'], ['ORCL', 'Oracle'], ['CRM', 'Salesforce'],
  ['ADBE', 'Adobe'], ['INTC', 'Intel'], ['QCOM', 'Qualcomm'], ['ARM', 'Arm Holdings'], ['PLTR', 'Palantir'], ['SHOP', 'Shopify'], ['UBER', 'Uber'],
  ['ABNB', 'Airbnb'], ['SPOT', 'Spotify'], ['PYPL', 'PayPal'], ['COIN', 'Coinbase'], ['MSTR', 'Strategy (MicroStrategy)'], ['HOOD', 'Robinhood'],
  ['V', 'Visa'], ['MA', 'Mastercard'], ['JPM', 'JPMorgan Chase'], ['GS', 'Goldman Sachs'], ['BAC', 'Bank of America'], ['BRK.B', 'Berkshire Hathaway'],
  ['WMT', 'Walmart'], ['COST', 'Costco'], ['KO', 'Coca-Cola'], ['PEP', 'PepsiCo'], ['MCD', "McDonald's"], ['NKE', 'Nike'], ['DIS', 'Disney'],
  ['LLY', 'Eli Lilly'], ['NVO', 'Novo Nordisk'], ['JNJ', 'Johnson & Johnson'], ['PFE', 'Pfizer'], ['XOM', 'ExxonMobil'], ['BA', 'Boeing'],
  ['SHEL', 'Shell'], ['ING', 'ING Groep'],
  // vastgoed (REIT's: verplicht het grootste deel van de winst uitkeren als dividend)
  ['O', 'Realty Income', 'vastgoed'], ['PLD', 'Prologis', 'vastgoed'],
  // Europese bedrijven, via hun notering in de VS (gratis koersen van Amsterdam bestaan niet)
  ['PHG', 'Philips', 'europa'], ['UL', 'Unilever', 'europa'], ['SAP', 'SAP', 'europa'], ['TTE', 'TotalEnergies', 'europa'],
].map(([sym, naam, cat], i) => ({ sym, naam, soort: 'aandeel', cat: cat || (EUROPA.has(sym) ? 'europa' : 'aandeel'), fh: sym, rank: i + 1 }));
const ETF_CAT = { GLD: 'grondstof', SLV: 'grondstof', TLT: 'obligatie', SMH: 'sector', XLK: 'sector', XLE: 'sector', XLF: 'sector', ARKK: 'thema', IBIT: 'crypto', ETHA: 'crypto' };
export const ETFS = [
  ['SPY', 'S&P 500 ETF'], ['QQQ', 'Nasdaq-100 ETF'], ['VTI', 'Totale VS-markt ETF'], ['IWM', 'Russell 2000 (small caps)'], ['DIA', 'Dow Jones ETF'],
  ['VEA', 'Ontwikkelde markten ETF'], ['EEM', 'Opkomende markten ETF'], ['GLD', 'Goud ETF'], ['SLV', 'Zilver ETF'], ['TLT', 'VS-staatsobligaties 20+ jaar'],
  ['SMH', 'Chipbedrijven ETF'], ['XLK', 'Tech-sector ETF'], ['XLE', 'Energie-sector ETF'], ['XLF', 'Financiële sector ETF'], ['ARKK', 'ARK Innovation ETF'],
  ['IBIT', 'iShares Bitcoin ETF'], ['ETHA', 'iShares Ethereum ETF'],
  // vastgoed
  ['VNQ', 'Vastgoed VS ETF', 'vastgoed'], ['XLRE', 'Vastgoedsector ETF', 'vastgoed'],
  // obligaties (leningen aan overheden en bedrijven: rustiger, keren rente uit)
  ['BND', 'Totale obligatiemarkt VS', 'obligatie'], ['IEF', 'VS-staatsobligaties 7-10 jaar', 'obligatie'], ['SHY', 'VS-staatsobligaties 1-3 jaar', 'obligatie'], ['LQD', 'Bedrijfsobligaties ETF', 'obligatie'],
  // grondstoffen
  ['USO', 'Olie ETF', 'grondstof'], ['UNG', 'Aardgas ETF', 'grondstof'], ['DBA', 'Landbouw ETF', 'grondstof'], ['CPER', 'Koper ETF', 'grondstof'],
  // Europa
  ['EWN', 'Nederland ETF (MSCI Netherlands)', 'europa'], ['VGK', 'Europa ETF', 'europa'], ['EZU', 'Eurozone ETF', 'europa'], ['FEZ', 'Euro Stoxx 50 ETF', 'europa'], ['EWG', 'Duitsland ETF', 'europa'],
].map(([sym, naam, cat], i) => ({ sym, naam, soort: 'etf', cat: cat || ETF_CAT[sym] || 'index', fh: sym, rank: i + 1 }));
// Staking: crypto die je bezit levert rente op. Geschatte netto rentes per jaar, na de commissie
// van een exchange (zoals Bitvavo). Echte rentes schommelen: controleer ze af en toe.
export const STAKING = { ETH: 0.025, SOL: 0.055, ADA: 0.022, DOT: 0.10, ATOM: 0.12, AVAX: 0.055, NEAR: 0.06, TRX: 0.035, SUI: 0.025, APT: 0.06, TON: 0.03, POL: 0.025, INJ: 0.08, TIA: 0.08, SEI: 0.04 };

// Uurcheck: elk uur kijken of er iets gebeurt (kost geen AI). Zo ja: een voorzitting bekijkt de kansen
// (één goedkope AI-aanroep) en besluit pas daarna of er een echte zitting komt.
export const ZITTING = {
  rustMin: 25,                  // minimaal 25 minuten na de vorige zitting
  bezigMaxMin: 15,              // een zitting die nog 'bezig' is en jonger dan 15 minuten: niets starten (geen dubbele zittingen)
  stilteUur: 12,                // na 12 uur zonder zitting kijkt de voorzitting sowieso even rond
  maxPerDag: 16,                // gewone zittingen per 24 uur (spoedzittingen tellen apart)
  minScore: 6,                  // de voorzitting houdt alleen een zitting bij een kans met score 6 of hoger
  // Hoeveel moet iets bewegen om op te vallen? [in het afgelopen uur, sinds de vorige zitting]
  drempel: {
    cryptoGroot: [0.02, 0.04],  // top 10 crypto
    crypto: [0.04, 0.08],
    aandeel: [0.015, 0.03],
    index: [0.008, 0.015], sector: [0.012, 0.025], thema: [0.015, 0.03], crypto_etf: [0.02, 0.04],
    grondstof: [0.01, 0.02],    // goud, zilver, olie, ...
    obligatie: [0.005, 0.01],
    vastgoed: [0.01, 0.02], europa: [0.01, 0.02],
  },
  bezitFactor: 0.6,             // wat we bezitten valt eerder op (60% van de drempel)
  maxBewegers: 8,
  vangnetMarge: 0.02,           // positie binnen 2% van stop-loss of winstdoel: altijd een zitting
  nieuwsBelang: 2,              // nieuw nieuws met minimaal dit belang over iets wat we volgen
};

export const RADAR_MAX = 20;    // zoveel assets krijgen de traders per ronde in hun pakket

export const UNIVERSUM = new Map([...ASSETS, ...AANDELEN, ...ETFS].map(a => [a.sym, a]));
export const registreer = a => { const b = UNIVERSUM.get(a.sym); if (b && b.soort !== a.soort) return null; UNIVERSUM.set(a.sym, { ...b, ...a }); return UNIVERSUM.get(a.sym); };
export const vindAsset = sym => UNIVERSUM.get(sym);

// Trefwoorden per asset voor het koppelen van nieuws (naam + symbool, behalve gewone woorden)
const STOPWOORDEN = new Set(['spy', 'dia', 'vea', 'eem', 'gld', 'slv', 'tlt', 'smh', 'xlk', 'xle', 'xlf', 'vti', 'iwm', 'qqq', 'arkk', 'arm', 'coin', 'shop', 'hood', 'dis', 'cost', 'near', 'link', 'ton', 'uni', 'one', 'op', 'etc', 'atom', 'dot', 'hype', 'render', 'stellar', 'mantle', 'ing', 'sui', 'pep', 'ada', 'apt', 'gas', 'ape', 'sand', 'mana', 'flow', 'kas', 'tao', 'vet', 'fil', 'icp']);
export function trefwoorden(a) {
  const w = new Set(KOPPELING[a.sym] || []);
  const naam = a.naam.toLowerCase().replace(/\s*\(.*\)$/, '');
  if (naam.length >= 3 && !STOPWOORDEN.has(naam)) w.add(naam);
  const sym = a.sym.toLowerCase();
  if (sym.length >= 3 && !STOPWOORDEN.has(sym)) w.add(sym);
  return [...w];
}

// Nieuwsreflex: welke woorden in een kop horen bij welke asset.
// 'MARKT' = nieuws dat alles raakt (oorlog, rente, ...).
export const KOPPELING = {
  USO: ['oil', 'olie', 'opec', 'brent', 'crude'], UNG: ['natural gas', 'aardgas', 'gasprijs', 'lng'], DBA: ['wheat', 'tarwe', 'grain', 'cocoa', 'cacao', 'coffee', 'koffie'],
  CPER: ['copper', 'koper'], TLT: ['treasury', 'treasuries', 'bond yield', 'obligatie'], IEF: ['treasury', 'bond yield', 'fed'], BND: ['bond market', 'obligatiemarkt'],
  VNQ: ['real estate', 'vastgoed', 'housing', 'huizenmarkt'], EWN: ['aex', 'nederland', 'dutch'], VGK: ['europe', 'europa', 'ecb'], EZU: ['eurozone', 'ecb', 'lagarde'], FEZ: ['euro stoxx'], EWG: ['germany', 'duitsland', 'dax'],
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'ether', 'eth', 'vitalik'],
  SOL: ['solana', 'sol'],
  XRP: ['xrp', 'ripple'],
  BNB: ['bnb', 'binance coin'],
  DOGE: ['dogecoin', 'doge'],
  AMZN: ['amazon', 'aws', 'jassy', 'bezos'],
  GOOGL: ['google', 'alphabet', 'pichai', 'gemini', 'youtube'],
  META: ['meta', 'facebook', 'instagram', 'whatsapp', 'zuckerberg'],
  ASML: ['asml', 'chipmachine', 'chipmachines', 'lithography', 'lithografie', 'veldhoven'],
  GOOGL: ['google', 'alphabet', 'pichai', 'gemini', 'youtube'],
  MSTR: ['microstrategy', 'saylor', 'strategy inc'],
  COIN: ['coinbase'],
  ING: ['ing groep', 'ing bank'],
  LLY: ['eli lilly', 'mounjaro', 'zepbound'],
  NVO: ['novo nordisk', 'ozempic', 'wegovy'],
  TSM: ['tsmc', 'taiwan semiconductor'],
  AVGO: ['broadcom'],
  SPY: ['s&p 500', 's&p500'], QQQ: ['nasdaq-100', 'nasdaq 100'], IWM: ['russell 2000', 'small caps'], DIA: ['dow jones'],
  GLD: ['gold', 'goud', 'goudprijs'], SLV: ['silver', 'zilver'], TLT: ['treasury', 'treasuries', 'staatsobligaties', 'bond yields'],
  SMH: ['semiconductor', 'semiconductors', 'chipsector'], XLE: ['oil', 'olie', 'olieprijs', 'opec', 'brent'], XLF: ['banks', 'banken'],
  IBIT: ['bitcoin etf', 'ibit'], ETHA: ['ether etf', 'ethereum etf', 'etha'], EEM: ['emerging markets', 'opkomende markten'],
  AAPL: ['apple', 'iphone', 'tim cook'],
  NVDA: ['nvidia', 'huang', 'chipmaker', 'chipmakers', 'gpu', 'blackwell'],
  TSLA: ['tesla', 'musk', 'robotaxi'],
  MSFT: ['microsoft', 'nadella', 'openai', 'azure', 'copilot'],
  CRYPTO: ['crypto', 'cryptomunt', 'cryptomunten', 'stablecoin', 'coinbase', 'binance'],
  MARKT: ['attack', 'missile', 'invasion', 'aanval', 'sanctions', 'sancties', 'fed', 'ecb', 'rente', 'interest rate', 'rate cut', 'rate hike', 'inflation', 'inflatie', 'war', 'oorlog', 'tariff', 'tariffs', 'importheffing', 'recession', 'recessie', 'nasdaq', 's&p 500', 'wall street', 'beurs'],
};

// Gewicht van woorden in een kop. Spoeddebat vanaf SPOED.drempel punten.
export const GEWICHT = {
  3: ['war', 'attack', 'invasion', 'invade', 'missile', 'nuclear', 'oorlog', 'aanval', 'sanction', 'sanctions', 'sancties', 'crash', 'collapse', 'bankrupt', 'bankruptcy', 'faillissement', 'failliet', 'default', 'hack', 'hacked', 'gehackt', 'fraud', 'fraude', 'emergency', 'noodtoestand', 'spionage'],
  2: ['ceo', 'topman', 'topvrouw', 'resign', 'resigns', 'steps down', 'stapt op', 'ontslagen', 'fired', 'weggestuurd', 'returns', 'terug als', 'keert terug', 'acquisition', 'acquire', 'overname', 'merger', 'fusie', 'lawsuit', 'rechtszaak', 'etf', 'approval', 'goedkeuring', 'ban', 'verbod', 'record high', 'recordhoogte', 'earnings', 'kwartaalcijfers', 'outflows', 'inflows', 'sell-off', 'selloff', 'plunge', 'soars', 'kelder', 'schiet omhoog', 'tariff', 'tariffs', 'importheffing'],
  1: ['fed', 'ecb', 'rente', 'rate', 'inflation', 'inflatie', 'trump', 'china', 'russia', 'rusland', 'ukraine', 'oekraïne', 'iran', 'israel', 'recession', 'recessie', 'sec', 'record', 'layoffs', 'ontslagronde'],
};

export const SPOED = {
  drempel: 3,             // minimaal aantal punten (asset genoemd = +1)
  maxLeeftijdMin: 30,     // alleen vers nieuws triggert een spoeddebat
  rustNaRondeMin: 10,     // niet vlak na een gewone ronde
  rustNaSpoedMin: 60,     // max 1 spoeddebat per uur
  maxPerDag: 6,           // houdt de kosten binnen je budget
};

// Amerikaanse beurs ongeveer open (UTC). Aan de voorzichtige kant: bij twijfel dicht.
// Amerikaanse beursdagen: dicht op feestdagen, eerder dicht (13:00 New Yorkse tijd) op een paar dagen
export const BEURS_DICHT = {
  '2026-01-01': 'Nieuwjaar', '2026-01-19': 'Martin Luther King Day', '2026-02-16': 'Presidents Day', '2026-04-03': 'Goede Vrijdag',
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Onafhankelijkheidsdag', '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving', '2026-12-25': 'Kerst',
  '2027-01-01': 'Nieuwjaar', '2027-01-18': 'Martin Luther King Day', '2027-02-15': 'Presidents Day', '2027-03-26': 'Goede Vrijdag',
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth', '2027-07-05': 'Onafhankelijkheidsdag', '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving', '2027-12-24': 'Kerst',
};
export const BEURS_KORT = { '2026-11-27': 'dag na Thanksgiving', '2026-12-24': 'kerstavond', '2027-11-26': 'dag na Thanksgiving' };
// Openingstijden in UTC; klopt in de winter (zomertijd VS/EU ligt een paar weken anders, dan schuift het een uur)
// Rentebesluiten van de Amerikaanse centrale bank (Fed), bron: federalreserve.gov (2027 herzien op 12 nov 2026).
// Datum = de dag van het besluit (20:00 Nederlandse tijd). Oktober 2027 is een overleg zonder besluit.
export const RENTEBESLUIT = { '2026-12-09': 'Fed', '2027-01-27': 'Fed', '2027-03-17': 'Fed', '2027-04-28': 'Fed', '2027-06-09': 'Fed', '2027-07-28': 'Fed', '2027-09-15': 'Fed', '2027-11-17': 'Fed' };

export function beursOpen(d = new Date()) {
  const dag = d.getUTCDay();
  if (dag === 0 || dag === 6) return false;
  const datum = d.toISOString().slice(0, 10);
  if (BEURS_DICHT[datum]) return false;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= 14 * 60 + 30 && m <= (BEURS_KORT[datum] ? 17 * 60 + 55 : 20 * 60 + 55);
}

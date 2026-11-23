import { meld } from './bronstatus.js';
// Praat met de Claude API. Zonder extra pakketten: gewoon fetch.

import { CONFIG, env, prijsVan } from './config.js';

export let verbruik = { input: 0, output: 0, calls: 0, usd: 0 };

export async function vraagJson(prompt, { maxTokens = 2500, temperature = 0.8, vastDeel = null, model = CONFIG.model } = {}) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY ontbreekt');
  let laatsteFout, herstel = null, tokens = maxTokens;
  for (let poging = 1; poging <= 3; poging++) {
    try {
      const gebruiker = vastDeel ? [{ type: 'text', text: vastDeel, cache_control: { type: 'ephemeral' } }, { type: 'text', text: prompt }] : prompt;
      // Was het vorige antwoord geen geldige JSON? Dan laten we Claude zijn eigen antwoord verbeteren.
      const berichten = herstel
        ? [{ role: 'user', content: gebruiker }, { role: 'assistant', content: herstel.tekst.slice(0, 20000) || '{}' }, { role: 'user', content: `Dat antwoord was geen geldige JSON (${herstel.fout}). Stuur precies hetzelfde antwoord opnieuw als één geldig JSON-object: zet aanhalingstekens binnen tekst als \\" en vergeet geen komma's.` }]
        : [{ role: 'user', content: gebruiker }];
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: tokens,   // geen temperature: de 5.5-modellen weigeren die instelling
          system: 'Je bent de regie van een simulatie: 10 AI-traders debatteren over een papieren beleggingsportefeuille met nepgeld. Je antwoordt altijd met precies één geldig JSON-object en niets anders. Gebruik binnen tekst geen dubbele aanhalingstekens (gebruik enkele).',
          // vastDeel = het gedeelde begin (bronnenpakket + debat). Met prompt caching betaal je dat bij herhaling maar 10%.
          messages: berichten,
        }),
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json();
      if (!r.ok) { const e = new Error(`Claude API ${r.status}: ${j?.error?.message || 'onbekende fout'}`); e.api = true; throw e; }
      const u = j.usage || {}, p = prijsVan(model);
      verbruik.calls++; verbruik.input += u.input_tokens || 0; verbruik.output += u.output_tokens || 0;
      verbruik.usd += ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.uit + (u.cache_creation_input_tokens || 0) * p.schrijf + (u.cache_read_input_tokens || 0) * p.lees) / 1e6;
      const tekst = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      meld('anthropic', true, { aantal: `${verbruik.calls} aanroepen` });
      try { return parseJson(tekst); }
      catch (e) {
        // afgekapt (te weinig ruimte)? dan opnieuw met meer ruimte; anders Claude laten verbeteren
        if (j.stop_reason === 'max_tokens') { tokens = Math.min(Math.round(tokens * 1.6), 8000); herstel = null; }
        else herstel = { tekst, fout: e.message.slice(0, 120) };
        throw e;
      }
    } catch (e) {
      laatsteFout = e;
      if (e.api && poging < 3) await new Promise(r => setTimeout(r, 3000 * poging));
    }
  }
  meld('anthropic', false, { melding: laatsteFout?.message });
  throw laatsteFout;
}

// Repareert de typische JSON-foutjes van taalmodellen: komma's te veel of te weinig,
// en aanhalingstekens binnen tekst die niet ge-escaped zijn.
export function repareerJson(t) {
  let s = String(t).replace(/[“”„]/g, '"').replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/}\s*{/g, '},{').replace(/]\s*\[/g, '],[').replace(/"\s*\n\s*"/g, '",\n"').replace(/(\d|true|false|null)\s*\n\s*"/g, '$1,\n"').replace(/}\s*\n\s*"/g, '},\n"');
  // aanhalingsteken binnen een tekst: alleen een einde als er daarna , } ] of : komt
  let uit = '', inTekst = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && inTekst) { uit += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '"') {
      if (!inTekst) { inTekst = true; uit += c; continue; }
      const rest = s.slice(i + 1).match(/^\s*(.)/)?.[1];
      if (rest === undefined || ',}]:'.includes(rest)) { inTekst = false; uit += c; } else uit += '\\"';
      continue;
    }
    if (inTekst && c === '\n') { uit += '\\n'; continue; }
    uit += c;
  }
  return uit;
}

export function parseJson(tekst) {
  const t = String(tekst).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  const kern = a >= 0 && b > a ? t.slice(a, b + 1) : t;
  for (const poging of [t, kern, repareerJson(kern)]) { try { return JSON.parse(poging); } catch {} }
  try { return JSON.parse(kern); } catch (e) { throw new Error(`Geen geldige JSON van Claude: ${e.message}`); }
}

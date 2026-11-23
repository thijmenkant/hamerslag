import { meld } from './bronstatus.js';
// Praat met de Claude API. Zonder extra pakketten: gewoon fetch.

import { CONFIG, env, prijsVan } from './config.js';

export let verbruik = { input: 0, output: 0, calls: 0, usd: 0 };

export async function vraagJson(prompt, { maxTokens = 2500, temperature = 0.8, vastDeel = null, model = CONFIG.model } = {}) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY ontbreekt');
  let laatsteFout;
  for (let poging = 1; poging <= 2; poging++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: maxTokens, temperature,
          system: 'Je bent de regie van een simulatie: 10 AI-traders debatteren over een papieren beleggingsportefeuille met nepgeld. Je antwoordt altijd met precies één geldig JSON-object en niets anders.',
          // vastDeel = het gedeelde begin (bronnenpakket + debat). Met prompt caching betaal je dat bij herhaling maar 10%.
          messages: [{ role: 'user', content: vastDeel ? [{ type: 'text', text: vastDeel, cache_control: { type: 'ephemeral' } }, { type: 'text', text: prompt }] : prompt }],
        }),
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`Claude API ${r.status}: ${j?.error?.message || 'onbekende fout'}`);
      const u = j.usage || {}, p = prijsVan(model);
      verbruik.calls++; verbruik.input += u.input_tokens || 0; verbruik.output += u.output_tokens || 0;
      verbruik.usd += ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.uit + (u.cache_creation_input_tokens || 0) * p.schrijf + (u.cache_read_input_tokens || 0) * p.lees) / 1e6;
      const tekst = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      meld('anthropic', true, { aantal: `${verbruik.calls} aanroepen` });
      return parseJson(tekst);
    } catch (e) {
      laatsteFout = e;
      if (poging === 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  meld('anthropic', false, { melding: laatsteFout?.message });
  throw laatsteFout;
}

export function parseJson(tekst) {
  const t = String(tekst).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Geen JSON in het antwoord van Claude');
}

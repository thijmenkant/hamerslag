// Pushmeldingen naar je telefoon via ntfy (gratis, geen account nodig).
// Installeer de app "ntfy" en abonneer je op jouw geheime onderwerp (NTFY_TOPIC).
import { env } from './config.js';

export async function push({ titel, tekst, prio = 3, tags = [] }) {
  const topic = env('NTFY_TOPIC');
  if (!topic) return false;
  // Het hamer-icoon naast de melding (Android). Staat de app ergens anders, zet dan PUSH_ICON.
  let icon = env('PUSH_ICON');
  if (!icon && env('APP_URL')) { try { const u = new URL(env('APP_URL')); if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/[^/]*$/, ''); icon = new URL('icon-192.png', u).href; } catch {} }
  try {
    const r = await fetch(env('NTFY_SERVER', 'https://ntfy.sh'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, title: titel, message: tekst, priority: prio, tags, click: env('APP_URL') || undefined, icon: icon || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch { return false; } // een mislukte melding mag een ronde nooit laten mislukken
}

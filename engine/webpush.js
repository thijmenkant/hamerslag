// Pushmeldingen van de Hamerslag-app zelf (Web Push, zoals elke webapp het doet).
// Geen extra pakketten: de versleuteling (RFC 8291) en de afzender-handtekening (VAPID, RFC 8292) zitten hier zelf in.
//
// De VAPID-sleutel (de "afzender" van de meldingen) wordt afgeleid van SUPABASE_SERVICE_KEY,
// zodat er geen nieuw geheim nodig is. De publieke helft zet de motor in de staat; daar haalt de app hem op.

import crypto from 'node:crypto';
import { env } from './config.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
const vanB64u = s => Buffer.from(String(s).replace(/=+$/, ''), 'base64url');

let sleutels = null;
export function vapidSleutels(geheim = env('SUPABASE_SERVICE_KEY')) {
  if (!geheim) return null;
  if (sleutels?.geheim === geheim) return sleutels;
  for (let i = 0; i < 10; i++) {
    const d = Buffer.from(crypto.hkdfSync('sha256', geheim, 'hamerslag', `vapid-v1-${i}`, 32));
    try {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(d);
      const pub = ecdh.getPublicKey();
      const prive = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
      return (sleutels = { geheim, publiek: b64u(pub), prive });
    } catch { /* uiterst zeldzaam: ongeldige sleutel, volgende proberen */ }
  }
  throw new Error('kon geen VAPID-sleutel maken');
}

// RFC 8291: versleutel de melding voor één abonnement (aes128gcm)
export function versleutel(tekst, { p256dh, auth }, { zout = crypto.randomBytes(16), afzender = null } = {}) {
  const uaPub = vanB64u(p256dh), geheimAuth = vanB64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (afzender) ecdh.setPrivateKey(vanB64u(afzender)); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const gedeeld = ecdh.computeSecret(uaPub);
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const prkKey = hmac(geheimAuth, gedeeld);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const prk = hmac(zout, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const versleuteld = Buffer.concat([c.update(Buffer.concat([Buffer.from(tekst), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([zout, rs, Buffer.from([asPub.length]), asPub, versleuteld]);
}

// RFC 8292: bewijs dat de melding van Hamerslag komt
function vapidKop(endpoint, s) {
  const kop = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env('APP_URL') || 'https://hamerslag.vercel.app' }));
  const handtekening = crypto.sign('sha256', Buffer.from(`${kop}.${claims}`), { key: s.prive, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${kop}.${claims}.${b64u(handtekening)}, k=${s.publiek}`;
}

// Stuur één melding naar één abonnement. Geeft 'ok', 'weg' (abonnement bestaat niet meer) of 'fout'.
export async function stuur(abonnement, bericht, { urgent = false, fetchFn = fetch } = {}) {
  const s = vapidSleutels(); if (!s) return 'fout';
  try {
    const r = await fetchFn(abonnement.endpoint, {
      method: 'POST',
      headers: { Authorization: vapidKop(abonnement.endpoint, s), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: urgent ? 'high' : 'normal' },
      body: versleutel(JSON.stringify(bericht), abonnement),
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404 || r.status === 410) return 'weg';
    return r.ok ? 'ok' : 'fout';
  } catch { return 'fout'; }
}

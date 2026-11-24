// Test: een melding komt versleuteld en ondertekend aan, precies zoals een telefoon hem uitpakt.
//   node test/meldingen.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SUPABASE_SERVICE_KEY = 'test-geheim';
const { geheugenDb } = await import('../db.js');
const { push } = await import('../push.js');
const { vapidSleutels } = await import('../webpush.js');

// Een nep-telefoon die zich aanmeldt
const tel = crypto.createECDH('prime256v1'); tel.generateKeys();
const auth = crypto.randomBytes(16);
const db = geheugenDb();
db.data.push = [{ endpoint: 'https://web.push.apple.com/abc', p256dh: tel.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
                { endpoint: 'https://fcm.googleapis.com/weg', p256dh: tel.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }];
const verstuurd = [];
globalThis.fetch = async (url, o) => { verstuurd.push({ url, o }); return new Response(null, { status: url.includes('/weg') ? 410 : 201 }); };

assert.equal(await push({ titel: 'Gekocht: €100 BTC', tekst: 'Aangenomen met 7 van 10 stemmen', prio: 4, db }), true);
const { o } = verstuurd[0];

// 1. Uitpakken zoals de telefoon dat doet (RFC 8291)
const body = Buffer.from(o.body), zout = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const gedeeld = tel.computeSecret(asPub);
const ikm = hmac(hmac(auth, gedeeld), Buffer.concat([Buffer.from('WebPush: info\0'), tel.getPublicKey(), asPub, Buffer.from([1])]));
const prk = hmac(zout, ikm);
const d = crypto.createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
d.setAuthTag(data.subarray(-16));
const platte = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
const bericht = JSON.parse(platte.subarray(0, platte.lastIndexOf(2)).toString());
assert.equal(bericht.titel, 'Gekocht: €100 BTC'); assert.equal(bericht.urgent, true);

// 2. Afzender (VAPID) klopt: geldige handtekening met de publieke sleutel uit de staat
const [, t, k] = o.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, vapidSleutels().publiek);
const [h, c, sig] = t.split('.');
const pub = Buffer.from(k, 'base64url');
const sleutel = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: sleutel, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://web.push.apple.com');
assert.equal(o.headers['Content-Encoding'], 'aes128gcm'); assert.equal(o.headers.Urgency, 'high');

// 3. Een telefoon die de meldingen uitzette (410) wordt opgeruimd
assert.deepEqual(db.data.push.map(a => a.endpoint), ['https://web.push.apple.com/abc']);

// 4. Elke keer dezelfde afzendersleutel (anders werken bestaande aanmeldingen niet meer)
assert.equal(vapidSleutels('test-geheim').publiek, vapidSleutels('test-geheim').publiek);
console.log('✅ Meldingen werken: versleuteld zoals de telefoon verwacht, ondertekend door Hamerslag, uitgezette telefoons opgeruimd.');

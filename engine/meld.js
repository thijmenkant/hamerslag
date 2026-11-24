// Losse melding versturen, bijv. vanuit GitHub als een workflow mislukt:  node meld.js "titel" "tekst"
import { push } from './push.js';
const [titel = 'Hamerslag', tekst = 'Testmelding'] = process.argv.slice(2);
const ok = await push({ titel, tekst, prio: 5 });
console.log(ok ? 'melding verstuurd' : 'geen melding verstuurd (nog geen apparaat aangemeld?)');

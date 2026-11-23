// Speelt een ronde af: beurt voor beurt, zodat de zaal "live" voelt.
// Iedereen die meekijkt (home, 3D-zaal) krijgt dezelfde toestand.

const DUUR = { systeem: 1600, voorstel: 650, debat: 6500, voorzitter: 5200, stem: 1300, uitslag: 7000 };

export class Speler {
  constructor() {
    this.luisteraars = new Set();
    this.wachtrij = [];
    this.timer = null;
    this.reset();
  }
  reset(round = null) {
    clearTimeout(this.timer); this.timer = null;
    this.wachtrij = [];
    this.s = {
      round, spoed: round?.spoed || null, fase: 'wachten', spreker: null, tekst: '', bronnen: [], voorstel: round?.proposal || null,
      voorstellen: [], transcript: [], stemmen: {}, aanleiding: round?.aanleiding || null, uitslag: null, voor: 0, tegen: 0, hierna: null, systeem: '',
    };
    this.emit();
  }
  op(fn) { this.luisteraars.add(fn); fn(this.s); return () => this.luisteraars.delete(fn); }
  emit() { for (const f of this.luisteraars) f(this.s); }

  // Hele ronde in één keer afspelen (demo of herhaling)
  speel(round, messages, { lus = false } = {}) {
    this.reset(round);
    this.lus = lus ? { round, messages } : null;
    for (const m of messages) this.wachtrij.push(m);
    this.volgende();
  }
  // Live: nieuw bericht uit de database
  voegToe(m) { this.wachtrij.push(m); if (!this.timer) this.volgende(); }
  // Direct naar de eindstand (bijv. als je de app opent na afloop)
  eindstand(round, messages) {
    this.reset(round);
    for (const m of messages) this.verwerk(m, true);
    this.s.spreker = null; this.emit();
  }

  volgende() {
    this.timer = null;
    const m = this.wachtrij.shift();
    if (!m) {
      if (this.lus) this.timer = setTimeout(() => this.speel(this.lus.round, this.lus.messages, { lus: true }), 14000);
      return;
    }
    this.verwerk(m, false);
    this.emit();
    this.timer = setTimeout(() => this.volgende(), DUUR[m.phase] ?? 1500);
  }

  verwerk(m, stil) {
    const s = this.s;
    if (m.phase === 'systeem') {
      s.systeem = m.text;
      if (m.action?.spoed) { s.spoed = m.action; return; }
      if (m.action?.aanleiding) { s.aanleiding = m.action.aanleiding; return; }
      if (m.action?.actie) { s.voorstel = { ...(s.voorstel || {}), ...m.action }; s.fase = 'debat'; }
      else if (s.fase === 'wachten') s.fase = 'analyse';
    } else if (m.phase === 'voorstel') {
      s.fase = 'voorstel'; s.voorstellen.push(m);
    } else if (m.phase === 'debat') {
      s.fase = 'debat'; s.spreker = m.trader_id; s.tekst = m.text; s.bronnen = m.sources || []; s.emotie = m.action?.emotie || null;
      s.transcript.push(m);
      const vlg = this.wachtrij.find(x => x.phase === 'debat' && x.trader_id !== 'voorzitter');
      s.hierna = vlg?.trader_id || null;
    } else if (m.phase === 'voorzitter') {
      // Voorzitter stuurt iedereen naar de stemhokjes
      if (m.action?.fase === 'stemming') s.fase = 'stemming';
      s.spreker = 'voorzitter'; s.tekst = m.text; s.bronnen = m.sources || []; s.hierna = null; s.emotie = m.action?.geschrapt ? 'boos' : 'zeker';
      s.transcript.push(m);
    } else if (m.phase === 'stem') {
      s.fase = 'stemming'; s.spreker = null;
      s.stemmen[m.trader_id] = { stem: m.action?.stem, reden: m.text, bronnen: m.sources || [], bedrag: m.action?.bedrag || null };
      const vals = Object.values(s.stemmen);
      s.voor = vals.filter(v => v.stem === 'VOOR').length; s.tegen = vals.length - s.voor;
    } else if (m.phase === 'uitslag') {
      s.fase = 'uitslag'; s.spreker = m.trader_id === 'voorzitter' ? 'voorzitter' : null; s.tekst = m.trader_id === 'voorzitter' ? m.text : ''; s.bronnen = []; s.uitslag = { tekst: m.text, ...(m.action || {}) };
    }
  }
}

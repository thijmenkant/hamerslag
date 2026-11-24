// Houdt per bron bij of hij werkte. Bij het opslaan van de staat gaat dit mee in state.bronStatus,
// zodat de tab Bronnen in de app per bron een lampje kan tonen (groen, oranje, rood of grijs).
const nieuw = {};
// Luisteraars (de voortgang in de app): horen per bron 'bezig', 'ok', 'fout' of 'uit'
const luisteraars = new Set();
export function luister(fn) { luisteraars.add(fn); return () => luisteraars.delete(fn); }
const sein = (id, status, aantal) => { for (const f of luisteraars) { try { f(id, status, aantal); } catch {} } };
const nu = () => new Date().toISOString();

export function meld(id, ok, { aantal, melding } = {}) {
  // een fout overschrijft geen succes van dezelfde run (bijv. één RSS-feed van twee mislukt)
  if (ok === false && nieuw[id]?.ok === true) return;
  sein(id, ok ? 'ok' : 'fout', aantal != null ? String(aantal).slice(0, 40) : undefined);
  nieuw[id] = { ok, t: nu(), ...(aantal != null ? { aantal: String(aantal).slice(0, 40) } : {}), ...(melding ? { melding: String(melding).slice(0, 120) } : {}) };
}
export function uitgezet(id, melding) { sein(id, 'uit'); nieuw[id] = { uit: true, t: nu(), melding }; }

// Meet een bron: lukt het, dan groen met een aantal; mislukt het, dan rood met de reden.
export async function meet(id, fn, aantal) {
  sein(id, 'bezig');
  try { const r = await fn(); meld(id, true, { aantal: aantal ? aantal(r) : undefined }); return r; }
  catch (e) { meld(id, false, { melding: e.message }); throw e; }
}

export function bewaarIn(staat) {
  if (!staat || !Object.keys(nieuw).length) return;
  staat.bronStatus = { ...(staat.bronStatus || {}), ...nieuw };
  for (const k of Object.keys(nieuw)) delete nieuw[k];
}
export const huidig = () => ({ ...nieuw });

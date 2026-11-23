// Houdt per bron bij of hij werkte. Bij het opslaan van de staat gaat dit mee in state.bronStatus,
// zodat de tab Bronnen in de app per bron een lampje kan tonen (groen, oranje, rood of grijs).
const nieuw = {};
const nu = () => new Date().toISOString();

export function meld(id, ok, { aantal, melding } = {}) {
  // een fout overschrijft geen succes van dezelfde run (bijv. één RSS-feed van twee mislukt)
  if (ok === false && nieuw[id]?.ok === true) return;
  nieuw[id] = { ok, t: nu(), ...(aantal != null ? { aantal: String(aantal).slice(0, 40) } : {}), ...(melding ? { melding: String(melding).slice(0, 120) } : {}) };
}
export function uitgezet(id, melding) { nieuw[id] = { uit: true, t: nu(), melding }; }

// Meet een bron: lukt het, dan groen met een aantal; mislukt het, dan rood met de reden.
export async function meet(id, fn, aantal) {
  try { const r = await fn(); meld(id, true, { aantal: aantal ? aantal(r) : undefined }); return r; }
  catch (e) { meld(id, false, { melding: e.message }); throw e; }
}

export function bewaarIn(staat) {
  if (!staat || !Object.keys(nieuw).length) return;
  staat.bronStatus = { ...(staat.bronStatus || {}), ...nieuw };
  for (const k of Object.keys(nieuw)) delete nieuw[k];
}
export const huidig = () => ({ ...nieuw });

// One-shot script: append 2 behavior rules to Nicolas's protocol sections
// errors: no self-justify on bad drafts
// templates: clean exit on hors-cible

const SUPA_URL = "https://sbervjdurjahqphaqgjb.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZXJ2amR1cmphaHFwaGFxZ2piIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE4MDczNSwiZXhwIjoyMDkxNzU2NzM1fQ.0BPlQ0lJbNP63G7dXtoTdyJhS0v4Oy8VqgDrv0cohA4";
const DOC_ID = "32eed005-c7a2-4756-93b6-8b824ccf304e";

const headers = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function getSection(kind) {
  const r = await fetch(`${SUPA_URL}/rest/v1/protocol_section?document_id=eq.${DOC_ID}&kind=eq.${kind}&select=id,prose`, { headers });
  const data = await r.json();
  return data[0];
}

async function patchSection(id, newProse) {
  const r = await fetch(`${SUPA_URL}/rest/v1/protocol_section?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ prose: newProse }),
  });
  return r.status;
}

const ERRORS_APPEND = `\n\nÉviter d'expliquer pourquoi un draft était mauvais, ni de demander pourquoi — Préférer : si l'utilisateur signale que le message est nul, trop IA, trop verbeux, trop construit — réécrire immédiatement sans commentaire ni question.`;

const TEMPLATES_APPEND = `\n\nSkeleton sortie hors-cible confirmée : 1 phrase de réaction humaine courte (optionnelle) + 'Bonne chance [pour X]. Nicolas.' Max 2 lignes. Aucune explication de transition, aucun pivot vers l'offre.`;

const errors = await getSection("errors");
const templates = await getSection("templates");

// Check if already applied (idempotent)
const errorsAlreadyPatched = errors.prose.includes("réécrire immédiatement sans commentaire ni question");
const templatesAlreadyPatched = templates.prose.includes("Bonne chance [pour X]. Nicolas.");

if (errorsAlreadyPatched) {
  console.log("errors: already has rule, skipping");
} else {
  const status = await patchSection(errors.id, errors.prose + ERRORS_APPEND);
  console.log(`errors PATCH → ${status}`);
}

if (templatesAlreadyPatched) {
  console.log("templates: already has rule, skipping");
} else {
  const status = await patchSection(templates.id, templates.prose + TEMPLATES_APPEND);
  console.log(`templates PATCH → ${status}`);
}

console.log("done");

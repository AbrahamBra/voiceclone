// Bulk accept/reject pending propositions for Nicolas Lavallée
// Replicates the accept logic from api/v2/propositions.js (patchProse + status update).
// Run once, idempotent (skips non-pending).

const SUPA_URL = "https://sbervjdurjahqphaqgjb.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZXJ2amR1cmphaHFwaGFxZ2piIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE4MDczNSwiZXhwIjoyMDkxNzU2NzM1fQ.0BPlQ0lJbNP63G7dXtoTdyJhS0v4Oy8VqgDrv0cohA4";
const DOC_ID = "32eed005-c7a2-4756-93b6-8b824ccf304e";

const AMEND_INTENTS = new Set(["amend_rule", "clarify_rule", "add_example"]);

const h = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function db(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: h, ...opts });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${path}: ${t}`);
  }
  return opts.method === "PATCH" || opts.method === "DELETE" ? null : r.json();
}

function patchProse(currentProse, proposedText, intent) {
  const text = (proposedText || "").trim();
  if (!text) return currentProse;
  const sep = currentProse && !currentProse.endsWith("\n") ? "\n\n" : "";
  if (AMEND_INTENTS.has(intent)) return `${currentProse}${sep}[${intent}] ${text}`;
  return `${currentProse}${sep}${text}`;
}

// Get all pending propositions
const props = await db(`proposition?document_id=eq.${DOC_ID}&status=eq.pending&select=id,source,target_kind,proposed_text,confidence,intent,target_section_id&order=confidence.desc`);
console.log(`Found ${props.length} pending propositions`);

// The one to reject — conflicts with established 6-line rule
const REJECT_IDS = new Set([
  "c0453563-67f2-4b6e-9972-345ad0e557af", // "Jamais plus de 5 lignes par message" — conflicts with 6-line rule
]);

// Section cache to avoid re-fetching
const sectionCache = {};

async function getSection(kind) {
  if (sectionCache[kind]) return sectionCache[kind];
  const rows = await db(`protocol_section?document_id=eq.${DOC_ID}&kind=eq.${kind}&select=id,prose`);
  if (!rows?.length) throw new Error(`No section found for kind=${kind}`);
  sectionCache[kind] = rows[0];
  return rows[0];
}

let accepted = 0, rejected = 0, skipped = 0;

for (const prop of props) {
  if (REJECT_IDS.has(prop.id)) {
    await db(`proposition?id=eq.${prop.id}`, {
      method: "PATCH",
      headers: { ...h, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "rejected", resolved_at: new Date().toISOString() }),
    });
    console.log(`REJECTED  [${prop.target_kind}] ${prop.proposed_text.slice(0, 60)}`);
    rejected++;
    continue;
  }

  // Accept: patch section prose, update proposition status
  const section = await getSection(prop.target_kind);
  const newProse = patchProse(section.prose || "", prop.proposed_text, prop.intent);

  await db(`protocol_section?id=eq.${section.id}`, {
    method: "PATCH",
    headers: { ...h, "Prefer": "return=minimal" },
    body: JSON.stringify({ prose: newProse, author_kind: "proposition_accepted" }),
  });

  // Update section cache so next prop in same kind appends correctly
  sectionCache[prop.target_kind] = { ...section, prose: newProse };

  await db(`proposition?id=eq.${prop.id}`, {
    method: "PATCH",
    headers: { ...h, "Prefer": "return=minimal" },
    body: JSON.stringify({
      status: "accepted",
      resolved_at: new Date().toISOString(),
      target_section_id: prop.target_section_id || section.id,
    }),
  });

  console.log(`ACCEPTED  [${prop.target_kind}] ${prop.proposed_text.slice(0, 60)}`);
  accepted++;
}

console.log(`\nDone: ${accepted} accepted, ${rejected} rejected, ${skipped} skipped`);

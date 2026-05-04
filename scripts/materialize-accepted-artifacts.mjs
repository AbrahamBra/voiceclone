// Materialize protocol_artifact rows for all accepted propositions that
// don't have one yet. Replicates the materializeArtifact() logic from
// api/v2/propositions.js without the Haiku deriveCheckParams call
// (check_params is optional — absence just means the runtime checker
// won't auto-fire; the rule text is still injected into the system prompt).

import crypto from "crypto";

const SUPA_URL = "https://sbervjdurjahqphaqgjb.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZXJ2amR1cmphaHFwaGFxZ2piIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE4MDczNSwiZXhwIjoyMDkxNzU2NzM1fQ.0BPlQ0lJbNP63G7dXtoTdyJhS0v4Oy8VqgDrv0cohA4";
const DOC_ID = "32eed005-c7a2-4756-93b6-8b824ccf304e";

const INTENT_TO_ARTIFACT_KIND = { add_rule: "hard_check", add_paragraph: "pattern" };
const ARTIFACT_KIND_TO_SEVERITY = { hard_check: "hard", pattern: "light" };

const h = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=minimal",
};

function hash(text) {
  const norm = text.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  if (!norm) return null;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

// Load all accepted propositions for this document
const props = await fetch(
  `${SUPA_URL}/rest/v1/proposition?document_id=eq.${DOC_ID}&status=eq.accepted&select=id,intent,target_kind,target_section_id,proposed_text,confidence`,
  { headers: h }
).then(r => r.json());

console.log(`Found ${props.length} accepted propositions`);

// Load existing artifact hashes to avoid duplicates
const existingArtifacts = await fetch(
  `${SUPA_URL}/rest/v1/protocol_artifact?source_section_id=in.(b52367c5-316e-4c2f-9db7-a3290337d3e1,532ea65a-9740-413a-9443-4a087c6c9489,33a1a4e8-3747-4160-a851-13997aa2fbac,310c2bf8-060d-4476-8569-b655683418d4,b44aafc5-b94a-42cf-90e6-c828498abd46,7988bbd0-068c-47ad-9ef5-66a7a31387a3,f7e8c8e5-3188-4815-ad53-b25eb55b04e2)&select=content_hash`,
  { headers: h }
).then(r => r.json());

const existingHashes = new Set((existingArtifacts || []).map(a => a.content_hash).filter(Boolean));
console.log(`Found ${existingHashes.size} existing artifact hashes`);

let created = 0, skipped = 0, noKind = 0;

for (const prop of props) {
  const kind = INTENT_TO_ARTIFACT_KIND[prop.intent];
  if (!kind) { noKind++; continue; }

  const text = (prop.proposed_text || "").trim();
  if (!text) { noKind++; continue; }

  const contentHash = hash(text);
  if (!contentHash || existingHashes.has(contentHash)) { skipped++; continue; }

  const severity = ARTIFACT_KIND_TO_SEVERITY[kind];
  const sectionId = prop.target_section_id;
  if (!sectionId) { noKind++; continue; }

  const r = await fetch(`${SUPA_URL}/rest/v1/protocol_artifact`, {
    method: "POST",
    headers: { ...h, "Prefer": "return=minimal" },
    body: JSON.stringify({
      source_section_id: sectionId,
      kind,
      severity,
      is_active: true,
      is_manual_override: false,
      content_hash: contentHash,
      content: {
        text,
        intent: prop.intent,
        source_proposition_id: prop.id,
        source_kind: prop.target_kind,
        confidence: prop.confidence,
      },
    }),
  });

  if (r.ok || r.status === 201) {
    console.log(`CREATED [${kind}/${prop.target_kind}] ${text.slice(0, 65)}`);
    existingHashes.add(contentHash); // prevent re-insert within same run
    created++;
  } else {
    const err = await r.text();
    console.log(`ERROR ${r.status}: ${err.slice(0, 100)}`);
  }
}

console.log(`\nDone: ${created} created, ${skipped} already existed, ${noKind} skipped (intent not mapped)`);

// Insert the 2 critical behavior rules directly as protocol_artifact rows
// so they reach the system prompt (protocol_section.prose alone is NOT injected).

import crypto from "crypto";

const SUPA_URL = "https://sbervjdurjahqphaqgjb.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZXJ2amR1cmphaHFwaGFxZ2piIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE4MDczNSwiZXhwIjoyMDkxNzU2NzM1fQ.0BPlQ0lJbNP63G7dXtoTdyJhS0v4Oy8VqgDrv0cohA4";

const ERRORS_SECTION_ID  = "b52367c5-316e-4c2f-9db7-a3290337d3e1";
const TEMPLATES_SECTION_ID = "7988bbd0-068c-47ad-9ef5-66a7a31387a3";

const h = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
};

function hash(text) {
  const norm = text.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  if (!norm) return null;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

const rules = [
  {
    source_section_id: ERRORS_SECTION_ID,
    kind: "hard_check",
    severity: "hard",
    is_manual_override: true,
    is_active: true,
    content: {
      text: "Ne jamais expliquer pourquoi un draft était mauvais, ni demander pourquoi. Si l'utilisateur signale que le message est nul, trop IA, trop verbeux, trop construit — réécrire immédiatement sans commentaire ni question.",
      intent: "add_rule",
      source_kind: "errors",
    },
  },
  {
    source_section_id: TEMPLATES_SECTION_ID,
    kind: "hard_check",
    severity: "hard",
    is_manual_override: true,
    is_active: true,
    content: {
      text: "Sortie hors-cible confirmée : 1 phrase de réaction humaine courte (optionnelle) + 'Bonne chance [pour X]. Nicolas.' Max 2 lignes. Aucune explication de transition, aucun pivot vers l'offre.",
      intent: "add_rule",
      source_kind: "templates",
    },
  },
];

for (const rule of rules) {
  const text = rule.content.text;
  const contentHash = hash(text);

  // Check if already exists
  const existing = await fetch(
    `${SUPA_URL}/rest/v1/protocol_artifact?content_hash=eq.${contentHash}&is_active=eq.true`,
    { headers: h }
  ).then(r => r.json());

  if (existing?.length > 0) {
    console.log(`SKIP (already exists): ${text.slice(0, 60)}`);
    continue;
  }

  const r = await fetch(`${SUPA_URL}/rest/v1/protocol_artifact`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ ...rule, content_hash: contentHash }),
  });

  if (r.ok) {
    console.log(`INSERTED: ${text.slice(0, 60)}`);
  } else {
    const err = await r.text();
    console.log(`ERROR: ${r.status} — ${err}`);
  }
}

console.log("done");

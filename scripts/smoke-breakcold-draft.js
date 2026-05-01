#!/usr/bin/env node
// Smoke test for the V3.6.5 PR-1 Breakcold integration. Hits a deployed
// Setclone instance over HTTP with x-api-key auth, exactly like n8n does.
//
// Use this BEFORE setting up Breakcold + n8n to confirm the API key works,
// drafts come back in the right voice, and idempotency holds. If this passes,
// the only thing left to debug end-to-end is the n8n template + Breakcold
// automation wiring (those don't depend on Setclone).
//
// Required env :
//   SETCLONE_API_KEY     sk_… minted from /brain/<persona>/intégrations
//   SETCLONE_BASE_URL    optional, default https://voiceclone-lake.vercel.app
//
// Run :
//   node scripts/smoke-breakcold-draft.js
//
// Exits 0 on full pass, 1 on any failure.

const BASE_URL = (process.env.SETCLONE_BASE_URL || "https://voiceclone-lake.vercel.app").replace(/\/+$/, "");
const API_KEY = process.env.SETCLONE_API_KEY;

if (!API_KEY || !API_KEY.startsWith("sk_")) {
  console.error("✗ SETCLONE_API_KEY is required (mint one at /brain/<persona>/intégrations).");
  process.exit(1);
}

// Unique-per-run lead ref so a re-run doesn't collide with a previous run's
// conv. The first POST creates the conv ; the 2nd POST on the same ref must
// hit the idempotent path.
const RUN_ID = `smoke-${Date.now()}`;
const LEAD_REF = `smoke:${RUN_ID}`;

const PROSPECT = {
  prospect_data: {
    name: "Alex Dupont (smoke test)",
    context: [
      "[Contexte lead — Alex Dupont]",
      "Founder d'une PME de 50 personnes, secteur logiciel B2B.",
      "Vient de poster sur LinkedIn une réflexion sur l'IA dans les ventes.",
      "Cherche à structurer son équipe commerciale pour 2026.",
    ].join("\n"),
  },
  source_core: "interaction_contenu",
  external_lead_ref: LEAD_REF,
};

let pass = 0, fail = 0;
function ok(label) { console.log(`  ✓ ${label}`); pass++; }
function ko(label, extra) {
  console.log(`  ✗ ${label}${extra ? "\n    " + JSON.stringify(extra, null, 2).split("\n").join("\n    ") : ""}`);
  fail++;
}

async function postDraft(body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/v2/draft`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  let json = null;
  try { json = await res.json(); } catch { /* leave null */ }
  return { status: res.status, json, ms };
}

console.log(`\n=== Setclone × Breakcold smoke ===`);
console.log(`base_url:        ${BASE_URL}`);
console.log(`api_key prefix:  ${API_KEY.slice(0, 6)}…`);
console.log(`lead ref:        ${LEAD_REF}`);

// ── 1. Fresh draft ─────────────────────────────────────────────
console.log(`\n[1] Fresh draft — POST /api/v2/draft`);
const r1 = await postDraft(PROSPECT);
if (r1.status !== 200) {
  ko(`expected 200, got ${r1.status}`, r1.json);
  console.error(`\n→ Stop. Fix this before going further.`);
  process.exit(1);
}
ok(`status=200 (${r1.ms}ms)`);
if (r1.json.draft && r1.json.draft.length > 10) ok(`draft non-empty (${r1.json.draft.length} chars)`);
else ko("draft missing/empty");
if (r1.json.persona_id) ok(`persona_id present: ${r1.json.persona_id}`);
else ko("persona_id MISSING — n8n deep link will be broken");
if (r1.json.conversation_id) ok(`conversation_id: ${r1.json.conversation_id}`);
else ko("conversation_id missing — sidebar 'À envoyer' won't pick it up");
if (r1.json.qualification?.verdict) ok(`qualification.verdict=${r1.json.qualification.verdict} confidence=${r1.json.qualification.confidence}`);
else ko("qualification missing — n8n branching node will route everything to TRUE", r1.json);
if (r1.json.idempotent) ko("first call should NOT be idempotent");
else ok("first call was a real generation (not idempotent)");

// ── 2. Idempotent re-fire ──────────────────────────────────────
console.log(`\n[2] Idempotent re-fire — same external_lead_ref`);
const r2 = await postDraft(PROSPECT);
if (r2.status === 200 && r2.json.idempotent === true) {
  ok(`status=200, idempotent=true (${r2.ms}ms)`);
} else {
  ko(`expected 200 + idempotent:true, got ${r2.status} idempotent=${r2.json?.idempotent}`, r2.json);
}
if (r2.json.conversation_id === r1.json.conversation_id) ok("conversation_id matches");
else ko(`conv id drift: first=${r1.json.conversation_id} second=${r2.json.conversation_id}`);
if (r2.json.persona_id === r1.json.persona_id) ok("persona_id matches");
else ko(`persona_id drift on idempotent path: first=${r1.json.persona_id} second=${r2.json.persona_id}`);

// ── 3. Source-core warning ─────────────────────────────────────
console.log(`\n[3] Missing source_core triggers warning (not blocking)`);
const r3 = await postDraft({
  prospect_data: { name: "Bob (no-core)", context: "Test minimal context for warning path." },
  external_lead_ref: `${LEAD_REF}:no-core`,
});
if (r3.status !== 200) ko(`expected 200, got ${r3.status}`, r3.json);
else if (Array.isArray(r3.json.warnings) && r3.json.warnings.some((w) => /source_core/.test(w))) {
  ok(`warnings[] present: "${r3.json.warnings[0]}"`);
} else {
  ko(`expected source_core warning in response.warnings`, r3.json?.warnings);
}

// ── Recap ──────────────────────────────────────────────────────
console.log(`\n── Result: ${pass} pass / ${fail} fail ──`);

if (fail === 0 && r1.json) {
  console.log(`\nDraft généré (voix du clone) :`);
  console.log(`---`);
  console.log(r1.json.draft.split("\n").map((l) => `  ${l}`).join("\n"));
  console.log(`---`);
  console.log(`\nDeep link Setclone (ce que Breakcold mettra dans la note) :`);
  console.log(`  ${BASE_URL}/chat/${r1.json.persona_id}/${r1.json.conversation_id}`);
  console.log(`\nProchaine étape : ouvrir ce lien et confirmer que la conv apparaît dans la sidebar 'À envoyer'.`);
}

process.exit(fail > 0 ? 1 : 0);

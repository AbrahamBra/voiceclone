#!/usr/bin/env node
// Smoke test for the V3.6.5 Breakcold integration (PR-1 + PR-2). Hits a
// deployed Setclone over HTTP with x-api-key auth, exactly like n8n does.
//
// Covers :
//   - POST /api/v2/draft  (Workflow 1) — fresh draft, idempotency, warnings
//   - POST /api/v2/feedback (Workflow 3) — rdv_signed outcome, idempotency,
//     404 on unknown lead
//
// Use this BEFORE setting up Breakcold + n8n to confirm the API key works,
// drafts come back in the right voice, idempotency holds on both surfaces,
// and the feedback endpoint can land an outcome on a freshly created conv.
// If this passes, the only thing left to debug end-to-end is the n8n
// templates + Breakcold automation wiring (those don't depend on Setclone).
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

// ── 4. Feedback loop — Workflow 3 (V3.6.5 PR-2) ────────────────
async function postFeedback(body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/v2/feedback`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  let json = null;
  try { json = await res.json(); } catch { /* leave null */ }
  return { status: res.status, json, ms };
}

console.log(`\n[4] Feedback rdv_signed on Phase-1 conv — Workflow 3`);
const fb1 = await postFeedback({
  external_lead_ref: LEAD_REF,
  outcome: "rdv_signed",
  value: 1500,
  note: `smoke run ${RUN_ID}`,
});
if (fb1.status !== 200) {
  ko(`expected 200, got ${fb1.status}`, fb1.json);
} else {
  ok(`status=200 (${fb1.ms}ms), outcome=${fb1.json.outcome}, duplicate=${fb1.json.duplicate}`);
  if (fb1.json.outcome_id) ok(`outcome_id: ${fb1.json.outcome_id}`);
  else ko("outcome_id missing");
  if (fb1.json.conversation_id === r1.json.conversation_id) ok("conversation_id matches Phase 1");
  else ko(`conv id drift: phase1=${r1.json.conversation_id} feedback=${fb1.json.conversation_id}`);
}

// Idempotent re-fire: same conv + outcome must come back as duplicate=true.
console.log(`\n[5] Feedback idempotent re-fire — same outcome`);
const fb2 = await postFeedback({
  external_lead_ref: LEAD_REF,
  outcome: "rdv_signed",
});
if (fb2.status === 200 && fb2.json.duplicate === true) {
  ok(`status=200, duplicate=true (${fb2.ms}ms)`);
} else {
  ko(`expected 200 + duplicate=true, got ${fb2.status} duplicate=${fb2.json?.duplicate}`, fb2.json);
}

// 404 sanity: feedback against an unknown lead must not silently pass.
console.log(`\n[6] Feedback against unknown lead must 404`);
const fb3 = await postFeedback({
  external_lead_ref: `smoke:no-such-lead-${Date.now()}`,
  outcome: "rdv_lost",
});
if (fb3.status === 404) ok(`status=404 as expected`);
else ko(`expected 404, got ${fb3.status}`, fb3.json);

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

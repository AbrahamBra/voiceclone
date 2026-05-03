#!/usr/bin/env node
/**
 * Smoke test for the feedback canal post-PR #224 + #235 + #233.
 *
 * Purpose: prove that every implicit + explicit feedback signal lands BOTH in
 * `corrections` (the legacy intelligence table) AND `feedback_events` (the
 * drainable journal that powers FeedbackRail UI + protocol-v2 helpful_count).
 *
 * Pre-#224, regen_rejection + copy_paste_out wrote only to `corrections` —
 * the canal was asymmetric and the FeedbackRail journal missed half the
 * signal. This script verifies the asymmetry is closed.
 *
 * Usage:
 *   PERSONA_SLUG=nicolas-lavall-e node scripts/smoke-feedback-canal.js
 *   PERSONA_SLUG=<other> ADMIN_CODE=... node scripts/smoke-feedback-canal.js
 *
 * What it does:
 *   1. Create a throwaway test conversation + bot message (marked with a
 *      timestamped marker for easy cleanup).
 *   2. For each signal type (validate, client_validate, excellent,
 *      regen_rejection, copy_paste_out), call the api/feedback handler
 *      directly with messageId + conversationId.
 *   3. Verify both `corrections` AND `feedback_events` got a row.
 *   4. Print a results table + cleanup all test rows by marker.
 *
 * Out-of-scope (explicit):
 *   - Drain pipeline (covered by separate scripts/audit-nicolas-propositions.js)
 *   - "corrected" type (uses /api/feedback-events directly from FeedbackPanel,
 *     not via /api/feedback — already symmetric pre-#224)
 *   - implicit_accept (emitted by api/chat.js follow-up path, not /api/feedback)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const PERSONA_SLUG = process.env.PERSONA_SLUG || "nicolas-lavall-e";
const ADMIN_CODE = process.env.ADMIN_CODE || process.env.SETCLONE_ADMIN_CODE;
if (!ADMIN_CODE) {
  console.error("Missing ADMIN_CODE env var (used to bypass auth in handler call).");
  process.exit(1);
}
process.env.ADMIN_CODE = ADMIN_CODE;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MARKER = `__smoke_canal_${Date.now()}`;
console.log(`\n=== feedback canal smoke test ===`);
console.log(`marker: ${MARKER}`);
console.log(`persona_slug: ${PERSONA_SLUG}\n`);

// ── 1. Resolve persona ──────────────────────────────────────────────────────
const { data: persona, error: pErr } = await sb
  .from("personas")
  .select("id, slug, name, intelligence_source_id")
  .eq("slug", PERSONA_SLUG)
  .single();
if (pErr || !persona) {
  console.error(`persona ${PERSONA_SLUG} not found`, pErr);
  process.exit(1);
}
const personaId = persona.id;
const intellId = persona.intelligence_source_id || persona.id;
console.log(`persona resolved: ${persona.name} (${personaId})`);

// ── 2. Create throwaway conversation + bot message ──────────────────────────
const { data: conv, error: cErr } = await sb
  .from("conversations")
  .insert({
    persona_id: personaId,
    scenario_type: "dm",
    prospect_name: MARKER,
  })
  .select("id")
  .single();
if (cErr || !conv) {
  console.error("failed to create test conversation", cErr);
  process.exit(1);
}
console.log(`test conversation: ${conv.id}`);

const { data: botMsg, error: mErr } = await sb
  .from("messages")
  .insert({
    conversation_id: conv.id,
    role: "assistant",
    content: `${MARKER} — bot draft pour smoke test canal feedback`,
    turn_kind: "clone_draft",
  })
  .select("id")
  .single();
if (mErr || !botMsg) {
  console.error("failed to create test bot message", mErr);
  process.exit(1);
}
console.log(`test bot message: ${botMsg.id}\n`);

// ── 3. Call api/feedback handler directly per signal type ───────────────────
const handler = (await import("../api/feedback.js")).default;

function mkRes() {
  let status = 200, payload = null;
  return {
    res: {
      setHeader() { return this; },
      status(c) { status = c; return this; },
      json(b) { payload = b; return this; },
      end() { return this; },
    },
    get: () => ({ status, payload }),
  };
}

async function callFeedback(body) {
  const { res, get } = mkRes();
  const req = {
    method: "POST",
    body: { ...body, persona: personaId, messageId: botMsg.id, conversationId: conv.id },
    headers: { "x-access-code": ADMIN_CODE },
    query: {},
  };
  await handler(req, res);
  return get();
}

// Focus : the 2 signals fixed by PR #224 (asymmetric pre-#224 — corrections only).
// Pre-#224 : these would land in `corrections` only, leaking from feedback_events.
// Post-#224 : both tables should get a row, with sensible kinds + event_types.
const SIGNALS = [
  { type: "regen_rejection", botMessage: `${MARKER} regen_rejection` },
  { type: "copy_paste_out",  botMessage: `${MARKER} copy_paste_out` },
];

const results = [];
for (const sig of SIGNALS) {
  const t0 = Date.now();
  const r = await callFeedback(sig);
  const ms = Date.now() - t0;
  results.push({ type: sig.type, status: r.status, ok: r.payload?.ok === true, ms });
}

// ── 4. Verify rows landed in BOTH tables ────────────────────────────────────
// Corrections : count by kind for our intelligence source, filtered to bot_message containing MARKER.
const { data: corrRows } = await sb
  .from("corrections")
  .select("kind, source_channel, bot_message")
  .eq("persona_id", intellId)
  .ilike("bot_message", `%${MARKER}%`);

// Feedback events : count by event_type, filtered to our test conversation.
const { data: feRows } = await sb
  .from("feedback_events")
  .select("event_type, message_id")
  .eq("conversation_id", conv.id);

console.log(`\n--- handler responses ---`);
console.table(results);

const corrByKind = {};
for (const r of corrRows || []) {
  const k = r.kind || "(null)";
  corrByKind[k] = (corrByKind[k] || 0) + 1;
}
const feByType = {};
for (const r of feRows || []) {
  feByType[r.event_type] = (feByType[r.event_type] || 0) + 1;
}

console.log(`\n--- DB rows landed ---`);
console.log("corrections (by kind):", corrByKind);
console.log("feedback_events (by event_type):", feByType);

// ── 5. Verdict ──────────────────────────────────────────────────────────────
// Expected mapping post-#224 :
//   validate         -> corrections.kind=validated         + feedback_events.event_type=validated         (NB: feedback_events emitted by front-end calling /api/feedback-events, NOT by /api/feedback. So this script will NOT see it for validate/client_validate/excellent.)
//   client_validate  -> corrections.kind=client_validated  + (same caveat)
//   excellent        -> corrections.kind=excellent         + (same caveat)
//   regen_rejection  -> corrections.kind=regen_rejection   + feedback_events.event_type=regen_rejection (post-#224 fix)
//   copy_paste_out   -> corrections.kind=copy_paste_out    + feedback_events.event_type=copy_paste_out  (post-#224 fix)
//
// So this script ONLY verifies the implicit canal (regen_rejection + copy_paste_out)
// since that's what #224 fixed. The explicit signals (validate/excellent/...) emit
// to feedback_events from the FRONT-END, not /api/feedback — they would need an
// HTTP-level test instead.

const expectedImplicit = ["regen_rejection", "copy_paste_out"];
const missingFE = expectedImplicit.filter((t) => !feByType[t]);
const missingCorr = expectedImplicit.filter((t) => !corrByKind[t]);

console.log(`\n--- canal verdict (post-#224 fix on implicit signals) ---`);
if (missingFE.length === 0 && missingCorr.length === 0) {
  console.log("✓ PASS — both regen_rejection and copy_paste_out landed in BOTH tables");
} else {
  console.log("✗ FAIL");
  if (missingCorr.length) console.log(`  corrections missing kind: ${missingCorr.join(", ")}`);
  if (missingFE.length) console.log(`  feedback_events missing event_type: ${missingFE.join(", ")}`);
}

// ── 6. Cleanup ──────────────────────────────────────────────────────────────
console.log(`\n--- cleanup ---`);
const cleanups = await Promise.all([
  sb.from("feedback_events").delete().eq("conversation_id", conv.id),
  sb.from("corrections").delete().eq("persona_id", intellId).ilike("bot_message", `%${MARKER}%`),
  sb.from("learning_events").delete().eq("persona_id", intellId).contains("payload", { conversation_id: conv.id }),
  sb.from("messages").delete().eq("conversation_id", conv.id),
]);
await sb.from("conversations").delete().eq("id", conv.id);

console.log(`feedback_events deleted: ${cleanups[0].count ?? "n/a"}`);
console.log(`corrections deleted    : ${cleanups[1].count ?? "n/a"}`);
console.log(`learning_events deleted: ${cleanups[2].count ?? "n/a"}`);
console.log(`messages deleted       : ${cleanups[3].count ?? "n/a"}`);
console.log(`conversation deleted   : ${conv.id}`);

console.log(`\n=== done ===`);
process.exit(missingFE.length + missingCorr.length > 0 ? 1 : 0);

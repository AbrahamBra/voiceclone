#!/usr/bin/env node
/**
 * critic-prod-check.js — diagnostic ponctuel.
 *
 * Pourquoi rhythm_shadow n'a aucune row liée à un message prod pour Thomas,
 * alors que pipeline.js:142-147 devrait persister à chaque génération ?
 *
 * Hypothèses testées ici :
 *   1. evaluateAgainstPersona crashe sur du texte réel
 *   2. persistShadow renvoie {error} silencieusement (RLS, schema mismatch)
 *      → non capturé par le .catch(()=>{}) de pipeline.js (resolved promise)
 *   3. tout fonctionne → cause upstream (route bypass, deploy lag)
 *
 * Usage : node scripts/critic-prod-check.js
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";

const PERSONA_ID = "ac1c4ff5-e040-4042-84e8-a7173d9b75b9"; // thomas-abdelhay

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FAIL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env");
  process.exit(1);
}

// Dynamic import AFTER dotenv config so lib/supabase.js sees env vars and its
// internal `supabase` export is non-null (otherwise persistShadow silently
// returns due to its `!supabase` guard, faking a prod-like failure).
const { evaluateAgainstPersona, persistShadow } = await import("../lib/critic/rhythmCritic.js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function log(step, msg) { console.log(`[${step}] ${msg}`); }
function fail(step, msg, err) {
  console.error(`[${step}] FAIL: ${msg}`);
  if (err) {
    console.error(`        message: ${err.message || err}`);
    if (err.code) console.error(`        code: ${err.code}`);
    if (err.details) console.error(`        details: ${err.details}`);
    if (err.hint) console.error(`        hint: ${err.hint}`);
    if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
}

async function main() {
  log("1/4", "Fetching latest assistant message from Thomas prod conversations...");
  const { data: msgs, error: msgsErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, conversations!inner(persona_id)")
    .eq("role", "assistant")
    .eq("conversations.persona_id", PERSONA_ID)
    .order("created_at", { ascending: false })
    .limit(1);

  if (msgsErr) fail("1/4", "fetch messages", msgsErr);
  if (!msgs?.length) fail("1/4", "no assistant messages found for Thomas");

  const msg = msgs[0];
  log("1/4", `OK — msg=${msg.id} conv=${msg.conversation_id} chars=${msg.content.length}`);
  log("1/4", `preview: ${msg.content.slice(0, 120).replace(/\n/g, " ")}...`);

  log("2/4", "Calling evaluateAgainstPersona() on real prod text...");
  let result;
  try {
    result = await evaluateAgainstPersona(msg.content, { personaId: PERSONA_ID, ctx: {} });
  } catch (err) {
    fail("2/4", "evaluateAgainstPersona threw", err);
  }
  if (!result) fail("2/4", "evaluateAgainstPersona returned null");
  log("2/4", `OK — score=${result.score} would_flag=${result.shouldFlag} reasons=${JSON.stringify(result.reasons)}`);
  log("2/4", `baselineUsed=${result.baselineUsed} voiceUsed=${result.voiceUsed}`);

  log("3/4", "Calling persistShadow() — checking BOTH thrown errors AND resolved {error}...");
  let insertResp;
  try {
    insertResp = await persistShadow({
      personaId: PERSONA_ID,
      conversationId: msg.conversation_id,
      messageId: msg.id,
      draft: msg.content,
      result,
    });
  } catch (err) {
    fail("3/4", "persistShadow threw (would be swallowed by .catch in pipeline.js)", err);
  }
  if (insertResp?.error) {
    fail("3/4", "persistShadow returned {error} (silently ignored in prod — pipeline.js doesn't check return)", insertResp.error);
  }
  log("3/4", `OK — insert response status=${insertResp?.status ?? "n/a"}`);

  log("4/4", "Verifying row exists in rhythm_shadow...");
  const { data: check, error: checkErr } = await supabase
    .from("rhythm_shadow")
    .select("id, message_id, conversation_id, score, would_flag, critic_version, created_at")
    .eq("message_id", msg.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (checkErr) fail("4/4", "verify query failed", checkErr);
  if (!check?.length) fail("4/4", "persistShadow returned OK but no row found — silent insert failure");

  log("4/4", `OK — row id=${check[0].id} critic_version=${check[0].critic_version}`);
  console.log(`\nALL CHECKS PASSED. Critic + persistShadow are functional from a script context.`);
  console.log(`\nIf prod still has 0 rows linked to messages, the cause is upstream:`);
  console.log(`  - api/chat.js shortcircuit at line 261-262 bypasses runPipeline`);
  console.log(`  - personaId not actually set in some prod call paths`);
  console.log(`  - deployed prod is on an older commit (check Vercel deploy date vs commit b1c0e63)`);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });

#!/usr/bin/env node
// Backfill learning_events + learning_event_id for feedback_events rows
// inserted before d2993a4 (bridge deploy @ 2026-04-24 16:49 CEST).
//
// Mirrors api/feedback-events.js FB_TO_LEARNING mapping. Idempotent:
// only rows where learning_event_id IS NULL are processed.
//
// Usage:
//   node scripts/backfill-feedback-bridge.js           # dry run
//   node scripts/backfill-feedback-bridge.js --apply   # write
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FB_TO_LEARNING = {
  validated:            { type: "positive_reinforcement", intensity: "low" },
  validated_edited:     { type: "positive_reinforcement", intensity: "edited" },
  excellent:            { type: "positive_reinforcement", intensity: "high" },
  client_validated:     { type: "positive_reinforcement", intensity: "client" },
  corrected:            { type: "correction_saved",       intensity: null },
  saved_rule:           { type: "rule_added",             intensity: null },
  paste_zone_dismissed: { type: "signal_dismissed",       intensity: null },
};

const { data: orphans, error } = await supabase
  .from("feedback_events")
  .select("id, conversation_id, message_id, persona_id, event_type, rules_fired, created_at")
  .is("learning_event_id", null);

if (error) { console.error(error); process.exit(1); }

console.log(`Found ${orphans.length} orphan feedback_events (learning_event_id IS NULL).`);
if (!APPLY) console.log("DRY RUN — pass --apply to write.\n");

let done = 0, skipped = 0, failed = 0;

for (const fe of orphans) {
  const leMap = FB_TO_LEARNING[fe.event_type];
  if (!leMap) {
    skipped++;
    console.log(`  SKIP id=${fe.id} event_type=${fe.event_type} (no mapping)`);
    continue;
  }

  const lePayload = {
    source: "feedback_events",
    fb_event_type: fe.event_type,
    message_id: fe.message_id,
    conversation_id: fe.conversation_id,
    backfilled: true,
  };
  if (leMap.intensity) lePayload.intensity = leMap.intensity;
  if (Array.isArray(fe.rules_fired) && fe.rules_fired.length) lePayload.rules_fired = fe.rules_fired;

  if (!APPLY) {
    console.log(`  WOULD bridge id=${fe.id} event=${fe.event_type} → LE(${leMap.type}, intensity=${leMap.intensity || "-"})`);
    done++;
    continue;
  }

  // Insert learning_event, then update feedback_events.learning_event_id
  const { data: le, error: leErr } = await supabase
    .from("learning_events")
    .insert({
      persona_id: fe.persona_id,
      event_type: leMap.type,
      payload: lePayload,
      created_at: fe.created_at, // preserve chronology
    })
    .select("id").single();

  if (leErr || !le) {
    failed++;
    console.log(`  FAIL id=${fe.id} — learning_events insert: ${leErr?.message}`);
    continue;
  }

  const { error: updErr } = await supabase
    .from("feedback_events")
    .update({ learning_event_id: le.id })
    .eq("id", fe.id);

  if (updErr) {
    failed++;
    console.log(`  FAIL id=${fe.id} — feedback_events update: ${updErr.message}`);
    continue;
  }

  done++;
  console.log(`  OK   id=${fe.id} event=${fe.event_type} → LE id=${le.id}`);
}

console.log(`\n--- ${APPLY ? "APPLIED" : "DRY RUN"} ---`);
console.log(`bridged: ${done}, skipped: ${skipped}, failed: ${failed}`);

#!/usr/bin/env node
// Integration check: reproduces the new insert pattern from api/feedback-events.js
// against real DB. Verifies paired learning_event + back-linked feedback_events.
// Cleans up after itself.

import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FB_TO_LEARNING = {
  validated:            { type: "positive_reinforcement", intensity: "low" },
  excellent:            { type: "positive_reinforcement", intensity: "high" },
  client_validated:     { type: "positive_reinforcement", intensity: "client" },
  corrected:            { type: "correction_saved",       intensity: null },
  saved_rule:           { type: "rule_added",             intensity: null },
  paste_zone_dismissed: { type: "signal_dismissed",       intensity: null },
};

// Pick a recent real (conversation, message, persona) triple
const { data: fbRecent } = await supabase
  .from("feedback_events").select("conversation_id, message_id, persona_id")
  .order("created_at", { ascending: false }).limit(1);
if (!fbRecent?.[0]) { console.error("No feedback_events to piggyback onto"); process.exit(1); }
const { conversation_id, message_id, persona_id } = fbRecent[0];
console.log("Test target:", { conversation_id, message_id, persona_id });

const createdLE = [], createdFE = [];
let failures = 0;

// Exercise every event_type
for (const [event_type, map] of Object.entries(FB_TO_LEARNING)) {
  // 1. Insert learning_event (mimics api handler logic)
  const lePayload = { source: "feedback_events", fb_event_type: event_type, message_id, conversation_id, _test: true };
  if (map.intensity) lePayload.intensity = map.intensity;
  const { data: leData, error: leErr } = await supabase
    .from("learning_events")
    .insert({ persona_id, event_type: map.type, payload: lePayload })
    .select("id").single();
  if (leErr) { console.error(`❌ ${event_type} → LE insert failed:`, leErr.message); failures++; continue; }
  createdLE.push(leData.id);

  // 2. Insert feedback_event with learning_event_id populated
  const { data: feData, error: feErr } = await supabase.from("feedback_events").insert({
    conversation_id, message_id, persona_id,
    event_type,
    correction_text: null, diff_before: null, diff_after: null, rules_fired: [],
    learning_event_id: leData.id,
  }).select("id, learning_event_id").single();
  if (feErr) { console.error(`❌ ${event_type} → FE insert failed:`, feErr.message); failures++; continue; }
  createdFE.push(feData.id);

  if (feData.learning_event_id !== leData.id) {
    console.error(`❌ ${event_type} → back-link mismatch`);
    failures++;
    continue;
  }
  console.log(`✅ ${event_type} → LE(${map.type}) + FE linked OK`);
}

// Cleanup
if (createdFE.length) await supabase.from("feedback_events").delete().in("id", createdFE);
if (createdLE.length) await supabase.from("learning_events").delete().in("id", createdLE);
console.log(`\nCleaned up ${createdFE.length} FE + ${createdLE.length} LE rows`);

if (failures > 0) { console.error(`\n❌ ${failures} failures`); process.exit(1); }
console.log(`\n✅ All ${Object.keys(FB_TO_LEARNING).length} event_types bridge correctly`);

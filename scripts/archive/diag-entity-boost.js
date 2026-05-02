#!/usr/bin/env node
// Diagnostic one-shot: is entity_boost ever written?
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 1) All-time entity_boost rows
const { data: boostAll, error: e1 } = await supabase
  .from("learning_events")
  .select("id, persona_id, created_at, payload")
  .eq("event_type", "entity_boost")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("entity_boost all-time sample:", { count: boostAll?.length ?? 0, err: e1?.message, sample: boostAll });

// 2) Personas where intelligence_source_id != id (shared intellId)
const { data: shared } = await supabase
  .from("personas").select("id, intelligence_source_id")
  .not("intelligence_source_id", "is", null);
const remappedPersonas = shared?.filter(p => p.intelligence_source_id && p.intelligence_source_id !== p.id) || [];
console.log("\nPersonas with intelligence_source_id != id:", remappedPersonas.length);
if (remappedPersonas.length) console.log("  examples:", remappedPersonas.slice(0, 3));

// 3) For active personas on 30d — count entity_boost via BOTH id and intellId
const SINCE = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
const { data: fbPersonas } = await supabase
  .from("feedback_events").select("persona_id").gte("created_at", SINCE);
const activeIds = Array.from(new Set((fbPersonas || []).map(r => r.persona_id)));
console.log("\nActive personas 30d:", activeIds.length);

for (const pid of activeIds) {
  const { data: persona } = await supabase
    .from("personas").select("id, name, intelligence_source_id").eq("id", pid).single();
  const intellId = persona?.intelligence_source_id || persona?.id;

  const { count: boostByPid } = await supabase
    .from("learning_events").select("*", { count: "exact", head: true })
    .eq("event_type", "entity_boost").eq("persona_id", pid).gte("created_at", SINCE);
  const { count: boostByIntell } = await supabase
    .from("learning_events").select("*", { count: "exact", head: true })
    .eq("event_type", "entity_boost").eq("persona_id", intellId).gte("created_at", SINCE);

  const { count: entityCount } = await supabase
    .from("knowledge_entities").select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  console.log(`  ${persona?.name || pid.slice(0,8)}: pid=${pid.slice(0,8)} intellId=${intellId?.slice(0,8)} entities=${entityCount} boost_by_pid=${boostByPid} boost_by_intell=${boostByIntell} shared=${pid !== intellId}`);
}

// 4) Recent client_validated / excellent events from feedback_events — did their entity_boost twin exist?
const { data: positives } = await supabase
  .from("feedback_events")
  .select("id, persona_id, conversation_id, message_id, event_type, created_at")
  .in("event_type", ["client_validated", "excellent", "validated"])
  .gte("created_at", SINCE)
  .order("created_at", { ascending: false });
console.log(`\nPositive feedback events (30d): ${positives?.length || 0}`);

// For each, look for entity_boost learning_events within ±10s
let twinned = 0, orphan = 0;
for (const fe of positives || []) {
  const { data: persona } = await supabase
    .from("personas").select("intelligence_source_id").eq("id", fe.persona_id).single();
  const intellId = persona?.intelligence_source_id || fe.persona_id;
  const t = new Date(fe.created_at).getTime();
  const { data: near } = await supabase
    .from("learning_events")
    .select("id, event_type, created_at, payload")
    .eq("event_type", "entity_boost")
    .in("persona_id", [fe.persona_id, intellId])
    .gte("created_at", new Date(t - 30_000).toISOString())
    .lte("created_at", new Date(t + 30_000).toISOString());
  if (near?.length) twinned++; else orphan++;
}
console.log(`  twinned with entity_boost: ${twinned}, orphan (no entity_boost nearby): ${orphan}`);

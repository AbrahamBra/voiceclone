#!/usr/bin/env node
// Calls the /api/feedback handler directly with type=validate and checks
// whether a fresh entity_boost row lands in learning_events.
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Find a persona with entities so the boost loop has something to match
const { data: persona } = await supabase
  .from("personas").select("id, name, intelligence_source_id")
  .eq("id", "32047cda-77cf-466b-899d-27d151a487a4").single();
const intellId = persona.intelligence_source_id || persona.id;

// Grab one entity name so we can craft a matching bot message
const { data: ents } = await supabase
  .from("knowledge_entities").select("name").eq("persona_id", intellId).limit(1);
const seedName = ents?.[0]?.name || "test";
const botMessage = `Message de diag mentionnant ${seedName} pour déclencher le boost.`;

// Baseline: entity_boost count BEFORE
const before = await supabase
  .from("learning_events").select("*", { count: "exact", head: true })
  .eq("event_type", "entity_boost").eq("persona_id", intellId);

process.env.ADMIN_CODE = process.env.ADMIN_CODE || "diag-bypass-no-real-admin";

const handler = (await import("../api/feedback.js")).default;
const req = {
  method: "POST",
  body: { type: "validate", botMessage, persona: persona.id },
  headers: { "x-access-code": process.env.ADMIN_CODE },
  query: {},
};
let status = 0, payload = null;
const res = {
  setHeader() { return this; },
  status(c) { status = c; return this; },
  json(b) { payload = b; return this; },
  end() { return this; },
};

try {
  await handler(req, res);
} catch (err) {
  console.log("HANDLER THREW:", err.message, err.stack?.split("\n").slice(0, 4).join("\n"));
}

console.log("Handler response:", { status, payload });

// After: count entity_boost again
const after = await supabase
  .from("learning_events").select("*", { count: "exact", head: true })
  .eq("event_type", "entity_boost").eq("persona_id", intellId);

console.log("entity_boost count:", { before: before.count, after: after.count, delta: (after.count || 0) - (before.count || 0) });

// Cleanup: remove the test correction + any new entity_boost row
if (payload?.ok || status >= 200 && status < 300) {
  const { data: latestCorr } = await supabase
    .from("corrections").select("id, correction")
    .eq("persona_id", intellId).eq("correction", "[VALIDATED] Reponse validee par l'utilisateur")
    .order("created_at", { ascending: false }).limit(1);
  if (latestCorr?.[0]) {
    await supabase.from("corrections").delete().eq("id", latestCorr[0].id);
    console.log("cleanup: deleted test correction", latestCorr[0].id);
  }
  const { data: latestLE } = await supabase
    .from("learning_events").select("id")
    .eq("event_type", "entity_boost").eq("persona_id", intellId)
    .order("created_at", { ascending: false }).limit(1);
  if (latestLE?.[0] && (after.count || 0) > (before.count || 0)) {
    await supabase.from("learning_events").delete().eq("id", latestLE[0].id);
    console.log("cleanup: deleted test entity_boost LE", latestLE[0].id);
  }
}

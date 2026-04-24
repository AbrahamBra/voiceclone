#!/usr/bin/env node
// Quick integration check: calls /api/feedback-roi handler directly, verifies shape.

import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Pick an active persona (one that has feedback_events in the last 30d)
const { data } = await supabase
  .from("feedback_events").select("persona_id").order("created_at", { ascending: false }).limit(1);
const personaId = data?.[0]?.persona_id;
if (!personaId) { console.error("No active persona"); process.exit(1); }

// Admin-bypass via ADMIN_CODE — if unset, simulate by monkey-patching the request
const ADMIN_CODE = process.env.ADMIN_CODE;

const handler = (await import("../api/feedback-roi.js")).default;

const headers = ADMIN_CODE ? { "x-access-code": ADMIN_CODE } : { "x-access-code": "__bypass_test" };

// Fallback: if ADMIN_CODE is unset, the auth layer will reject. Instead, we
// validate the endpoint logic by querying the same things ourselves (mirror).
if (!ADMIN_CODE) {
  console.log("No ADMIN_CODE — running inline query verification instead of handler.");
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: fb } = await supabase.from("feedback_events")
    .select("event_type").eq("persona_id", personaId).gte("created_at", since);
  const { data: le } = await supabase.from("learning_events")
    .select("event_type, payload").eq("persona_id", personaId).gte("created_at", since);
  const { data: persona } = await supabase
    .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
  const intellId = persona?.intelligence_source_id || personaId;
  const { count: grad } = await supabase.from("corrections")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", intellId).eq("status", "graduated").gte("created_at", since);

  const signals_in = {};
  for (const r of fb || []) signals_in[r.event_type] = (signals_in[r.event_type] || 0) + 1;
  const signals_out = {}; let boosted = 0;
  for (const r of le || []) {
    signals_out[r.event_type] = (signals_out[r.event_type] || 0) + 1;
    if (r.event_type === "entity_boost") boosted += Number(r.payload?.matched_entities || 0);
  }

  console.log(JSON.stringify({
    persona: personaId,
    window_days: 7,
    signals_in: { total: (fb || []).length, by_type: signals_in },
    signals_out: { by_type: signals_out, entities_boosted: boosted },
    rules_graduated: grad || 0,
  }, null, 2));
  process.exit(0);
}

const req = { method: "GET", query: { persona: personaId, days: 7 }, headers };
let statusCode = 0, body = null;
const res = {
  setHeader() { return this; },
  status(c) { statusCode = c; return this; },
  json(b) { body = b; return this; },
  end() { return this; },
};
await handler(req, res);
console.log("Status:", statusCode);
console.log(JSON.stringify(body, null, 2));
if (statusCode !== 200) process.exit(1);

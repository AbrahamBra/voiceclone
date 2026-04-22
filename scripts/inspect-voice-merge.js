#!/usr/bin/env node
/**
 * List all personas owned by a given client name, show voice stats
 * before/after mergeBaselineVoice is applied. Useful to verify a client's
 * clones benefit from the FR anti-IA baseline floor.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/inspect-voice-merge.js "Brahim"
 */

import { supabase } from "../lib/supabase.js";
import { mergeBaselineVoice } from "../lib/demo-baseline-rules.js";

const clientName = process.argv[2];
if (!clientName) {
  console.error("Usage: node scripts/inspect-voice-merge.js <client_name>");
  process.exit(1);
}
if (!supabase) {
  console.error("Supabase client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// 1. Find the client(s) matching the name (case-insensitive substring match)
const { data: clients, error: cErr } = await supabase
  .from("clients")
  .select("id, name, email")
  .ilike("name", `%${clientName}%`);

if (cErr) {
  console.error("Error querying clients:", cErr.message);
  process.exit(1);
}
if (!clients || clients.length === 0) {
  console.error(`No client found matching "${clientName}".`);
  process.exit(1);
}

console.log(`Found ${clients.length} matching client(s):`);
for (const c of clients) {
  console.log(`  - ${c.name} (${c.email || "no email"}) — id ${c.id}`);
}
console.log("");

const clientIds = clients.map((c) => c.id);

// 2. List personas owned by these clients
const { data: personas, error: pErr } = await supabase
  .from("personas")
  .select("id, slug, name, title, client_id, voice")
  .in("client_id", clientIds)
  .order("name");

if (pErr) {
  console.error("Error querying personas:", pErr.message);
  process.exit(1);
}

if (!personas || personas.length === 0) {
  console.log("No personas found for this client.");
  process.exit(0);
}

console.log(`=== ${personas.length} clone(s) owned by "${clientName}" ===\n`);

function diff(personaArr, mergedArr) {
  const baseline = Array.isArray(personaArr) ? personaArr.length : 0;
  const after = mergedArr.length;
  return { before: baseline, after, delta: after - baseline };
}

let totalNew = 0;
for (const p of personas) {
  const voice = p.voice || {};
  const merged = mergeBaselineVoice(voice);

  const fw = diff(voice.forbiddenWords, merged.forbiddenWords);
  const nd = diff(voice.neverDoes, merged.neverDoes);
  const wr = diff(voice.writingRules, merged.writingRules);

  const hasCustom =
    (Array.isArray(voice.forbiddenWords) && voice.forbiddenWords.length > 0) ||
    (Array.isArray(voice.writingRules) && voice.writingRules.length > 0);

  console.log(`[${p.slug || "—"}] ${p.name} — ${p.title || ""}`);
  console.log(`  forbiddenWords : ${fw.before} → ${fw.after}   (+${fw.delta})`);
  console.log(`  neverDoes      : ${nd.before} → ${nd.after}   (+${nd.delta})`);
  console.log(`  writingRules   : ${wr.before} → ${wr.after}   (+${wr.delta})`);
  console.log(`  baseline impact: ${hasCustom ? "extends existing voice" : "FULL BASELINE (clone avait rien)"}`);
  console.log("");

  totalNew += fw.delta + nd.delta + wr.delta;
}

console.log(`Total rules injected across ${personas.length} clone(s): ${totalNew}`);
console.log("All clones above benefit from the baseline merge (runtime, no DB write).");

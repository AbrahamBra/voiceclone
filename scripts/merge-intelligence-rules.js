#!/usr/bin/env node
/**
 * Merge consolidated writingRules from one client's Thomas persona into
 * admin's Thomas persona (enrichment — union with substring dedup).
 *
 * Usage:
 *   node scripts/merge-intelligence-rules.js              # dry-run, auto-detect Abdelhay
 *   node scripts/merge-intelligence-rules.js --source X   # force source by client name/code
 *   node scripts/merge-intelligence-rules.js --apply      # actually write
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import { config } from "dotenv";
import { existsSync } from "fs";
for (const p of [".env", "../.env", "../../.env", "../../../.env"]) {
  if (existsSync(p)) { config({ path: p }); break; }
}

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_WRITING_RULES = 25;

function getIntelligenceId(p) { return p.intelligence_source_id || p.id; }

// Same dedup heuristic as lib/correction-consolidation.js
function ruleExists(existing, candidate) {
  const c = candidate.toLowerCase();
  return existing.some(r => {
    const rl = r.toLowerCase();
    return rl.includes(c.slice(0, 20)) || c.includes(rl.slice(0, 20));
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false, sourceId: null, targetId: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") out.apply = true;
    else if (args[i] === "--source-id") out.sourceId = args[++i];
    else if (args[i] === "--target-id") out.targetId = args[++i];
  }
  if (!out.sourceId || !out.targetId) {
    console.error("Usage: --source-id <uuid> --target-id <uuid> [--apply]");
    process.exit(1);
  }
  return out;
}

async function main() {
  const args = parseArgs();

  const loadPersona = async id => {
    const { data, error } = await supabase.from("personas").select("*").eq("id", id).single();
    if (error || !data) throw new Error("Load persona " + id + ": " + (error?.message || "not found"));
    return data;
  };
  const loadClient = async id => {
    if (!id) return null;
    const { data } = await supabase.from("clients").select("id, name, access_code").eq("id", id).single();
    return data;
  };

  const sourcePersona = await loadPersona(args.sourceId);
  const targetPersona = await loadPersona(args.targetId);
  const srcClient = await loadClient(sourcePersona.client_id);
  const tgtClient = await loadClient(targetPersona.client_id);

  console.log(`\nSource : client="${srcClient?.name}" persona="${sourcePersona.name}" (slug=${sourcePersona.slug}) id=${sourcePersona.id}`);
  console.log(`Target : client="${tgtClient?.name}" persona="${targetPersona.name}" (slug=${targetPersona.slug}) id=${targetPersona.id}\n`);

  // Resolve intelligence sources (where rules actually live)
  const srcIntellId = getIntelligenceId(sourcePersona);
  const tgtIntellId = getIntelligenceId(targetPersona);

  if (srcIntellId === tgtIntellId) {
    console.log("Source and target already share the same intelligence source — no-op.");
    process.exit(0);
  }

  const srcIntell = srcIntellId !== sourcePersona.id ? await loadPersona(srcIntellId) : sourcePersona;
  const tgtIntell = tgtIntellId !== targetPersona.id ? await loadPersona(tgtIntellId) : targetPersona;

  const srcRules = srcIntell.voice?.writingRules || [];
  const tgtRules = tgtIntell.voice?.writingRules || [];

  console.log(`Source writingRules : ${srcRules.length}`);
  console.log(`Target writingRules : ${tgtRules.length}\n`);

  // 4. Diff
  const newRules = [];
  for (const r of srcRules) {
    if (!ruleExists(tgtRules, r) && !ruleExists(newRules, r)) newRules.push(r);
  }

  if (newRules.length === 0) {
    console.log("No new rules to merge.");
    process.exit(0);
  }

  console.log(`Rules to add (${newRules.length}):`);
  for (const r of newRules) console.log(`  + ${r}`);

  const merged = [...tgtRules, ...newRules];
  let finalRules = merged;
  let evicted = 0;
  if (merged.length > MAX_WRITING_RULES) {
    evicted = merged.length - MAX_WRITING_RULES;
    finalRules = merged.slice(-MAX_WRITING_RULES);
  }

  console.log(`\nTarget writingRules after merge : ${finalRules.length}${evicted ? ` (evicted ${evicted} oldest)` : ""}`);

  if (!args.apply) {
    console.log("\n[DRY-RUN] Re-run with --apply to write.");
    process.exit(0);
  }

  // 5. Write
  const updatedVoice = { ...tgtIntell.voice, writingRules: finalRules };
  const { error: updErr } = await supabase
    .from("personas").update({ voice: updatedVoice }).eq("id", tgtIntell.id);
  if (updErr) throw new Error("Update failed: " + updErr.message);

  console.log("\nApplied. Cache TTL = 5 min; will refresh automatically.");
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });

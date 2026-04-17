#!/usr/bin/env node
/**
 * Link a persona's intelligence to another (shared pool via intelligence_source_id).
 * Also:
 *   - copies scenario_files from source → target (scenarios are per-clone, not inherited)
 *   - migrates target's existing corrections to the shared pool (source persona_id),
 *     tagging them with contributed_by = target's client_id for traceability
 *
 * Usage:
 *   node scripts/link-intelligence-source.js --source-id <uuid> --target-id <uuid> [--apply]
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
  if (out.sourceId === out.targetId) {
    console.error("source-id and target-id must differ");
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

  const source = await loadPersona(args.sourceId);
  const target = await loadPersona(args.targetId);

  console.log(`\nSource (intelligence pool) : ${source.name} [${source.id}]`);
  console.log(`Target (inherits)          : ${target.name} [${target.id}]`);

  // --- Guard: target must have a client_id (for contributed_by tagging)
  if (!target.client_id) {
    throw new Error("Target persona has no client_id — contribution attribution impossible");
  }

  // --- Guard: if already linked, no-op
  if (target.intelligence_source_id === source.id) {
    console.log("\nTarget already linked to source — no-op.");
    process.exit(0);
  }
  if (target.intelligence_source_id) {
    throw new Error(`Target already has intelligence_source_id=${target.intelligence_source_id} — not overwriting`);
  }

  // --- Plan: scenarios to copy
  const { data: srcScenarios } = await supabase
    .from("scenario_files").select("slug, content").eq("persona_id", source.id);
  const { data: tgtScenarios } = await supabase
    .from("scenario_files").select("slug").eq("persona_id", target.id);
  const existingSlugs = new Set((tgtScenarios || []).map(s => s.slug));
  const scenariosToCopy = (srcScenarios || []).filter(s => !existingSlugs.has(s.slug));

  // --- Plan: corrections to migrate
  const { data: targetCorrections } = await supabase
    .from("corrections")
    .select("id, status, contributed_by")
    .eq("persona_id", target.id);
  const correctionsToMigrate = targetCorrections || [];
  const activeCount = correctionsToMigrate.filter(c => c.status === "active").length;
  const graduatedCount = correctionsToMigrate.filter(c => c.status === "graduated").length;
  const archivedCount = correctionsToMigrate.filter(c => c.status === "archived").length;

  console.log(`\nPLAN:`);
  console.log(`  1. Copy scenario_files        : ${scenariosToCopy.length} new slug(s): [${scenariosToCopy.map(s => s.slug).join(", ")}]`);
  if (existingSlugs.size > 0) {
    console.log(`     (skipped, target already has: [${[...existingSlugs].join(", ")}])`);
  }
  console.log(`  2. Migrate corrections         : ${correctionsToMigrate.length} (active=${activeCount}, graduated=${graduatedCount}, archived=${archivedCount})`);
  console.log(`     persona_id ${target.id} → ${source.id}`);
  console.log(`     contributed_by = ${target.client_id} (if null)`);
  console.log(`  3. Set intelligence_source_id  : target.${target.id}.intelligence_source_id = ${source.id}`);

  if (!args.apply) {
    console.log("\n[DRY-RUN] Re-run with --apply to write.");
    process.exit(0);
  }

  // --- Execute
  // 1. Copy scenarios
  if (scenariosToCopy.length > 0) {
    const rows = scenariosToCopy.map(s => ({ persona_id: target.id, slug: s.slug, content: s.content }));
    const { error } = await supabase.from("scenario_files").insert(rows);
    if (error) throw new Error("Scenario copy failed: " + error.message);
    console.log(`✓ Copied ${rows.length} scenario(s)`);
  }

  // 2. Migrate corrections (set contributed_by where null, then move persona_id)
  if (correctionsToMigrate.length > 0) {
    const untaggedIds = correctionsToMigrate.filter(c => !c.contributed_by).map(c => c.id);
    if (untaggedIds.length > 0) {
      const { error } = await supabase
        .from("corrections")
        .update({ contributed_by: target.client_id })
        .in("id", untaggedIds);
      if (error) throw new Error("Contributed_by tagging failed: " + error.message);
      console.log(`✓ Tagged ${untaggedIds.length} correction(s) with contributed_by=${target.client_id}`);
    }
    const allIds = correctionsToMigrate.map(c => c.id);
    const { error } = await supabase
      .from("corrections")
      .update({ persona_id: source.id })
      .in("id", allIds);
    if (error) throw new Error("Correction persona_id migration failed: " + error.message);
    console.log(`✓ Migrated ${allIds.length} correction(s) to source persona`);
  }

  // 3. Set intelligence_source_id
  const { error: linkErr } = await supabase
    .from("personas")
    .update({ intelligence_source_id: source.id })
    .eq("id", target.id);
  if (linkErr) throw new Error("Link failed: " + linkErr.message);
  console.log(`✓ Linked ${target.id}.intelligence_source_id = ${source.id}`);

  console.log("\nDone. Cache TTL 5min; will refresh naturally.");
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });

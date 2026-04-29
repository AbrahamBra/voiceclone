#!/usr/bin/env node
/**
 * V1.4 — Cleanup autres personas (soft-delete is_active=false), garde Nicolas.
 *
 * Soft-delete only — préserve l'historique d'apprentissage (corrections,
 * feedback_events, propositions, knowledge_files). Réversible via
 * UPDATE personas SET is_active=true WHERE slug='...'.
 *
 * Usage :
 *   node scripts/cleanup-personas-keep-nicolas.js --dry-run    # preview
 *   node scripts/cleanup-personas-keep-nicolas.js              # execute
 *
 * Demo personas (slug commençant par "demo-" ou is_demo=true) sont
 * également préservés pour la landing publique.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const KEEP_SLUG = "nicolas-lavall-e";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const dryRun = process.argv.includes("--dry-run");

const { data: personas, error } = await sb.from("personas")
  .select("id, slug, name, is_active, client_id, created_at")
  .eq("is_active", true);
if (error) { console.error("ERROR:", error.message); process.exit(1); }

const keep = personas.filter((p) => p.slug === KEEP_SLUG || (p.slug || "").startsWith("demo-"));
const drop = personas.filter((p) => !keep.includes(p));

console.log("=== V1.4 Cleanup preview ===\n");
console.log("KEEP (is_active stays true):");
for (const p of keep) {
  console.log(`  ${p.slug.padEnd(30)} ${p.name.padEnd(22)}`);
}
console.log("\nSOFT-DELETE (is_active=false):");
for (const p of drop) {
  console.log(`  ${p.slug.padEnd(30)} ${p.name.padEnd(22)} client_id=${p.client_id || "null"} created=${p.created_at?.slice(0, 10)}`);
}

if (dryRun) {
  console.log("\n--dry-run set, no updates performed.");
  process.exit(0);
}

if (drop.length === 0) {
  console.log("\nNothing to drop. Done.");
  process.exit(0);
}

console.log(`\n→ executing UPDATE personas SET is_active=false on ${drop.length} rows ...`);

const ids = drop.map((p) => p.id);
const { data: updated, error: updErr } = await sb.from("personas")
  .update({ is_active: false })
  .in("id", ids)
  .select("id, slug");

if (updErr) { console.error("UPDATE failed:", updErr.message); process.exit(1); }
console.log(`✓ Soft-deleted ${updated?.length || 0} personas.\n`);

const { data: stillActive } = await sb.from("personas")
  .select("slug, name")
  .eq("is_active", true);
console.log("Remaining active personas:");
for (const p of stillActive || []) console.log(`  ${p.slug.padEnd(30)} ${p.name}`);

console.log("\nReversal: UPDATE personas SET is_active=true WHERE slug IN (...)");

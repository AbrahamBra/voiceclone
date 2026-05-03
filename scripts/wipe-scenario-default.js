#!/usr/bin/env node
/**
 * Wipe scenario_files.default content for a given persona.
 *
 * Context : audit 2026-05-03 (G1) — `scenario_files.default` carries the
 * same 12 generic writingRules that voice.writingRules already contains.
 * Even after wiping voice.writingRules, the rules keep arriving in the
 * prompt via Canal B (scenario). This script blanks `default` so Canal B
 * stops emitting generic noise.
 *
 * `qualification` (real metier scenario) is left untouched.
 *
 * Backup written to scripts/_tmp-scenario-default-backup-<persona>-<ts>.json
 * before any mutation. Idempotent.
 *
 * Usage :
 *   node --env-file=.env scripts/wipe-scenario-default.js --persona=<slug>          # dry-run
 *   node --env-file=.env scripts/wipe-scenario-default.js --persona=<slug> --apply  # write
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1];
const APPLY = args.includes("--apply");

if (!personaArg) {
  console.error("--persona=<slug> required");
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: p, error: pErr } = await sb
  .from("personas")
  .select("id, name, slug")
  .eq("slug", personaArg)
  .maybeSingle();

if (pErr || !p) {
  console.error(`Persona '${personaArg}' not found: ${pErr?.message || "no row"}`);
  process.exit(1);
}

const { data: row, error: rErr } = await sb
  .from("scenario_files")
  .select("slug, content")
  .eq("persona_id", p.id)
  .eq("slug", "default")
  .maybeSingle();

if (rErr) {
  console.error(`Query failed: ${rErr.message}`);
  process.exit(1);
}

console.log(`Persona: ${p.name} (${p.slug})`);
if (!row) {
  console.log("No scenario_files row for slug='default'. No-op.");
  process.exit(0);
}

const before = row.content || "";
console.log(`Current default content: ${before.length} chars`);
console.log(`Preview (first 240) :\n${before.slice(0, 240)}\n---`);

if (before.length === 0) {
  console.log("Already empty. No-op.");
  process.exit(0);
}

if (!APPLY) {
  console.log("(dry-run: re-run with --apply to wipe)");
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `scripts/_tmp-scenario-default-backup-${p.slug}-${ts}.json`;
fs.writeFileSync(
  backupPath,
  JSON.stringify({ persona_id: p.id, slug: p.slug, content_before: before }, null, 2),
);
console.log(`✓ Backup: ${backupPath}`);

const { error: upErr } = await sb
  .from("scenario_files")
  .update({ content: "" })
  .eq("persona_id", p.id)
  .eq("slug", "default");

if (upErr) {
  console.error(`✗ Update failed: ${upErr.message}`);
  process.exit(1);
}

console.log("✓ scenario_files.default content wiped (set to '').");

#!/usr/bin/env node
/**
 * Sanitize protocol_section.prose where kind='identity' for a persona.
 *
 * Pulls the current prose, applies pure sanitizer (mojibake, Notion tags,
 * zero-width, blank lines, trailing whitespace), prints diff stats and
 * preview, writes the new prose if --apply.
 *
 * Backup of original prose written to scripts/_tmp-identity-backup-<persona>-<ts>.txt
 * before any mutation.
 *
 * Usage :
 *   node --env-file=.env scripts/sanitize-identity-section.js --persona=<slug>
 *   node --env-file=.env scripts/sanitize-identity-section.js --persona=<slug> --apply
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sanitizeIdentityProse } from "../lib/identity-sanitizer.js";

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1];
const APPLY = args.includes("--apply");

if (!personaArg) {
  console.error("--persona=<slug> required");
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: p } = await sb
  .from("personas")
  .select("id, slug, name")
  .eq("slug", personaArg)
  .maybeSingle();
if (!p) {
  console.error(`Persona '${personaArg}' not found`);
  process.exit(1);
}

const { data: doc } = await sb
  .from("protocol_document")
  .select("id")
  .eq("owner_kind", "persona")
  .eq("owner_id", p.id)
  .is("source_core", null)
  .eq("status", "active")
  .maybeSingle();
if (!doc) {
  console.error(`No active global doc for persona ${p.slug}`);
  process.exit(1);
}

const { data: section } = await sb
  .from("protocol_section")
  .select("id, prose")
  .eq("document_id", doc.id)
  .eq("kind", "identity")
  .maybeSingle();
if (!section) {
  console.error(`No identity section for persona ${p.slug}`);
  process.exit(1);
}

const before = section.prose || "";
const after = sanitizeIdentityProse(before);

console.log(`=== Identity sanitize for ${p.slug} ===`);
console.log(`  chars before : ${before.length}`);
console.log(`  chars after  : ${after.length}`);
console.log(`  delta        : ${after.length - before.length} (${before.length ? Math.round(((after.length - before.length) / before.length) * 100) : 0}%)`);
console.log(`  lines before : ${before.split("\n").length}`);
console.log(`  lines after  : ${after.split("\n").length}`);
console.log(`\n--- preview (first 600 chars after) ---`);
console.log(after.slice(0, 600));
console.log(`---`);

if (!APPLY) {
  console.log("\n(dry-run: re-run with --apply to write)");
  process.exit(0);
}

if (after === before) {
  console.log("\nNothing to change. No-op.");
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `scripts/_tmp-identity-backup-${p.slug}-${ts}.txt`;
fs.writeFileSync(backup, before);
console.log(`✓ Backup: ${backup}`);

const { error } = await sb
  .from("protocol_section")
  .update({ prose: after })
  .eq("id", section.id);
if (error) {
  console.error(`✗ update failed: ${error.message}`);
  process.exit(1);
}
console.log("✓ identity prose updated.");

// Add the `identity` section (kind 7, prose-only) to existing protocol_documents
// that pre-date migration 067. Mirrors the SECTIONS pattern from
// scripts/bootstrap-protocol-doc-existing.js.
//
// Idempotent : skip docs that already have an identity section.
// Dry-run by default ; pass --apply to write.

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });

const apply = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`=== Add identity section (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

const { data: docs } = await sb.from("protocol_document")
  .select("id, owner_id, status, version")
  .eq("owner_kind", "persona")
  .eq("status", "active");

let scaffolded = 0, skipped = 0, failed = 0;

for (const doc of docs || []) {
  const { data: secs } = await sb.from("protocol_section")
    .select("id, kind").eq("document_id", doc.id);
  const hasIdentity = (secs || []).some((s) => s.kind === "identity");
  if (hasIdentity) { skipped++; continue; }

  const { data: persona } = await sb.from("personas").select("slug").eq("id", doc.owner_id).maybeSingle();
  const slug = persona?.slug || doc.owner_id.slice(0, 8);

  if (!apply) {
    console.log(`  📝 ${slug.padEnd(25)} doc=${doc.id.slice(0, 8)} → would add identity`);
    continue;
  }

  const { error: insErr } = await sb.from("protocol_section").insert({
    document_id: doc.id,
    kind: "identity",
    order: 0,  // identity is first per scaffold
    heading: "Identité — voix, parcours, convictions",
    prose: "",
    structured: null,
    author_kind: "auto_extraction",
  });

  if (insErr) {
    console.error(`  ✗ ${slug}: ${insErr.message}`);
    failed++;
    continue;
  }

  console.log(`  ✓ ${slug.padEnd(25)} doc=${doc.id.slice(0, 8)} → identity added`);
  scaffolded++;
}

console.log(`\n=== Synthèse ===`);
console.log(`scaffolded: ${scaffolded}`);
console.log(`skipped   : ${skipped}`);
console.log(`failed    : ${failed}`);
if (!apply) console.log(`\nRe-run with --apply.`);

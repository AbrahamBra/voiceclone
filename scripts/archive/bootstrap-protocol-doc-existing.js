// Bootstrap an empty Protocol-v2 document for ACTIVE personas that don't yet
// have one. Mirrors exactly the scaffold pattern PR #129 added to api/clone.js
// for new clones — 1 active doc v1 + 6 canonical empty sections.
//
// Idempotent : skip personas that already have any protocol_document (any status).
// Dry-run by default; pass --apply to write.
//
// CLI : node --env-file=.env.local scripts/bootstrap-protocol-doc-existing.js [--apply]
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const SECTIONS = [
  { kind: "identity",     order: 0, heading: "Identité — voix, parcours, convictions" },
  { kind: "hard_rules",   order: 1, heading: "Règles absolues" },
  { kind: "errors",       order: 2, heading: "Erreurs à éviter — préférences de formulation" },
  { kind: "process",      order: 3, heading: "Process — étapes opérationnelles" },
  { kind: "icp_patterns", order: 4, heading: "ICP patterns — taxonomie prospects" },
  { kind: "scoring",      order: 5, heading: "Scoring — axes de qualification" },
  { kind: "templates",    order: 6, heading: "Templates — skeletons par scénario" },
];

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`=== Bootstrap protocol_document for active personas (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  const { data: personas, error: pErr } = await supabase
    .from("personas")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name");
  if (pErr) { console.error(pErr); process.exit(1); }

  const { data: existingDocs } = await supabase
    .from("protocol_document")
    .select("owner_id, status, version")
    .eq("owner_kind", "persona");
  const docByPersona = new Map();
  for (const d of existingDocs || []) docByPersona.set(d.owner_id, d);

  let scaffolded = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of personas || []) {
    const existing = docByPersona.get(p.id);
    if (existing) {
      console.log(`⏭️  ${p.name.padEnd(22)} (${p.slug.padEnd(22)}) → already has doc v${existing.version} status=${existing.status}, skip`);
      skipped++;
      continue;
    }

    if (!apply) {
      console.log(`📝 ${p.name.padEnd(22)} (${p.slug.padEnd(22)}) → would create doc + 6 sections`);
      continue;
    }

    // 1. Insert doc.
    const { data: doc, error: docErr } = await supabase
      .from("protocol_document")
      .insert({
        owner_kind: "persona",
        owner_id: p.id,
        version: 1,
        status: "active",
      })
      .select("id")
      .single();
    if (docErr || !doc?.id) {
      console.error(`❌ ${p.name} doc insert: ${docErr?.message || "no id"}`);
      failed++;
      continue;
    }

    // 2. Insert 6 sections.
    const sections = SECTIONS.map((s) => ({
      ...s,
      document_id: doc.id,
      prose: "",
      structured: null,
      author_kind: "auto_extraction",
    }));
    const { error: secErr } = await supabase.from("protocol_section").insert(sections);
    if (secErr) {
      console.error(`❌ ${p.name} sections insert: ${secErr.message}`);
      failed++;
      continue;
    }
    console.log(`✅ ${p.name.padEnd(22)} (${p.slug.padEnd(22)}) → doc ${doc.id.slice(0, 8)} + 6 sections`);
    scaffolded++;
  }

  console.log(`\n=== Synthèse ===`);
  console.log(`scaffolded : ${scaffolded}`);
  console.log(`skipped    : ${skipped}`);
  console.log(`failed     : ${failed}`);
  if (!apply) console.log(`\nRe-run with --apply to execute.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

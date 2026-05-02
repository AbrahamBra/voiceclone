// Backfill : derive {check_kind, check_params} for active hard_check
// artifacts that were created before PR 5 and therefore have empty
// content.check_params. Without this, lib/protocolChecks.js can't fire
// any of them — see audit docs/audits/protocol-underutilization-2026-05-01.md
// §2 (Nicolas had 6 hard_checks, 0 firings on 7 conversations).
//
// Strategy : for each active hard_check artifact whose content lacks
// check_kind, run deriveCheckParams(content.text). Heuristic first, LLM
// fallback. Update content jsonb in place.
//
// Idempotent : skips artifacts that already have a check_kind set.
// Dry-run by default ; pass --apply to write. --persona <slug> to scope.
//
// Usage :
//   node --env-file=.env.local scripts/backfill-artifact-check-params.js --apply
//   node --env-file=.env.local scripts/backfill-artifact-check-params.js --persona nicolas-lavall-e

import "dotenv/config";
import { supabase } from "../lib/supabase.js";
import { deriveCheckParams } from "../lib/protocol-v2-check-derivation.js";

const apply = process.argv.includes("--apply");
const personaArgIdx = process.argv.indexOf("--persona");
const personaSlug = personaArgIdx >= 0 ? process.argv[personaArgIdx + 1] : null;

async function main() {
  console.log(`=== Backfill artifact check_params (${apply ? "APPLY" : "DRY-RUN"})${personaSlug ? ` persona=${personaSlug}` : ""} ===\n`);

  // Optionally scope by persona via the document → section join.
  let docIds = null;
  if (personaSlug) {
    const { data: persona } = await supabase
      .from("personas")
      .select("id")
      .eq("slug", personaSlug)
      .single();
    if (!persona) {
      console.error(`persona not found: ${personaSlug}`);
      process.exit(1);
    }
    const { data: docs } = await supabase
      .from("protocol_document")
      .select("id")
      .eq("owner_kind", "persona")
      .eq("owner_id", persona.id);
    docIds = (docs || []).map((d) => d.id);
    if (docIds.length === 0) {
      console.error(`no protocol_document for ${personaSlug}`);
      process.exit(1);
    }
  }

  // Fetch active hard_check artifacts.
  let q = supabase
    .from("protocol_artifact")
    .select("id, source_section_id, content, kind, is_active")
    .eq("kind", "hard_check")
    .eq("is_active", true);
  const { data: artifacts, error } = await q;
  if (error) {
    console.error(error);
    process.exit(1);
  }

  // Filter by docIds via section→document.
  let filtered = artifacts || [];
  if (docIds) {
    const { data: sections } = await supabase
      .from("protocol_section")
      .select("id, document_id")
      .in("document_id", docIds);
    const sectionIds = new Set((sections || []).map((s) => s.id));
    filtered = filtered.filter((a) => sectionIds.has(a.source_section_id));
  }

  let derived = 0;
  let skippedAlreadySet = 0;
  let skippedNoText = 0;
  let undeducible = 0;
  let updated = 0;
  let failed = 0;

  for (const a of filtered) {
    const c = a.content || {};
    if (c.check_kind && c.check_params && Object.keys(c.check_params).length > 0) {
      skippedAlreadySet++;
      continue;
    }
    const text = (c.text || "").trim();
    if (!text) {
      skippedNoText++;
      continue;
    }

    const out = await deriveCheckParams(text).catch(() => null);
    if (!out) {
      undeducible++;
      console.log(`  ⚠️  undeducible : ${a.id.slice(0, 8)} — "${text.slice(0, 80)}…"`);
      continue;
    }
    derived++;
    console.log(`  ✅ ${out.check_kind} ${JSON.stringify(out.check_params)} ← "${text.slice(0, 60)}…"`);

    if (!apply) continue;

    const newContent = {
      ...c,
      check_kind: out.check_kind,
      check_params: out.check_params,
    };
    const { error: updErr } = await supabase
      .from("protocol_artifact")
      .update({ content: newContent })
      .eq("id", a.id);
    if (updErr) {
      console.error(`  ❌ update failed ${a.id}: ${updErr.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  console.log("\n=== Synthèse ===");
  console.log(`scanned             : ${filtered.length}`);
  console.log(`already had params  : ${skippedAlreadySet}`);
  console.log(`empty text          : ${skippedNoText}`);
  console.log(`derived             : ${derived}`);
  console.log(`undeducible         : ${undeducible}`);
  if (apply) {
    console.log(`updated             : ${updated}`);
    console.log(`failed              : ${failed}`);
  } else {
    console.log("\nRe-run with --apply to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

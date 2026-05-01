// Seed a "registre" hard rule into a persona's active GLOBAL protocol document.
//
// Why : without a register-anchor rule, Sonnet improvises informal-young
// markers ("Yo.", "frère") on bare conversations (no source_core, no
// playbook). Reproducible bug — see Nicolas conv f0647436 (2026-04-30).
//
// Idempotent : skip if an artifact with the same content_hash already exists
// on the persona's GLOBAL doc errors section.
//
// CLI : node --env-file=.env scripts/seed-register-rule.js <persona-slug> [--apply]
//   default = dry-run.

import "dotenv/config";
import { supabase } from "../lib/supabase.js";
import { computeArtifactHash } from "../lib/protocol-v2-db.js";

const slug = process.argv[2];
const apply = process.argv.includes("--apply");

if (!slug || slug.startsWith("--")) {
  console.error("usage: node scripts/seed-register-rule.js <persona-slug> [--apply]");
  process.exit(1);
}

const RULE_TEXT =
  "Registre : tutoiement direct (LinkedIn pro, cohérent avec voix setter). " +
  "JAMAIS de marqueurs familier-jeune : « yo », « frère », « frérot », " +
  "« cousin », « wesh », « ouais », « grave », « zinzin », « stylé ». " +
  "Pas d'opener vide standalone (« salut », « hello », « yo », « hey ») — " +
  "entrer directement dans le sujet ou demander le [Contexte lead] si absent.";

async function main() {
  console.log(`=== seed-register-rule (${apply ? "APPLY" : "DRY-RUN"}) — slug=${slug} ===\n`);

  // 1. Resolve persona
  const { data: persona, error: pErr } = await supabase
    .from("personas").select("id, name, slug")
    .eq("slug", slug).single();
  if (pErr || !persona) { console.error(`persona not found: ${slug}`); process.exit(1); }
  console.log(`persona: ${persona.name} (${persona.id})`);

  // 2. Find active GLOBAL doc (source_core IS NULL)
  const { data: doc, error: dErr } = await supabase
    .from("protocol_document")
    .select("id, version")
    .eq("owner_kind", "persona").eq("owner_id", persona.id)
    .eq("status", "active").is("source_core", null)
    .single();
  if (dErr || !doc) { console.error(`no active GLOBAL doc for ${slug}`); process.exit(1); }
  console.log(`active GLOBAL doc: ${doc.id} v${doc.version}`);

  // 3. Find errors section
  const { data: section, error: sErr } = await supabase
    .from("protocol_section")
    .select("id, kind, prose")
    .eq("document_id", doc.id).eq("kind", "errors")
    .single();
  if (sErr || !section) { console.error(`no errors section on doc ${doc.id}`); process.exit(1); }
  console.log(`errors section: ${section.id}`);

  // 4. Idempotent guard via content_hash
  const hash = computeArtifactHash(RULE_TEXT);
  const { data: existing } = await supabase
    .from("protocol_artifact")
    .select("id, is_active")
    .eq("source_section_id", section.id)
    .eq("content_hash", hash)
    .maybeSingle();

  if (existing) {
    console.log(`✓ artifact already exists (id=${existing.id.slice(0, 8)}, is_active=${existing.is_active}) — skip`);
    if (!existing.is_active && apply) {
      console.log(`  reactivating...`);
      const { error: rErr } = await supabase
        .from("protocol_artifact")
        .update({ is_active: true }).eq("id", existing.id);
      if (rErr) { console.error(`reactivate failed: ${rErr.message}`); process.exit(1); }
      console.log(`  ✅ reactivated`);
    }
    return;
  }

  if (!apply) {
    console.log(`📝 would insert artifact:`);
    console.log(`   kind=soft_check severity=hard`);
    console.log(`   text="${RULE_TEXT}"`);
    console.log(`\nRe-run with --apply to write.`);
    return;
  }

  // 5. Insert
  const { data: art, error: aErr } = await supabase
    .from("protocol_artifact").insert({
      source_section_id: section.id,
      kind: "soft_check",
      severity: "hard",
      is_active: true,
      is_manual_override: true,
      content: { text: RULE_TEXT },
      content_hash: hash,
    }).select("id").single();
  if (aErr || !art) { console.error(`insert failed: ${aErr?.message}`); process.exit(1); }
  console.log(`✅ inserted artifact ${art.id.slice(0, 8)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

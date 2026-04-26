#!/usr/bin/env node
/**
 * Génère le narrative changelog pour TOUTES les personas actives qui ont
 * un protocol_document + au moins une proposition résolue.
 *
 * Usage : node scripts/generate-narrative-all.js [--persona-id <uuid>]
 *
 * Si --persona-id passé, ne fait que celle-là. Sinon, itère sur toutes
 * les personas actives ayant un doc proto-v2 actif.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ override: true });

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { generateNarrative } = await import("../lib/protocol-v2-changelog-narrator.js");

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const argv = process.argv.slice(2);
  const personaIdx = argv.indexOf("--persona-id");
  const filterPersona = personaIdx >= 0 ? argv[personaIdx + 1] : null;

  // 1. Liste des personas actives avec doc actif
  let q = supabase
    .from("protocol_document")
    .select("id, version, owner_id")
    .eq("owner_kind", "persona")
    .eq("status", "active");
  if (filterPersona) q = q.eq("owner_id", filterPersona);

  const { data: docs, error: docsErr } = await q;
  if (docsErr) { console.error("Failed to fetch docs:", docsErr.message); process.exit(1); }

  // Fetch persona info separately
  const ownerIds = (docs || []).map(d => d.owner_id);
  const { data: personas } = await supabase
    .from("personas").select("id, name, slug, is_active").in("id", ownerIds);
  const personaMap = new Map((personas || []).map(p => [p.id, p]));

  const activeDocs = (docs || [])
    .map(d => ({ ...d, persona: personaMap.get(d.owner_id) }))
    .filter(d => d.persona?.is_active !== false);
  console.log(`Found ${activeDocs.length} active proto-v2 doc(s) to evaluate\n`);

  const results = [];

  for (const doc of activeDocs) {
    const personaName = doc.persona?.name || doc.persona?.slug || doc.owner_id.slice(0, 8);

    const { data: props } = await supabase
      .from("proposition")
      .select("id, status, intent, target_kind, proposed_text, rationale, user_note")
      .eq("document_id", doc.id)
      .in("status", ["accepted", "rejected", "revised"]);

    const accepted = (props || []).filter(p => p.status === "accepted");
    const rejected = (props || []).filter(p => p.status === "rejected");
    const revised  = (props || []).filter(p => p.status === "revised");

    if (accepted.length + rejected.length + revised.length === 0) {
      console.log(`⏭️  ${personaName} — 0 propositions résolues, skip\n`);
      results.push({ persona: personaName, status: "skipped_no_props" });
      continue;
    }

    console.log(`▶️  ${personaName} — ${accepted.length} accepted / ${rejected.length} rejected / ${revised.length} revised`);

    try {
      const result = await generateNarrative({
        accepted, rejected, revised,
        personaName,
        fromVersion: doc.version,
        toVersion: doc.version + 1,
      });

      console.log("\n--- NARRATIVE ---\n");
      console.log(result.narrative || "(empty)");
      console.log("\n--- BRIEF ---");
      console.log(result.brief || "(empty)");
      console.log("\n" + "─".repeat(80) + "\n");

      results.push({
        persona: personaName,
        accepted: accepted.length,
        narrative: result.narrative,
        brief: result.brief,
        error: result.error,
      });
    } catch (e) {
      console.error(`❌ ${personaName} — ${e.message}\n`);
      results.push({ persona: personaName, error: e.message });
    }
  }

  console.log("\n========== RECAP ==========\n");
  for (const r of results) {
    if (r.status === "skipped_no_props") console.log(`⏭️  ${r.persona} — pas de propositions`);
    else if (r.error) console.log(`❌ ${r.persona} — ${r.error}`);
    else console.log(`✅ ${r.persona} — narrative ${r.narrative?.length || 0} chars, brief ${r.brief?.length || 0} chars`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

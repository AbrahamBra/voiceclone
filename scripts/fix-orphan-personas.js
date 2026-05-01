// One-shot data fix for personas.client_id orphans.
//
// Strategy (informed by diag-orphan-attachments.js):
//   - 13 inactive orphans with 0 attachments → hard-delete (cleanup retries)
//   - 4 inactive orphans with attached conv/protocol/corrections → rename
//     slug to "<slug>-legacy-<short_id>" (avoid unique (client_id,slug)
//     collision) and patch client_id = admin (preserves history).
//   - 1 active orphan (boni-yai) → UPDATE client_id = admin (no collision).
//
// Idempotent in spirit but most steps are conditional on current state.
//
// Run from main repo root:
//   cd C:/Users/abrah/AhmetA && node .claude/worktrees/flamboyant-poincare-853f25/scripts/fix-orphan-personas.js
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const TABLES_TO_PROBE = [
  "conversations",
  "operating_protocols",
  "persona_shares",
  "persona_api_keys",
  "knowledge_chunks",
  "corrections",
  "feedback_events",
  "business_outcomes",
  "protocol_document",
];

async function countAttachments(personaId) {
  let total = 0;
  for (const t of TABLES_TO_PROBE) {
    const ownerCol = t === "protocol_document" ? "owner_id" : "persona_id";
    const { count } = await supabase
      .from(t).select("id", { count: "exact", head: true }).eq(ownerCol, personaId);
    total += count || 0;
  }
  return total;
}

async function main() {
  if (!supabase) { console.error("env missing"); process.exit(1); }

  const { data: admin } = await supabase
    .from("clients").select("id").eq("access_code", "__admin__").single();
  if (!admin) { console.error("admin client missing"); process.exit(1); }
  console.log(`admin client_id = ${admin.id}\n`);

  const { data: orphans } = await supabase
    .from("personas").select("id, slug, name, is_active")
    .is("client_id", null);
  console.log(`orphans found: ${orphans?.length || 0}\n`);
  if (!orphans?.length) { console.log("nothing to fix"); return; }

  let deleted = 0, renamed = 0, patched = 0, failed = 0;

  for (const p of orphans) {
    const attachments = await countAttachments(p.id);

    if (!p.is_active && attachments === 0) {
      // Safe hard-delete
      const { error } = await supabase.from("personas").delete().eq("id", p.id);
      if (error) { console.log(`  ✗ delete ${p.slug} ${p.id.slice(0, 8)} — ${error.message}`); failed++; continue; }
      console.log(`  🗑  delete  ${p.slug.padEnd(18)} ${p.id.slice(0, 8)} (inactive, 0 attachments)`);
      deleted++;
      continue;
    }

    // Either active or has attachments → keep, ensure no slug collision
    const { data: collision } = await supabase
      .from("personas").select("id").eq("client_id", admin.id).eq("slug", p.slug).maybeSingle();

    let newSlug = p.slug;
    let renameApplied = false;
    if (collision) {
      newSlug = `${p.slug}-legacy-${p.id.slice(0, 8)}`;
      renameApplied = true;
    }

    const update = renameApplied
      ? { client_id: admin.id, slug: newSlug }
      : { client_id: admin.id };
    const { error } = await supabase.from("personas").update(update).eq("id", p.id);
    if (error) { console.log(`  ✗ patch ${p.slug} ${p.id.slice(0, 8)} — ${error.message}`); failed++; continue; }

    if (renameApplied) {
      console.log(`  ✏️  rename  ${p.slug.padEnd(18)} → ${newSlug.padEnd(28)} ${p.id.slice(0, 8)} (active=${p.is_active}, attachments=${attachments})`);
      renamed++;
    } else {
      console.log(`  ✓ patch   ${p.slug.padEnd(18)} ${p.id.slice(0, 8)} (active=${p.is_active}, attachments=${attachments})`);
      patched++;
    }
  }

  console.log(`\nsummary: deleted=${deleted}, renamed=${renamed}, patched=${patched}, failed=${failed}`);

  const { data: still } = await supabase
    .from("personas").select("id").is("client_id", null);
  console.log(`remaining orphans: ${still?.length || 0}`);
  if (still?.length || failed) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });

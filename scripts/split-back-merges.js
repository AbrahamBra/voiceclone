// Revert auto-merges : pour chaque ligne `proposition_merge_history` active
// du persona, recrée une proposition pending avec le snapshot et marque la
// ligne comme reverted.
//
// Usage : node scripts/split-back-merges.js [--apply] [--persona <slug>] [--max-cosine <n>]
//
// --max-cosine X : ne revert QUE les merges dont merge_cosine < X. Utile
// pour rétroactivement appliquer un seuil plus haut (ex: 0.95) en gardant
// les merges au-dessus.
//
// Dry-run par défaut (--apply pour exécuter).

import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_CANDIDATES = [
  process.env.DOTENV_PATH,
  path.join(os.homedir(), "AhmetA", ".env"),
  path.join(os.homedir(), ".env"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", "voiceclone", ".env"),
].filter(Boolean);

let envLoadedFrom = null;
for (const p of ENV_CANDIDATES) {
  if (fs.existsSync(p)) { dotenv.config({ path: p, override: true }); envLoadedFrom = p; break; }
}
if (envLoadedFrom) console.log(`◇ env from ${envLoadedFrom}`);
else { console.error("✗ no .env found"); process.exit(1); }

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("✗ missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");

const apply = process.argv.includes("--apply");
const personaArgIdx = process.argv.indexOf("--persona");
const personaSlug = personaArgIdx >= 0 ? process.argv[personaArgIdx + 1] : "nicolas-lavall-e";
const maxCosineIdx = process.argv.indexOf("--max-cosine");
const maxCosine = maxCosineIdx >= 0 ? Number(process.argv[maxCosineIdx + 1]) : null;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`=== Split-back merges (${apply ? "APPLY" : "DRY-RUN"}) persona=${personaSlug}${maxCosine != null ? ` max_cosine<${maxCosine}` : ""} ===\n`);

const { data: persona, error: pErr } = await sb.from("personas").select("id, name").eq("slug", personaSlug).single();
if (pErr || !persona) { console.error(`persona ${personaSlug} not found`); process.exit(1); }

let q = sb.from("proposition_merge_history")
  .select("*")
  .eq("persona_id", persona.id)
  .is("reverted_at", null);
if (maxCosine != null) q = q.lt("merge_cosine", maxCosine);

const { data: merges, error: mErr } = await q.order("merged_at", { ascending: true });
if (mErr) { console.error("merge_history fetch failed:", mErr.message); process.exit(1); }

console.log(`Active merges to revert : ${merges.length}`);
if (merges.length === 0) { console.log("(nothing to do)"); process.exit(0); }

// Sample preview
console.log(`\nSample (first 3) :`);
for (const m of merges.slice(0, 3)) {
  console.log(`  cos=${m.merge_cosine}  text="${m.merged_proposition_text.slice(0, 90)}..."`);
}

if (!apply) {
  console.log(`\n(dry-run) re-run with --apply to revert.`);
  process.exit(0);
}

// Pre-fetch all keepers in one batch to copy target_kind/document_id/source/intent
const keeperIds = [...new Set(merges.map(m => m.kept_proposition_id))];
const { data: keepers, error: kErr } = await sb.from("proposition")
  .select("id, document_id, source, target_kind, intent, confidence")
  .in("id", keeperIds);
if (kErr) { console.error("keepers fetch failed:", kErr.message); process.exit(1); }
const keeperById = new Map((keepers || []).map(k => [k.id, k]));

let okCount = 0, failCount = 0;
for (const m of merges) {
  const keeper = keeperById.get(m.kept_proposition_id);
  if (!keeper) {
    console.error(`  ✗ keeper ${m.kept_proposition_id.slice(0, 8)} not found, skip`);
    failCount++; continue;
  }

  // 1. INSERT new proposition with snapshot
  const insertRow = {
    document_id: keeper.document_id,
    source: keeper.source || "manual",
    target_kind: keeper.target_kind,
    intent: keeper.intent || "add_rule",
    proposed_text: m.merged_proposition_text,
    count: Math.max(1, m.merged_proposition_count || 1),
    source_refs: m.merged_source_refs || [],
    provenance: m.merged_provenance,
    status: "pending",
    confidence: keeper.confidence ?? 0.5,
    rationale: `split-back from auto-merge into ${keeper.id.slice(0, 8)} (cosine ${m.merge_cosine})`,
  };
  const { data: newProp, error: insErr } = await sb.from("proposition").insert(insertRow).select("id").single();
  if (insErr) {
    console.error(`  ✗ insert failed for merge ${m.id.slice(0, 8)}: ${insErr.message}`);
    failCount++; continue;
  }

  // 2. UPDATE merge_history reverted_at + reverted_to_proposition_id
  const { error: updErr } = await sb.from("proposition_merge_history")
    .update({ reverted_at: new Date().toISOString(), reverted_to_proposition_id: newProp.id })
    .eq("id", m.id);
  if (updErr) {
    console.error(`  ✗ history mark reverted failed for ${m.id.slice(0, 8)}: ${updErr.message}`);
    failCount++; continue;
  }

  okCount++;
  if (okCount % 25 === 0) console.log(`  ${okCount}/${merges.length} reverted`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`reverted : ${okCount}`);
console.log(`failed   : ${failCount}`);

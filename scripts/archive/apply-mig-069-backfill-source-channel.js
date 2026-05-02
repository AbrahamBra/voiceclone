// One-off : applique le BACKFILL de la migration 069 (DEFAULT impossible
// via supabase-js, doit passer par migrations Supabase).
//
// Strategy :
//   1. count corrections WHERE source_channel IS NULL (avant)
//   2. UPDATE corrections SET source_channel = 'explicit_button' WHERE source_channel IS NULL
//   3. count corrections WHERE source_channel = 'explicit_button' (apres)
//   4. count par persona pour mesurer l'impact
//
// Usage : node scripts/apply-mig-069-backfill-source-channel.js [--apply]

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });

const apply = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`=== Mig 069 backfill (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

// 1. État initial
const { count: nullBefore } = await sb.from("corrections")
  .select("*", { count: "exact", head: true })
  .is("source_channel", null);

const { count: total } = await sb.from("corrections")
  .select("*", { count: "exact", head: true });

const { count: explicitBefore } = await sb.from("corrections")
  .select("*", { count: "exact", head: true })
  .eq("source_channel", "explicit_button");

console.log(`État initial :`);
console.log(`  total corrections           : ${total}`);
console.log(`  source_channel IS NULL      : ${nullBefore}  ${nullBefore > 0 ? "← CES ROWS NE SONT PAS DRAINÉES" : ""}`);
console.log(`  source_channel='explicit_button' : ${explicitBefore}`);

// 2. Distribution par source_channel
const { data: distRows } = await sb.from("corrections")
  .select("source_channel")
  .limit(5000);
const dist = { NULL: 0 };
for (const r of distRows || []) {
  const k = r.source_channel || "NULL";
  dist[k] = (dist[k] || 0) + 1;
}
console.log(`\nDistribution actuelle source_channel (échantillon 5000) :`);
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(25)} ${v}`);
}

// 3. État par persona pour les NULL
if (nullBefore > 0) {
  const { data: nullByPersona } = await sb
    .from("corrections")
    .select("persona_id")
    .is("source_channel", null)
    .limit(1000);
  const personaCount = {};
  for (const r of nullByPersona || []) {
    personaCount[r.persona_id] = (personaCount[r.persona_id] || 0) + 1;
  }
  // Get persona names
  const personaIds = Object.keys(personaCount);
  if (personaIds.length > 0) {
    const { data: personas } = await sb
      .from("personas").select("id, slug").in("id", personaIds);
    const slugById = Object.fromEntries((personas || []).map((p) => [p.id, p.slug]));
    console.log(`\nNULL corrections par persona (top 10) :`);
    const ranked = Object.entries(personaCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [pid, count] of ranked) {
      console.log(`  ${(slugById[pid] || pid.slice(0, 8)).padEnd(25)} ${count}`);
    }
  }
}

// 4. Apply le backfill
if (!apply) {
  console.log(`\n(dry-run) UPDATE corrections SET source_channel='explicit_button' WHERE source_channel IS NULL`);
  console.log(`Re-run with --apply pour exécuter.`);
  process.exit(0);
}

if (nullBefore === 0) {
  console.log(`\nRien à faire — 0 NULL.`);
  process.exit(0);
}

console.log(`\nUPDATE en cours...`);
const { error: updErr, count: updated } = await sb
  .from("corrections")
  .update({ source_channel: "explicit_button" }, { count: "exact" })
  .is("source_channel", null);

if (updErr) {
  console.error(`✗ UPDATE failed: ${updErr.message}`);
  process.exit(1);
}

// 5. Vérification
const { count: nullAfter } = await sb.from("corrections")
  .select("*", { count: "exact", head: true })
  .is("source_channel", null);

const { count: explicitAfter } = await sb.from("corrections")
  .select("*", { count: "exact", head: true })
  .eq("source_channel", "explicit_button");

console.log(`✓ UPDATE complete.`);
console.log(`\nÉtat final :`);
console.log(`  source_channel IS NULL              : ${nullAfter}  (était ${nullBefore})`);
console.log(`  source_channel='explicit_button'    : ${explicitAfter}  (était ${explicitBefore})`);
console.log(`  Δ                                   : +${explicitAfter - explicitBefore}`);

if (nullAfter > 0) {
  console.error(`⚠ ${nullAfter} rows restent NULL. Investiguer.`);
  process.exit(2);
}

console.log(`\n✓ Backfill OK. Au prochain run du cron drain, ces ${nullBefore} corrections deviendront éligibles à la proposition pipeline.`);
console.log(`\n⚠ DEFAULT clause (ALTER COLUMN ... SET DEFAULT 'explicit_button') doit être appliquée séparément via migration 069 dans Supabase Studio ou pipeline migrations.`);

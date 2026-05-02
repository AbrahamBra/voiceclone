// Phase 0.2a + 0.2b — Baseline state AVANT upload Nicolas (read-only).
//
// 0.2a : pre-flight chunks.embedding IS NULL (bloque 0.1 si > 0)
// 0.2b : baseline Q1 (dedup numérique) + Q2 (proposition embedding null)
//
// Usage : node scripts/baseline-queries-pre-nicolas.js

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ts = new Date().toISOString();
console.log(`=== BASELINE QUERIES — ${ts} ===\n`);

// ── 0.2a : Pre-flight chunks.embedding IS NULL ──
console.log("[0.2a] Pre-flight chunks orphelins…");
const { count: orphanChunks, error: e0 } = await sb
  .from("chunks")
  .select("*", { count: "exact", head: true })
  .is("embedding", null);

if (e0) {
  console.error("  ✗ query failed:", e0.message);
  process.exit(2);
}
console.log(`  chunks.embedding IS NULL = ${orphanChunks}`);
const safeToUpload = orphanChunks === 0;
console.log(`  → ${safeToUpload ? "✓ SAFE pour upload Nicolas" : "✗ BLOQUE — fixer embedAndStore avant ingestion"}\n`);

// ── 0.2b Q1 : propositions chiffres divergents ──
console.log("[0.2b Q1] Propositions count >= 2 et chiffres dans proposed_text…");
const { data: q1Rows, error: e1 } = await sb
  .from("proposition")
  .select("id, proposed_text, source_refs, count, created_at")
  .gte("count", 2)
  .filter("proposed_text", "match", "[0-9]+")
  .order("count", { ascending: false })
  .limit(50);

if (e1) {
  console.error("  ✗ query failed:", e1.message);
} else {
  console.log(`  ${q1Rows.length} rows retournés (top 50 par count desc)`);
  // Inspection manuelle : extraire les chiffres et flag les divergences
  let suspectCount = 0;
  for (const r of q1Rows) {
    const nums = (r.proposed_text || "").match(/\d+/g) || [];
    if (nums.length === 0) continue;
    // Heuristique : si count > 1 et un seul chiffre dans proposed_text, on ne peut pas savoir sans
    // requêter les events sources. Pour le baseline, on liste les candidats à inspecter.
    if (r.count >= 2 && nums.length >= 1) {
      suspectCount++;
      if (suspectCount <= 10) {
        const text = (r.proposed_text || "").slice(0, 100).replace(/\n/g, " ");
        console.log(`    ${r.id} count=${r.count} nums=[${nums.join(",")}] "${text}"`);
      }
    }
  }
  console.log(`  ${suspectCount} candidats à inspecter manuellement (chiffre + count≥2)`);
  console.log(`  → fréquence relative bug #1 = ${suspectCount}/${q1Rows.length} sur top 50\n`);
}

// ── 0.2b Q2 : propositions embedding null ──
console.log("[0.2b Q2] Propositions embedding IS NULL pendantes…");
const { count: nullEmbedTotal, error: e2 } = await sb
  .from("proposition")
  .select("*", { count: "exact", head: true })
  .is("embedding", null)
  .eq("status", "pending");

if (e2) {
  console.error("  ✗ query failed:", e2.message);
} else {
  console.log(`  proposition.embedding IS NULL & status='pending' = ${nullEmbedTotal}`);

  // Distribution daily over 30j
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: q2Daily, error: e2b } = await sb
    .from("proposition")
    .select("created_at")
    .is("embedding", null)
    .eq("status", "pending")
    .gte("created_at", since);

  if (!e2b && q2Daily) {
    const byDay = {};
    for (const r of q2Daily) {
      const day = r.created_at.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    const days = Object.keys(byDay).sort().reverse().slice(0, 10);
    if (days.length > 0) {
      console.log(`  Distribution 10 derniers jours actifs :`);
      for (const d of days) console.log(`    ${d}  ${byDay[d]}`);
    } else {
      console.log(`  → aucune proposition orpheline sur 30j`);
    }
  }
  console.log("");
}

// ── Volume de référence : total proposition + total chunks (pour normaliser ratios) ──
console.log("[ref] Volumes totaux…");
const [
  { count: totalProps },
  { count: totalChunks },
  { count: totalFeedbackEvents },
  { count: totalArtifacts },
] = await Promise.all([
  sb.from("proposition").select("*", { count: "exact", head: true }),
  sb.from("chunks").select("*", { count: "exact", head: true }),
  sb.from("feedback_events").select("*", { count: "exact", head: true }),
  sb.from("protocol_artifact").select("*", { count: "exact", head: true }).eq("is_active", true),
]);
console.log(`  proposition       : ${totalProps}`);
console.log(`  chunks            : ${totalChunks}`);
console.log(`  feedback_events   : ${totalFeedbackEvents}`);
console.log(`  artifacts active  : ${totalArtifacts}`);

console.log("\n=== BASELINE END ===");
console.log(`Snapshot ${ts} — sauvegarder pour comparaison post-fix`);

if (!safeToUpload) {
  console.error("\n⚠️  BLOQUE l'upload Nicolas tant que chunks.embedding IS NULL > 0");
  process.exit(3);
}

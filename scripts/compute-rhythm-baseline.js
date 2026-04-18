#!/usr/bin/env node
/**
 * compute-rhythm-baseline.js
 *
 * Calcule et upsert le baseline rythme pour une persona à partir de son
 * corpus gold (messages.is_gold = true).
 *
 *   1. Fetch messages gold pour la persona (agrège toutes les personas
 *      matchant le slug/name).
 *   2. Pour chaque message : extractDraft() → computeRhythmMetrics().
 *   3. computeBaseline() → { mean, std } sur BASELINE_DIMS.
 *   4. UPSERT dans rhythm_baselines (une ligne par persona_id).
 *
 * Usage :
 *   node scripts/compute-rhythm-baseline.js thomas
 *   node scripts/compute-rhythm-baseline.js thomas --dry-run
 *
 * Destiné à tourner en cron nightly une fois le corpus gold mature.
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import { extractDraft } from "../lib/critic/extractDraft.js";
import { computeRhythmMetrics } from "../lib/critic/rhythmMetrics.js";
import { computeBaseline, BASELINE_DIMS } from "../lib/critic/mahalanobis.js";

const personaSlug = process.argv[2];
if (!personaSlug) {
  console.error("Usage: node scripts/compute-rhythm-baseline.js <persona-slug> [--dry-run]");
  process.exit(1);
}
const DRY_RUN = process.argv.includes("--dry-run");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: personas, error: pErr } = await supabase
    .from("personas").select("id, name, slug")
    .or(`name.ilike.${personaSlug},slug.ilike.${personaSlug}`);
  if (pErr) throw pErr;
  if (!personas?.length) throw new Error(`Persona "${personaSlug}" introuvable`);

  const personaIds = personas.map(p => p.id);
  console.log(`Personas : ${personas.map(p => p.slug).join(", ")}`);

  const { data: convs } = await supabase
    .from("conversations").select("id").in("persona_id", personaIds);
  const convIds = (convs || []).map(c => c.id);

  const { data: golds, error: gErr } = await supabase
    .from("messages")
    .select("id, content")
    .in("conversation_id", convIds)
    .eq("is_gold", true);
  if (gErr) throw gErr;
  console.log(`Messages gold : ${golds?.length || 0}`);
  if (!golds?.length) throw new Error("Aucun message gold — rien à calculer");

  const vectors = [];
  for (const m of golds) {
    const draft = extractDraft(m.content) || m.content;
    const metrics = computeRhythmMetrics(draft);
    if (metrics.rm_n_sentences < 1) continue;
    vectors.push(metrics);
  }
  console.log(`Vecteurs valides : ${vectors.length}`);

  const baseline = computeBaseline(vectors);
  console.log(`\nBaseline (${baseline.sample_count} samples):`);
  for (const dim of BASELINE_DIMS) {
    console.log(`  ${dim.padEnd(24)} μ=${String(baseline.mean[dim]).padStart(7)}  σ=${baseline.std[dim]}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run : aucune écriture.");
    return;
  }

  // Upsert par persona_id. On écrit pour CHAQUE persona_id matché
  // (pour que les 2 clones 'thomas' et 'thomas-abdelhay' partagent le baseline,
  //  puisque les 25 gold viennent principalement de thomas-abdelhay).
  for (const pid of personaIds) {
    const { error } = await supabase.from("rhythm_baselines").upsert({
      persona_id: pid,
      mean: baseline.mean,
      std: baseline.std,
      sample_count: baseline.sample_count,
      baseline_version: "v1-diagonal",
      updated_at: new Date().toISOString(),
    }, { onConflict: "persona_id" });
    if (error) throw error;
  }
  console.log(`\n✓ Baseline upsert pour ${personaIds.length} persona(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });

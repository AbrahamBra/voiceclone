#!/usr/bin/env node
/**
 * rhythm-sanity.js
 *
 * Sanity check du baseline rythme :
 *   - Les 25 gold ne devraient PAS être flagés (sinon baseline broken)
 *   - Les corrections.bot_message (explicitement rejetés par le user)
 *     DEVRAIENT majoritairement être flagés (sinon critic ne détecte rien)
 *
 * Produit une matrice de confusion approximative à différents seuils z,
 * et la distribution des distances Mahalanobis par classe.
 *
 * C'est un proxy de précision/recall avant d'avoir de vraies pairwise labels.
 * Les anti-gold sont des labels bruités (un message corrigé peut avoir un
 * bon rythme mais un mauvais contenu), mais donne un ordre de grandeur.
 *
 * Usage :
 *   node scripts/rhythm-sanity.js thomas
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import { extractDraft } from "../lib/critic/extractDraft.js";
import { computeRhythmMetrics } from "../lib/critic/rhythmMetrics.js";
import { mahalanobisDistance, BASELINE_DIMS } from "../lib/critic/mahalanobis.js";

const personaSlug = process.argv[2];
if (!personaSlug) {
  console.error("Usage: node scripts/rhythm-sanity.js <persona-slug>");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function dist(value, bins = [0, 1, 2, 3, 4, 5, 999]) {
  const counts = Array(bins.length - 1).fill(0);
  for (const v of value) {
    for (let i = 0; i < bins.length - 1; i++) {
      if (v >= bins[i] && v < bins[i + 1]) { counts[i]++; break; }
    }
  }
  return counts.map((c, i) => `[${bins[i]}-${bins[i+1]}) ${c}`).join("  ");
}

function pct(n, total) { return total ? `${Math.round(100*n/total)}%` : "-"; }

async function scoreTexts(texts, baseline) {
  const results = [];
  for (const t of texts) {
    const cleaned = extractDraft(t) || t;
    if ((cleaned.match(/\S+/g) || []).length < 5) continue; // trop court, pas informatif
    const metrics = computeRhythmMetrics(cleaned);
    if (metrics.rm_n_sentences < 1) continue;
    const m = mahalanobisDistance(metrics, baseline);
    if (!m) continue;
    results.push({ ...m, metrics, text: cleaned.slice(0, 80) });
  }
  return results;
}

async function main() {
  const { data: personas } = await supabase
    .from("personas").select("id").or(`name.ilike.${personaSlug},slug.ilike.${personaSlug}`);
  const pids = (personas || []).map(p => p.id);
  if (!pids.length) throw new Error("persona introuvable");

  const { data: baselineRow } = await supabase
    .from("rhythm_baselines").select("mean, std, sample_count").eq("persona_id", pids[0]).maybeSingle();
  if (!baselineRow) throw new Error("baseline manquant — lance compute-rhythm-baseline d'abord");
  console.log(`Baseline : ${baselineRow.sample_count} samples`);

  const { data: convs } = await supabase.from("conversations").select("id").in("persona_id", pids);
  const convIds = (convs || []).map(c => c.id);

  const [{ data: golds }, { data: corrections }] = await Promise.all([
    supabase.from("messages").select("content").in("conversation_id", convIds).eq("is_gold", true),
    supabase.from("corrections").select("bot_message").in("persona_id", pids),
  ]);

  const goldResults = await scoreTexts((golds || []).map(g => g.content), baselineRow);
  const antiResults = await scoreTexts((corrections || []).map(c => c.bot_message).filter(Boolean), baselineRow);

  console.log(`\n=== IN-SAMPLE (golds, N=${goldResults.length}) — devraient PASSER ===`);
  console.log(`distances z_max : ${dist(goldResults.map(r => r.dominant_z))}`);
  console.log(`moyenne z_max  : ${(goldResults.reduce((a, r) => a + r.dominant_z, 0) / goldResults.length).toFixed(2)}`);

  console.log(`\n=== ANTI-GOLD (corrections, N=${antiResults.length}) — devraient FLAGER ===`);
  console.log(`distances z_max : ${dist(antiResults.map(r => r.dominant_z))}`);
  console.log(`moyenne z_max  : ${antiResults.length ? (antiResults.reduce((a, r) => a + r.dominant_z, 0) / antiResults.length).toFixed(2) : "-"}`);

  console.log(`\n=== MATRICE DE CONFUSION PAR SEUIL ===`);
  console.log(`seuil   | TP (anti flagé) | FN (anti passé) | FP (gold flagé) | TN (gold passé) | precision | recall`);
  for (const thr of [1.5, 2.0, 2.5, 3.0]) {
    const tp = antiResults.filter(r => r.dominant_z >= thr).length;
    const fn = antiResults.length - tp;
    const fp = goldResults.filter(r => r.dominant_z >= thr).length;
    const tn = goldResults.length - fp;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    console.log(`z>=${thr.toFixed(1).padStart(4)} |      ${String(tp).padStart(2)} (${pct(tp, antiResults.length).padStart(4)})  |      ${String(fn).padStart(2)} (${pct(fn, antiResults.length).padStart(4)})  |      ${String(fp).padStart(2)} (${pct(fp, goldResults.length).padStart(4)})  |      ${String(tn).padStart(2)} (${pct(tn, goldResults.length).padStart(4)})  |   ${precision.toFixed(2)}    | ${recall.toFixed(2)}`);
  }

  console.log(`\n=== DIM DOMINANTE (distribution) ===`);
  const dimCount = { gold: {}, anti: {} };
  for (const r of goldResults) dimCount.gold[r.dominant_dim] = (dimCount.gold[r.dominant_dim] || 0) + 1;
  for (const r of antiResults) dimCount.anti[r.dominant_dim] = (dimCount.anti[r.dominant_dim] || 0) + 1;
  for (const dim of BASELINE_DIMS) {
    const g = dimCount.gold[dim] || 0;
    const a = dimCount.anti[dim] || 0;
    if (!g && !a) continue;
    console.log(`  ${dim.padEnd(24)} gold:${String(g).padStart(3)}  anti:${String(a).padStart(3)}`);
  }

  console.log(`\n=== TOP 5 ANTI-GOLD LES MIEUX DÉTECTÉS ===`);
  antiResults.sort((a, b) => b.dominant_z - a.dominant_z).slice(0, 5).forEach(r => {
    console.log(`  z=${r.dominant_z.toString().padStart(5)} dom=${r.dominant_dim.padEnd(20)} | ${r.text}…`);
  });

  console.log(`\n=== TOP 5 GOLDS PROCHES DU FLAG (diagnostiquer faux positifs) ===`);
  goldResults.sort((a, b) => b.dominant_z - a.dominant_z).slice(0, 5).forEach(r => {
    console.log(`  z=${r.dominant_z.toString().padStart(5)} dom=${r.dominant_dim.padEnd(20)} | ${r.text}…`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });

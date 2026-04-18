#!/usr/bin/env node
/**
 * rhythm-synth-eval.js
 *
 * Eval du critic rythme sur des anti-gold synthétiques générés par
 * dégradation rule-based des golds. Labels propres, zéro pollution.
 *
 * Pour chaque gold :
 *   - version originale (label = gold, doit passer)
 *   - 3 versions dégradées (uniformize / flatten_punct / monotone)
 *
 * Chaque paire (gold, dégradé) est aussi loguée dans rhythm_prefs comme
 * context_kind='manual_ab' avec rater='synthetic' pour constituer un
 * premier corpus pairwise exploitable par Bradley-Terry plus tard.
 *
 * Usage :
 *   node scripts/rhythm-synth-eval.js thomas
 *   node scripts/rhythm-synth-eval.js thomas --write-prefs
 *   node scripts/rhythm-synth-eval.js thomas --modes uniformize,monotone
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import { extractDraft } from "../lib/critic/extractDraft.js";
import { computeRhythmMetrics } from "../lib/critic/rhythmMetrics.js";
import { mahalanobisDistance, BASELINE_DIMS } from "../lib/critic/mahalanobis.js";
import { degradeRhythm } from "../lib/critic/degradeRhythm.js";

const personaSlug = process.argv[2];
if (!personaSlug) {
  console.error("Usage: node scripts/rhythm-synth-eval.js <persona-slug> [--write-prefs] [--modes x,y]");
  process.exit(1);
}
const WRITE_PREFS = process.argv.includes("--write-prefs");
const modesArg = process.argv.indexOf("--modes");
const MODES = modesArg >= 0
  ? process.argv[modesArg + 1].split(",")
  : ["uniformize", "flatten_punct", "monotone"];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function pct(n, total) { return total ? `${Math.round(100 * n / total)}%` : "-"; }
function dist(values, bins = [0, 1, 2, 3, 4, 5, 999]) {
  const counts = Array(bins.length - 1).fill(0);
  for (const v of values) for (let i = 0; i < bins.length - 1; i++) if (v >= bins[i] && v < bins[i + 1]) { counts[i]++; break; }
  return counts.map((c, i) => `[${bins[i]}-${bins[i + 1]}) ${c}`).join("  ");
}

function score(text, baseline) {
  const cleaned = extractDraft(text) || text;
  if ((cleaned.match(/\S+/g) || []).length < 5) return null;
  const metrics = computeRhythmMetrics(cleaned);
  if (metrics.rm_n_sentences < 1) return null;
  const m = mahalanobisDistance(metrics, baseline);
  return m ? { ...m, metrics, cleaned } : null;
}

async function main() {
  const { data: personas } = await supabase
    .from("personas").select("id").or(`name.ilike.${personaSlug},slug.ilike.${personaSlug}`);
  const pids = (personas || []).map(p => p.id);
  if (!pids.length) throw new Error("persona introuvable");

  const { data: baseline } = await supabase
    .from("rhythm_baselines").select("mean, std, sample_count").eq("persona_id", pids[0]).maybeSingle();
  if (!baseline) throw new Error("baseline manquant");

  const { data: convs } = await supabase.from("conversations").select("id").in("persona_id", pids);
  const convIds = (convs || []).map(c => c.id);

  const { data: golds } = await supabase.from("messages")
    .select("id, conversation_id, content").in("conversation_id", convIds).eq("is_gold", true);

  // Scorer golds + chaque mode de dégradation.
  const goldScores = [];
  const degradedByMode = Object.fromEntries(MODES.map(m => [m, []]));
  const pairs = [];

  for (const g of golds) {
    const clean = extractDraft(g.content) || g.content;
    const gScore = score(clean, baseline);
    if (!gScore) continue;
    goldScores.push(gScore);

    for (const mode of MODES) {
      const degraded = degradeRhythm(clean, mode);
      if (degraded === clean) continue; // dégradation no-op
      const dScore = score(degraded, baseline);
      if (!dScore) continue;
      degradedByMode[mode].push(dScore);
      pairs.push({
        persona_id: pids[pids.length - 1], // prefer the most-populated persona (thomas-abdelhay)
        conversation_id: g.conversation_id,
        winner_text: clean,
        loser_text: degraded,
        winner_signals: gScore.metrics,
        loser_signals: dScore.metrics,
        context_kind: "manual_ab",
        rater: `synthetic:${mode}`,
        notes: `degraded via ${mode} (auto-generated for critic calibration)`,
      });
    }
  }

  console.log(`\nBaseline : ${baseline.sample_count} samples`);
  console.log(`Golds scorés : ${goldScores.length} / Paires générées : ${pairs.length}\n`);

  console.log(`=== Distribution z_max par classe ===`);
  console.log(`gold (N=${goldScores.length})            : ${dist(goldScores.map(r => r.dominant_z))}  μ=${(goldScores.reduce((a, r) => a + r.dominant_z, 0) / goldScores.length).toFixed(2)}`);
  for (const mode of MODES) {
    const arr = degradedByMode[mode];
    if (!arr.length) continue;
    console.log(`${mode.padEnd(22)} (N=${arr.length}) : ${dist(arr.map(r => r.dominant_z))}  μ=${(arr.reduce((a, r) => a + r.dominant_z, 0) / arr.length).toFixed(2)}`);
  }

  console.log(`\n=== Matrice de confusion (gold vs tous dégradés confondus) ===`);
  const allDegraded = MODES.flatMap(m => degradedByMode[m]);
  console.log(`seuil   | TP (dégradé flag) | FN | FP (gold flag) | TN | precision | recall | F1`);
  for (const thr of [1.5, 1.75, 2.0, 2.25, 2.5, 3.0]) {
    const tp = allDegraded.filter(r => r.dominant_z >= thr).length;
    const fn = allDegraded.length - tp;
    const fp = goldScores.filter(r => r.dominant_z >= thr).length;
    const tn = goldScores.length - fp;
    const p = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const rc = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (p + rc) > 0 ? 2 * p * rc / (p + rc) : 0;
    console.log(`z>=${thr.toFixed(2).padStart(5)} |     ${String(tp).padStart(3)} (${pct(tp, allDegraded.length).padStart(4)})  |  ${String(fn).padStart(3)}  |   ${String(fp).padStart(2)} (${pct(fp, goldScores.length).padStart(4)})   | ${String(tn).padStart(2)} |   ${p.toFixed(2)}    |  ${rc.toFixed(2)}  | ${f1.toFixed(2)}`);
  }

  console.log(`\n=== Recall par mode (à z≥2) ===`);
  for (const mode of MODES) {
    const arr = degradedByMode[mode];
    if (!arr.length) continue;
    const tp = arr.filter(r => r.dominant_z >= 2).length;
    console.log(`  ${mode.padEnd(22)} : ${tp}/${arr.length} (${pct(tp, arr.length)})`);
  }

  console.log(`\n=== Dim dominante par classe ===`);
  const dimCount = { gold: {}, degraded: {} };
  for (const r of goldScores) dimCount.gold[r.dominant_dim] = (dimCount.gold[r.dominant_dim] || 0) + 1;
  for (const r of allDegraded) dimCount.degraded[r.dominant_dim] = (dimCount.degraded[r.dominant_dim] || 0) + 1;
  for (const dim of BASELINE_DIMS) {
    const g = dimCount.gold[dim] || 0;
    const d = dimCount.degraded[dim] || 0;
    if (!g && !d) continue;
    console.log(`  ${dim.padEnd(24)} gold:${String(g).padStart(3)}  dégradé:${String(d).padStart(3)}`);
  }

  if (WRITE_PREFS) {
    // Purge des anciennes paires synthétiques pour cette persona (idempotent).
    await supabase.from("rhythm_prefs")
      .delete().in("persona_id", pids).like("rater", "synthetic:%");
    const { error } = await supabase.from("rhythm_prefs").insert(pairs);
    if (error) throw error;
    console.log(`\n✓ ${pairs.length} paires écrites dans rhythm_prefs (context_kind=manual_ab, rater=synthetic:*)`);
  } else {
    console.log(`\n(--write-prefs absent : aucune écriture en DB)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

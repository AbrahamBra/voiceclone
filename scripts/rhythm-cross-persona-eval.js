#!/usr/bin/env node
/**
 * rhythm-cross-persona-eval.js
 *
 * Eval honnête du baseline rythme : on score les golds Thomas ET un
 * échantillon de messages d'autres personas contre le baseline Thomas.
 *
 * Si le baseline est informatif, les messages d'autres personas (voix
 * différentes, autres contextes de vente) devraient avoir une distance
 * Mahalanobis plus grande que les golds Thomas.
 *
 * Pas de synthèse, pas d'artifacts : données humaines réelles des deux côtés.
 * C'est le test discriminant le plus propre disponible à ce stade.
 *
 * Usage :
 *   node scripts/rhythm-cross-persona-eval.js thomas
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import { extractDraft } from "../lib/critic/extractDraft.js";
import { computeRhythmMetrics } from "../lib/critic/rhythmMetrics.js";
import { mahalanobisDistance, BASELINE_DIMS } from "../lib/critic/mahalanobis.js";

const personaSlug = process.argv[2];
if (!personaSlug) {
  console.error("Usage: node scripts/rhythm-cross-persona-eval.js <target-persona-slug>");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function dist(values, bins = [0, 1, 2, 3, 4, 5, 999]) {
  const counts = Array(bins.length - 1).fill(0);
  for (const v of values) for (let i = 0; i < bins.length - 1; i++) if (v >= bins[i] && v < bins[i + 1]) { counts[i]++; break; }
  return counts.map((c, i) => `[${bins[i]}-${bins[i + 1]}) ${String(c).padStart(2)}`).join("  ");
}
function pct(n, total) { return total ? `${Math.round(100 * n / total)}%` : "-"; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function scoreText(text, baseline) {
  const cleaned = extractDraft(text) || text;
  if ((cleaned.match(/\S+/g) || []).length < 5) return null;
  const metrics = computeRhythmMetrics(cleaned);
  if (metrics.rm_n_sentences < 1) return null;
  const m = mahalanobisDistance(metrics, baseline);
  if (!m) return null;
  return { ...m, cleaned };
}

async function main() {
  // 1. Target persona + baseline
  const { data: targets } = await supabase
    .from("personas").select("id, name, slug")
    .or(`name.ilike.${personaSlug},slug.ilike.${personaSlug}`);
  const targetIds = (targets || []).map(p => p.id);
  if (!targetIds.length) throw new Error("persona cible introuvable");

  const { data: baseline } = await supabase
    .from("rhythm_baselines").select("mean, std, sample_count, baseline_version")
    .eq("persona_id", targetIds[0]).maybeSingle();
  if (!baseline) throw new Error("baseline manquant");

  console.log(`Baseline : ${baseline.sample_count} samples (${baseline.baseline_version})`);
  console.log(`Dims utilisées : ${BASELINE_DIMS.join(", ")}\n`);

  // 2. Thomas gold
  const { data: convs } = await supabase.from("conversations").select("id").in("persona_id", targetIds);
  const targetConvIds = (convs || []).map(c => c.id);
  const { data: golds } = await supabase.from("messages")
    .select("content").in("conversation_id", targetConvIds).eq("is_gold", true);

  // 3. Autres personas : fetch tous les assistant messages des autres personas
  const { data: otherPersonas } = await supabase.from("personas")
    .select("id, name, slug").not("id", "in", `(${targetIds.join(",")})`);
  const otherIds = (otherPersonas || []).map(p => p.id);

  const { data: otherConvs } = await supabase.from("conversations")
    .select("id, persona_id").in("persona_id", otherIds);

  const convToPersona = new Map((otherConvs || []).map(c => [c.id, c.persona_id]));
  const otherConvIds = (otherConvs || []).map(c => c.id);

  const { data: otherMsgs } = otherConvIds.length
    ? await supabase.from("messages")
      .select("conversation_id, content")
      .in("conversation_id", otherConvIds)
      .eq("role", "assistant")
      .limit(500)
    : { data: [] };

  // Regroupe par persona.
  const byPersona = {};
  for (const p of otherPersonas || []) byPersona[p.id] = { name: p.name, slug: p.slug, texts: [] };
  for (const m of otherMsgs || []) {
    const pid = convToPersona.get(m.conversation_id);
    if (byPersona[pid]) byPersona[pid].texts.push(m.content);
  }

  // 4. Score tout.
  const goldScores = [];
  for (const g of golds || []) {
    const s = scoreText(g.content, baseline);
    if (s) goldScores.push(s);
  }

  const otherScores = [];
  const perPersona = {};
  for (const pid of Object.keys(byPersona)) {
    const { name, slug, texts } = byPersona[pid];
    const ss = texts.map(t => scoreText(t, baseline)).filter(Boolean);
    if (!ss.length) continue;
    perPersona[slug] = { name, slug, count: ss.length, z_mean: +mean(ss.map(s => s.dominant_z)).toFixed(2) };
    otherScores.push(...ss);
  }

  console.log(`=== Samples ===`);
  console.log(`  Thomas gold (N=${goldScores.length})`);
  for (const p of Object.values(perPersona).sort((a, b) => b.count - a.count)) {
    console.log(`  ${p.slug.padEnd(24)} N=${String(p.count).padStart(3)}  z̄=${p.z_mean}  (persona "${p.name}")`);
  }
  console.log(`  TOTAL autres (N=${otherScores.length})`);

  console.log(`\n=== Distribution z_max ===`);
  console.log(`thomas_gold   (N=${goldScores.length})  : ${dist(goldScores.map(r => r.dominant_z))}  μ=${mean(goldScores.map(r => r.dominant_z)).toFixed(2)}`);
  console.log(`autres_personas (N=${otherScores.length}) : ${dist(otherScores.map(r => r.dominant_z))}  μ=${mean(otherScores.map(r => r.dominant_z)).toFixed(2)}`);

  console.log(`\n=== Matrice de confusion (gold = in-distribution) ===`);
  console.log(`seuil    | TP (autre flag) | FN | FP (gold flag) | TN | precision | recall | F1`);
  for (const thr of [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]) {
    const tp = otherScores.filter(r => r.dominant_z >= thr).length;
    const fn = otherScores.length - tp;
    const fp = goldScores.filter(r => r.dominant_z >= thr).length;
    const tn = goldScores.length - fp;
    const p = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const rc = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (p + rc) > 0 ? 2 * p * rc / (p + rc) : 0;
    console.log(`z>=${thr.toFixed(2).padStart(5)} |    ${String(tp).padStart(3)} (${pct(tp, otherScores.length).padStart(4)})  | ${String(fn).padStart(3)}  |   ${String(fp).padStart(2)} (${pct(fp, goldScores.length).padStart(4)})   | ${String(tn).padStart(2)} |   ${p.toFixed(2)}    |  ${rc.toFixed(2)}  | ${f1.toFixed(2)}`);
  }

  console.log(`\n=== Dim dominante par classe ===`);
  const dimCount = { gold: {}, other: {} };
  for (const r of goldScores) dimCount.gold[r.dominant_dim] = (dimCount.gold[r.dominant_dim] || 0) + 1;
  for (const r of otherScores) dimCount.other[r.dominant_dim] = (dimCount.other[r.dominant_dim] || 0) + 1;
  for (const dim of BASELINE_DIMS) {
    const g = dimCount.gold[dim] || 0;
    const o = dimCount.other[dim] || 0;
    if (!g && !o) continue;
    console.log(`  ${dim.padEnd(24)} gold:${String(g).padStart(3)} (${pct(g, goldScores.length).padStart(4)})  autres:${String(o).padStart(3)} (${pct(o, otherScores.length).padStart(4)})`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

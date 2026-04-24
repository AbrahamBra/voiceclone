// ============================================================
// CRON — Fidelity scores scheduler
// Runs daily. Responsibilities:
//   Calcule un fidelity_scores pour chaque persona qui a eu du trafic
//   ces 7 derniers jours, sauf si déjà scoré il y a moins de 24h.
//
// Sans ce cron, fidelity_scores ne se remplit que lorsqu'un utilisateur
// clique manuellement "Calculer" dans l'UI — en pratique quasi jamais
// (audit 24 avril : 3 rows totales dans toute la DB). Résultat : impossible
// de suivre la dérive dans le temps ou d'alerter.
//
// Vercel authenticates cron calls via Authorization: Bearer <CRON_SECRET>
// ============================================================

export const maxDuration = 300;

import { supabase } from "../lib/supabase.js";
import { calculateFidelityScore } from "../lib/fidelity.js";

const MAX_PERSONAS_PER_RUN = 20;
const TRAFFIC_WINDOW_DAYS = 7;
const MIN_HOURS_BETWEEN_CALCS = 24;
const MIN_CHUNKS = 3;

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers["authorization"];
  if (!expected || auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!supabase) {
    res.status(500).json({ error: "Supabase not configured" });
    return;
  }

  const startedAt = Date.now();
  const results = [];

  try {
    const trafficCutoff = new Date(Date.now() - TRAFFIC_WINDOW_DAYS * 864e5).toISOString();
    const recentCalcCutoff = new Date(Date.now() - MIN_HOURS_BETWEEN_CALCS * 3600e3).toISOString();

    // 1. Personas avec trafic assistant récent (via conversations qui ont eu
    //    un message dans la fenêtre). On passe par messages→conversations.persona_id
    //    pour éviter les personas fantômes sans trafic.
    const { data: recentMsgs, error: msgErr } = await supabase
      .from("messages")
      .select("conversations!inner(persona_id)")
      .eq("role", "assistant")
      .gte("created_at", trafficCutoff);
    if (msgErr) throw msgErr;

    const activePersonaIds = Array.from(new Set(
      (recentMsgs || []).map(m => m.conversations?.persona_id).filter(Boolean)
    ));

    // 2. Filtre : skip si un calcul < MIN_HOURS_BETWEEN_CALCS existe déjà
    const { data: recentCalcs } = await supabase
      .from("fidelity_scores")
      .select("persona_id, calculated_at")
      .in("persona_id", activePersonaIds.length > 0 ? activePersonaIds : ["__none__"])
      .gte("calculated_at", recentCalcCutoff);
    const recentlyCalculated = new Set((recentCalcs || []).map(r => r.persona_id));

    const candidates = activePersonaIds
      .filter(id => !recentlyCalculated.has(id))
      .slice(0, MAX_PERSONAS_PER_RUN);

    // 3. Calcul séquentiel (coûteux : embeddings). On tolère des échecs
    //    individuels sans casser le run.
    for (const personaId of candidates) {
      const t0 = Date.now();
      try {
        const result = await calculateFidelityScore(personaId);
        if (!result) {
          results.push({ personaId, ok: false, reason: "cannot_calculate", ms: Date.now() - t0 });
          continue;
        }
        results.push({
          personaId,
          ok: true,
          score_global: result.score_global,
          collapse_index: result.collapse_index,
          chunk_count: result.chunk_count,
          low_confidence: result.low_confidence,
          ms: Date.now() - t0,
        });
      } catch (err) {
        results.push({ personaId, ok: false, error: err?.message || String(err), ms: Date.now() - t0 });
        console.error(JSON.stringify({
          event: "cron_fidelity_error", personaId, error: err?.message || String(err),
        }));
      }

      // Safety budget : stop si on approche maxDuration
      const elapsed = Date.now() - startedAt;
      if (elapsed > (maxDuration * 1000) - 30_000) {
        console.log(JSON.stringify({ event: "cron_fidelity_budget_stop", elapsedMs: elapsed }));
        break;
      }
    }

    const summary = {
      ok: true,
      active_personas_7d: activePersonaIds.length,
      recently_calculated: recentlyCalculated.size,
      candidates: candidates.length,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      durationMs: Date.now() - startedAt,
      results,
    };
    console.log(JSON.stringify({ event: "cron_fidelity_summary", ...summary }));
    res.status(200).json(summary);
  } catch (err) {
    console.error(JSON.stringify({ event: "cron_fidelity_fatal", error: err?.message || String(err) }));
    res.status(500).json({ error: err?.message || String(err), durationMs: Date.now() - startedAt });
  }
}

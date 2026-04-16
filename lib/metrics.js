/**
 * Observability metrics aggregation.
 *
 * Collects daily metrics from usage_log, corrections, and knowledge tables.
 * Designed to run as a daily cron or on-demand via API.
 */

import { supabase } from "./supabase.js";

/**
 * Aggregate metrics for a persona for a given date.
 * Upserts into persona_metrics_daily.
 */
export async function aggregateMetrics(personaId, date = null) {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const nextDate = new Date(new Date(targetDate).getTime() + 86400000).toISOString().split("T")[0];

  // Chat metrics from usage_log
  const { data: usage } = await supabase
    .from("usage_log")
    .select("input_tokens, output_tokens")
    .eq("persona_id", personaId)
    .gte("created_at", targetDate)
    .lt("created_at", nextDate);

  const totalMessages = usage?.length || 0;
  const totalInput = usage?.reduce((s, u) => s + (u.input_tokens || 0), 0) || 0;
  const totalOutput = usage?.reduce((s, u) => s + (u.output_tokens || 0), 0) || 0;

  // Corrections metrics
  const { count: correctionsAdded } = await supabase
    .from("corrections")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .gte("created_at", targetDate)
    .lt("created_at", nextDate);

  const { count: correctionsGraduated } = await supabase
    .from("corrections")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("status", "graduated")
    .gte("created_at", targetDate)
    .lt("created_at", nextDate);

  const { count: correctionsArchived } = await supabase
    .from("corrections")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .eq("status", "archived")
    .gte("created_at", targetDate)
    .lt("created_at", nextDate);

  // False positives: corrections demoted (confidence < 0.5) within 7 days of creation
  const sevenDaysAgo = new Date(new Date(targetDate).getTime() - 7 * 86400000).toISOString().split("T")[0];
  const { count: falsePositives } = await supabase
    .from("corrections")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId)
    .lt("confidence", 0.5)
    .gte("created_at", sevenDaysAgo)
    .lt("created_at", nextDate);

  // Knowledge graph counts
  const { count: entitiesCount } = await supabase
    .from("knowledge_entities")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId);

  const { count: relationsCount } = await supabase
    .from("knowledge_relations")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", personaId);

  const metrics = {
    persona_id: personaId,
    date: targetDate,
    total_messages: totalMessages,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    corrections_added: correctionsAdded || 0,
    corrections_graduated: correctionsGraduated || 0,
    corrections_archived: correctionsArchived || 0,
    feedback_false_positives: falsePositives || 0,
    entities_count: entitiesCount || 0,
    relations_count: relationsCount || 0,
  };

  const { error } = await supabase
    .from("persona_metrics_daily")
    .upsert(metrics, { onConflict: "persona_id,date" });

  if (error) {
    console.log(JSON.stringify({ event: "metrics_upsert_error", persona: personaId, date: targetDate, error: error.message }));
    return null;
  }

  console.log(JSON.stringify({ event: "metrics_aggregated", persona: personaId, date: targetDate, messages: totalMessages }));
  return metrics;
}

/**
 * Aggregate metrics for ALL personas (for daily cron).
 */
export async function aggregateAllMetrics(date = null) {
  const { data: personas } = await supabase
    .from("personas").select("id");

  if (!personas?.length) return [];

  const results = [];
  for (const p of personas) {
    try {
      const m = await aggregateMetrics(p.id, date);
      if (m) results.push(m);
    } catch (err) {
      console.log(JSON.stringify({ event: "metrics_persona_error", persona: p.id, error: err.message }));
    }
  }

  return results;
}

/**
 * Get health summary for a persona (last 7 days).
 */
export async function getHealthSummary(personaId) {
  const { data: metrics } = await supabase
    .from("persona_metrics_daily")
    .select("*")
    .eq("persona_id", personaId)
    .order("date", { ascending: false })
    .limit(7);

  if (!metrics?.length) return null;

  const latest = metrics[0];
  const avgMessages = metrics.reduce((s, m) => s + m.total_messages, 0) / metrics.length;
  const avgRewriteRate = metrics.filter(m => m.rewrite_rate).reduce((s, m) => s + m.rewrite_rate, 0) / (metrics.filter(m => m.rewrite_rate).length || 1);
  const totalCorrections = metrics.reduce((s, m) => s + m.corrections_added, 0);
  const totalFP = metrics.reduce((s, m) => s + m.feedback_false_positives, 0);

  return {
    period: "7d",
    avgMessagesPerDay: Math.round(avgMessages),
    avgRewriteRate: Math.round(avgRewriteRate * 100) / 100,
    totalCorrections,
    falsePositiveRate: totalCorrections > 0 ? Math.round((totalFP / totalCorrections) * 100) / 100 : 0,
    entitiesCount: latest.entities_count,
    relationsCount: latest.relations_count,
    lastEvalScore: metrics.find(m => m.eval_score !== null)?.eval_score || null,
    trend: metrics.length >= 2 ? {
      messages: metrics[0].total_messages - metrics[1].total_messages,
      corrections: metrics[0].corrections_added - metrics[1].corrections_added,
    } : null,
  };
}

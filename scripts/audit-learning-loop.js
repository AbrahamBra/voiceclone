#!/usr/bin/env node
// Diagnostic : santé de la boucle d'apprentissage sur 30 jours.
// Répond à : qu'est-ce qui remonte ? qu'est-ce qui est consommé ? quel taux de bridging ?
//
// Usage: node scripts/audit-learning-loop.js
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env

import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SINCE = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

async function countBy(table, column, filter = {}) {
  let q = supabase.from(table).select(column, { count: "exact" }).gte("created_at", SINCE);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const breakdown = (data || []).reduce((a, r) => {
    const k = r[column] ?? "null";
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {});
  return { total: data?.length || 0, breakdown };
}

async function main() {
  // 1. feedback_events
  const feedbackBreakdown = await countBy("feedback_events", "event_type");
  const { count: feedbackWithLearningEvent } = await supabase
    .from("feedback_events").select("*", { count: "exact", head: true })
    .gte("created_at", SINCE).not("learning_event_id", "is", null);
  const { count: feedbackTotal30d } = await supabase
    .from("feedback_events").select("*", { count: "exact", head: true })
    .gte("created_at", SINCE);

  // 2. corrections (par status + detect markers)
  const { data: recentCorrections } = await supabase
    .from("corrections").select("id, correction, status, confidence, created_at")
    .gte("created_at", SINCE);
  const corrBreakdown = { total: recentCorrections?.length || 0, by_status: {}, with_marker: 0, unmarked: 0, markers: {} };
  for (const c of recentCorrections || []) {
    corrBreakdown.by_status[c.status] = (corrBreakdown.by_status[c.status] || 0) + 1;
    const markerMatch = c.correction?.match(/^\[([A-Z_]+)\]/);
    if (markerMatch) {
      corrBreakdown.with_marker++;
      corrBreakdown.markers[markerMatch[1]] = (corrBreakdown.markers[markerMatch[1]] || 0) + 1;
    } else {
      corrBreakdown.unmarked++;
    }
  }

  // 3. learning_events
  const learningBreakdown = await countBy("learning_events", "event_type");

  // 4. corrections graduated (lifecycle)
  const { count: graduatedAll } = await supabase
    .from("corrections").select("*", { count: "exact", head: true }).eq("status", "graduated");
  const { count: graduatedRecent } = await supabase
    .from("corrections").select("*", { count: "exact", head: true })
    .eq("status", "graduated").gte("created_at", SINCE);

  // 5. messages is_gold
  const { count: goldTotal } = await supabase
    .from("messages").select("*", { count: "exact", head: true }).eq("is_gold", true);
  const { count: goldRecent } = await supabase
    .from("messages").select("*", { count: "exact", head: true })
    .eq("is_gold", true).gte("created_at", SINCE);

  // 6. Personas actives (= émis ≥1 feedback OU correction sur 30j)
  const { data: activePersFb } = await supabase
    .from("feedback_events").select("persona_id").gte("created_at", SINCE);
  const { data: activePersCorr } = await supabase
    .from("corrections").select("persona_id").gte("created_at", SINCE);
  const activePersonas = new Set([
    ...(activePersFb || []).map(r => r.persona_id),
    ...(activePersCorr || []).map(r => r.persona_id),
  ]);

  // 7. Total personas (comparaison)
  const { count: totalPersonas } = await supabase
    .from("personas").select("*", { count: "exact", head: true });

  // 8. Dernier feedback_event + dernier learning_event + dernière correction (date)
  const { data: lastFb } = await supabase
    .from("feedback_events").select("created_at, event_type").order("created_at", { ascending: false }).limit(1);
  const { data: lastLE } = await supabase
    .from("learning_events").select("created_at, event_type").order("created_at", { ascending: false }).limit(1);
  const { data: lastCorr } = await supabase
    .from("corrections").select("created_at, status").order("created_at", { ascending: false }).limit(1);

  const bridgingRate = feedbackTotal30d
    ? ((feedbackWithLearningEvent / feedbackTotal30d) * 100).toFixed(1) + "%"
    : "n/a";

  const report = {
    window: { since: SINCE, days: 30 },
    personas: { total: totalPersonas, active_30d: activePersonas.size },
    feedback_events_30d: {
      total: feedbackTotal30d,
      by_type: feedbackBreakdown.breakdown,
      with_learning_event_id: feedbackWithLearningEvent,
      bridging_rate: bridgingRate,
    },
    corrections_30d: corrBreakdown,
    learning_events_30d: {
      total: learningBreakdown.total,
      by_type: learningBreakdown.breakdown,
    },
    graduation: {
      graduated_all_time: graduatedAll,
      graduated_30d: graduatedRecent,
    },
    gold_messages: {
      total: goldTotal,
      last_30d: goldRecent,
    },
    last_events: {
      last_feedback_event: lastFb?.[0] || null,
      last_learning_event: lastLE?.[0] || null,
      last_correction: lastCorr?.[0] || null,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  // Verdict
  console.log("\n--- VERDICT ---");
  const fbTotal = feedbackTotal30d || 0;
  const leTotal = learningBreakdown.total || 0;
  const corrTotal = corrBreakdown.total || 0;
  const gradTotal = graduatedRecent || 0;

  if (fbTotal === 0 && corrTotal === 0) {
    console.log("❌ AUCUN SIGNAL sur 30 jours — la boucle est morte ou personne n'utilise l'app.");
  } else {
    console.log(`Signal émis: ${fbTotal} feedback_events + ${corrTotal} corrections`);
    console.log(`Signal consommé: ${leTotal} learning_events, ${gradTotal} corrections graduées`);
    console.log(`Bridging feedback→learning: ${bridgingRate}`);
    if (parseFloat(bridgingRate) < 10 && fbTotal > 0) {
      console.log("❌ Bridging cassé: <10% des feedback_events sont liés à un learning_event.");
    }
    if (corrBreakdown.with_marker > 0) {
      console.log(`⚠️  ${corrBreakdown.with_marker} corrections avec markers [VALIDATED]/[CLIENT_VALIDATED] — filtrées out de la consolidation par design.`);
    }
    if (gradTotal === 0 && corrTotal > 0) {
      console.log("⚠️  Aucune correction graduée sur 30j malgré des corrections émises — consolidation tourne-t-elle ?");
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

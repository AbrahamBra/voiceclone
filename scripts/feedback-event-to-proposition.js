#!/usr/bin/env node
/**
 * Cron protocole-vivant — drain feedback_events → proposition.
 *
 * Pour chaque event non-drainé :
 *   1. Construit un signal { source_type, source_text, context }
 *   2. Route via lib/protocol-v2-extractor-router.js (LLM léger ou statique)
 *   3. Pour chaque {target_kind, proposal} produit :
 *      a. Embed proposed_text (Voyage 1024 dims via lib/protocol-v2-embeddings)
 *      b. findSimilarProposition(doc actif, kind, embedding, threshold 0.85)
 *      c. Si match → MERGE (append source_ref, count++)
 *         Sinon si confidence ≥ 0.75 OU (insert créerait count ≥ 2) → INSERT
 *         Sinon → silenced (skip insert mais marque l'event drained quand même)
 *   4. Mark feedback_events.drained_at = now()
 *
 * Le bridge vers les `corrections` (signaux implicites copy_paste_out / regen_rejection)
 * est explicitement OUT-OF-SCOPE de cette PR — sera ajouté en Task 2.7.5 dès qu'une
 * colonne d'idempotence sera décidée pour corrections (proposition_drained_at, peut-être).
 *
 * Usage : node scripts/feedback-event-to-proposition.js [--dry-run] [--limit N]
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { log } from "../lib/log.js";
import {
  embedForProposition,
  findSimilarProposition,
  isProtocolEmbeddingAvailable,
  SEMANTIC_DEDUP_THRESHOLD,
} from "../lib/protocol-v2-embeddings.js";
import { routeAndExtract } from "../lib/protocol-v2-extractor-router.js";

const DEFAULT_LOOKBACK_MS = 30 * 60 * 1000; // 30 min
const DEFAULT_LIMIT = 50;
const MIN_CONFIDENCE_INSERT = 0.75;
const MIN_COUNT_INSERT = 2;

const PROPOSITION_INSERT_COLUMNS =
  "id, document_id, source, source_ref, source_refs, count, intent, " +
  "target_kind, target_section_id, proposed_text, rationale, confidence, " +
  "embedding, status, created_at";

/**
 * Build a signal object that the router can consume from a feedback_event row.
 * @param {object} event - Row from feedback_events.
 */
export function eventToSignal(event) {
  if (!event || typeof event !== "object") return null;

  // Source text comes from correction_text first, then diff_after as fallback.
  const source_text =
    (typeof event.correction_text === "string" && event.correction_text.trim()) ||
    (typeof event.diff_after === "string" && event.diff_after.trim()) ||
    "";

  if (!source_text) return null;

  return {
    source_type: event.event_type || "feedback_event",
    source_text,
    context: {
      diff_before: event.diff_before || undefined,
      rules_fired: Array.isArray(event.rules_fired) ? event.rules_fired : undefined,
      conversation_id: event.conversation_id,
      message_id: event.message_id,
      persona_id: event.persona_id,
    },
  };
}

// Source channels accepted from `corrections` for the bridge to proposition.
// Keep in sync with the CHECK constraint widening in migration 040 + future
// channels added by Chunk 2.5 follow-ups.
const ELIGIBLE_CORRECTION_CHANNELS = Object.freeze([
  "copy_paste_out",
  "regen_rejection",
  "edit_diff",
  "chat_correction",
  "client_validated",
  "negative_feedback",
  "direct_instruction",
  "coaching_correction",
  "metacognitive_n3",
  "proactive_n4",
  // explicit_button is the live DB default for rows inserted via api/feedback.js
  // (validate / client_validate / excellent / corrected / save_rule paths).
  // Without this entry, the bridge silently filtered 100% of explicit corrections.
  "explicit_button",
]);

// Strip the [COPY_PASTE_OUT] / [REGEN_REJECTED] / etc. prefix that
// api/feedback.js attaches to the `correction` text for implicit signals.
const PREFIX_TAGS_RE = /^\s*\[(COPY_PASTE_OUT|REGEN_REJECTED|EDIT_DIFF|N3|N4)\]\s*/i;

// Positive validation markers — api/feedback.js insère ces préfixes dans
// `corrections.correction` pour les actions validate / client_validate /
// excellent. Ce ne sont PAS des corrections-à-extraire mais des signaux
// positifs sur le bot_message validé. Le drain doit les distinguer du cas
// "no_candidates" (la session 5 audit a tracé 22 [VALIDATED] de Thomas
// silencieusement classés no_candidates et perdus côté loop).
const POSITIVE_MARKERS_RE = /^\s*\[(VALIDATED|CLIENT_VALIDATED|EXCELLENT)\]/i;

export function isPositiveMarker(text) {
  return typeof text === "string" && POSITIVE_MARKERS_RE.test(text);
}

/**
 * Build a signal object from a `corrections` row. Used by the bridge that
 * lets the cron also consume implicit signals (copy_paste_out, regen_rejection)
 * and explicit corrections that don't go through feedback_events.
 *
 * @param {object} correction - Row from corrections.
 */
export function correctionToSignal(correction) {
  if (!correction || typeof correction !== "object") return null;

  const raw = typeof correction.correction === "string" ? correction.correction : "";
  const stripped = raw.replace(PREFIX_TAGS_RE, "").trim();
  if (!stripped) return null;

  return {
    source_type: correction.source_channel || "chat_correction",
    source_text: stripped,
    context: {
      user_message: correction.user_message || undefined,
      bot_message: correction.bot_message || undefined,
      persona_id: correction.persona_id,
      confidence_weight:
        typeof correction.confidence_weight === "number"
          ? correction.confidence_weight
          : undefined,
      is_implicit: correction.is_implicit === true ? true : undefined,
    },
  };
}

/**
 * Find the active GLOBAL protocol_document for a persona.
 * Returns null if none.
 *
 * V1 routing convention (post-migration 055) : ALL corrections route to the
 * global doc (source_core IS NULL), preserving pre-055 behavior. Routing to
 * source-specific playbooks (source_core != NULL) is deferred to V1.5 — will
 * require resolving conversation_id → source_core → playbook doc before
 * picking a document_id here.
 *
 * Without the source_core IS NULL filter, after seeding source-specific
 * playbooks a persona has multiple active docs and .maybeSingle() throws
 * "multiple rows returned" → returns null silently → propositions stop being
 * created. Fix applied as part of migration 055.
 */
async function getActiveDocumentId(supabase, personaId) {
  if (!personaId) return null;
  const { data, error } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .is("source_core", null)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}

/**
 * Either MERGE the new event into an existing pending proposition, or
 * INSERT a new one (subject to noise filter).
 */
async function persistCandidate({
  supabase,
  documentId,
  eventId,
  candidate,
  embedding,
  similar,
  dryRun,
  source = "feedback_event",
}) {
  const { target_kind, proposal } = candidate;

  // 1. MERGE path — semantic match found.
  if (similar.length > 0) {
    const top = similar[0];
    if (dryRun) {
      return { action: "merge_dry", proposition_id: top.id, count_after: top.count + 1 };
    }
    const newSourceRefs = Array.from(new Set([...(top.source_refs || []), eventId])).filter(
      Boolean,
    );
    const { data, error } = await supabase
      .from("proposition")
      .update({
        source_refs: newSourceRefs,
        count: newSourceRefs.length,
      })
      .eq("id", top.id)
      .select("id, count")
      .maybeSingle();
    if (error) {
      log("protocol_v2_cron_merge_error", { id: top.id, message: error.message });
      return { action: "merge_error", error: error.message };
    }
    return { action: "merged", proposition_id: data?.id, count_after: data?.count };
  }

  // 2. INSERT path — noise filter first.
  // For a brand new (count=1) proposal, require confidence >= 0.75. Otherwise silenced.
  if (proposal.confidence < MIN_CONFIDENCE_INSERT) {
    return { action: "silenced", reason: "confidence_below_threshold" };
  }

  if (dryRun) {
    return { action: "insert_dry", proposed_text: proposal.proposed_text };
  }

  const insertRow = {
    document_id: documentId,
    source,
    source_ref: eventId,
    source_refs: [eventId],
    count: 1,
    intent: proposal.intent,
    target_kind,
    proposed_text: proposal.proposed_text,
    rationale: proposal.rationale || null,
    confidence: proposal.confidence,
    embedding: embedding ?? null,
    status: "pending",
  };

  const { data, error } = await supabase
    .from("proposition")
    .insert(insertRow)
    .select("id, count")
    .single();

  if (error) {
    log("protocol_v2_cron_insert_error", { message: error.message });
    return { action: "insert_error", error: error.message };
  }
  return { action: "inserted", proposition_id: data.id, count_after: data.count };
}

/**
 * Drain undrained feedback_events into propositions.
 *
 * @param {object} args
 * @param {object} args.supabase - Supabase service-role client.
 * @param {object} [args.routerOpts] - Forwarded to routeAndExtract router.
 * @param {object} [args.extractorOpts] - Forwarded to routeAndExtract extractor.
 * @param {object} [args.extractorsMap] - Override map (tests).
 * @param {function} [args.embed=embedForProposition] - Override (tests).
 * @param {function} [args.findSimilar=findSimilarProposition] - Override (tests).
 * @param {function} [args.runRouteAndExtract=routeAndExtract] - Override (tests).
 * @param {number} [args.limit=50]
 * @param {number} [args.lookbackMs=30*60*1000]
 * @param {boolean} [args.dryRun=false]
 * @returns {Promise<{processed:number, merged:number, inserted:number, silenced:number, skipped:number, results:Array}>}
 */
export async function drainEventsToProposition(args) {
  const {
    supabase,
    routerOpts = {},
    extractorOpts = {},
    extractorsMap,
    embed = embedForProposition,
    findSimilar = findSimilarProposition,
    runRouteAndExtract = routeAndExtract,
    limit = DEFAULT_LIMIT,
    lookbackMs = DEFAULT_LOOKBACK_MS,
    dryRun = false,
  } = args;

  if (!supabase) throw new Error("supabase client required");

  const since = new Date(Date.now() - lookbackMs).toISOString();

  const { data: events, error: queryErr } = await supabase
    .from("feedback_events")
    .select("*")
    .is("drained_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (queryErr) {
    log("protocol_v2_cron_query_error", { message: queryErr.message });
    return { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0, results: [] };
  }

  const summary = { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0, results: [] };

  for (const event of events ?? []) {
    summary.processed++;
    const eventResult = { event_id: event.id, outcomes: [] };

    const signal = eventToSignal(event);
    if (!signal) {
      summary.skipped++;
      eventResult.outcomes.push({ action: "skipped", reason: "no_signal_text" });
      summary.results.push(eventResult);
      if (!dryRun) {
        await supabase.from("feedback_events").update({ drained_at: new Date().toISOString() }).eq("id", event.id);
      }
      continue;
    }

    const documentId = await getActiveDocumentId(supabase, event.persona_id);
    if (!documentId) {
      summary.skipped++;
      eventResult.outcomes.push({ action: "skipped", reason: "no_active_document" });
      summary.results.push(eventResult);
      if (!dryRun) {
        await supabase.from("feedback_events").update({ drained_at: new Date().toISOString() }).eq("id", event.id);
      }
      continue;
    }

    let candidates;
    try {
      candidates = await runRouteAndExtract(signal, {
        router: routerOpts,
        extractor: extractorOpts,
        extractors: extractorsMap,
      });
    } catch (err) {
      log("protocol_v2_cron_route_error", { event_id: event.id, message: err.message });
      candidates = [];
    }

    if (!candidates || candidates.length === 0) {
      summary.skipped++;
      eventResult.outcomes.push({ action: "skipped", reason: "no_candidates" });
    } else {
      for (const candidate of candidates) {
        const embedding = await embed(candidate.proposal.proposed_text);
        let similar = [];
        if (Array.isArray(embedding) && embedding.length > 0) {
          similar = await findSimilar(supabase, {
            documentId,
            embedding,
            targetKind: candidate.target_kind,
            threshold: SEMANTIC_DEDUP_THRESHOLD,
            limit: 5,
          });
        }
        const outcome = await persistCandidate({
          supabase,
          documentId,
          eventId: event.id,
          candidate,
          embedding,
          similar,
          dryRun,
        });
        eventResult.outcomes.push(outcome);
        if (outcome.action === "merged" || outcome.action === "merge_dry") summary.merged++;
        else if (outcome.action === "inserted" || outcome.action === "insert_dry") summary.inserted++;
        else if (outcome.action === "silenced") summary.silenced++;
      }
    }

    summary.results.push(eventResult);

    if (!dryRun) {
      await supabase
        .from("feedback_events")
        .update({ drained_at: new Date().toISOString() })
        .eq("id", event.id);
    }
  }

  return summary;
}

/**
 * Drain undrained `corrections` rows into propositions (Task 2.5.11 bridge).
 * Mirrors drainEventsToProposition but reads from `corrections` and writes
 * `proposition_drained_at` for idempotency. Only rows where
 * `source_channel IN ELIGIBLE_CORRECTION_CHANNELS` are picked up.
 *
 * @param {object} args - Same shape as drainEventsToProposition.
 * @returns {Promise<{processed:number, merged:number, inserted:number, silenced:number, skipped:number, results:Array}>}
 */
export async function drainCorrectionsToProposition(args) {
  const {
    supabase,
    routerOpts = {},
    extractorOpts = {},
    extractorsMap,
    embed = embedForProposition,
    findSimilar = findSimilarProposition,
    runRouteAndExtract = routeAndExtract,
    limit = DEFAULT_LIMIT,
    lookbackMs = DEFAULT_LOOKBACK_MS,
    dryRun = false,
  } = args;

  if (!supabase) throw new Error("supabase client required");

  const since = new Date(Date.now() - lookbackMs).toISOString();

  const { data: rows, error: queryErr } = await supabase
    .from("corrections")
    .select("*")
    .is("proposition_drained_at", null)
    .in("source_channel", ELIGIBLE_CORRECTION_CHANNELS)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (queryErr) {
    log("protocol_v2_cron_corrections_query_error", { message: queryErr.message });
    return { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0, results: [] };
  }

  const summary = { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0, results: [] };

  for (const row of rows ?? []) {
    summary.processed++;
    const rowResult = { correction_id: row.id, source_channel: row.source_channel, outcomes: [] };

    // Positive markers ([VALIDATED] / [CLIENT_VALIDATED] / [EXCELLENT]) =
    // signaux positifs, pas des corrections-à-extraire. On les marque drained
    // et on log un skip distinct (`positive_marker` ≠ `no_candidates`) pour
    // que l'audit puisse les compter sans confusion. Référence : Session 5
    // audit reco #8 — sinon ils restent invisibles côté loop.
    if (isPositiveMarker(row.correction)) {
      summary.skipped++;
      rowResult.outcomes.push({ action: "skipped", reason: "positive_marker" });
      summary.results.push(rowResult);
      if (!dryRun) {
        await supabase
          .from("corrections")
          .update({ proposition_drained_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      continue;
    }

    const signal = correctionToSignal(row);
    if (!signal) {
      summary.skipped++;
      rowResult.outcomes.push({ action: "skipped", reason: "no_signal_text" });
      summary.results.push(rowResult);
      if (!dryRun) {
        await supabase
          .from("corrections")
          .update({ proposition_drained_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      continue;
    }

    const documentId = await getActiveDocumentId(supabase, row.persona_id);
    if (!documentId) {
      summary.skipped++;
      rowResult.outcomes.push({ action: "skipped", reason: "no_active_document" });
      summary.results.push(rowResult);
      if (!dryRun) {
        await supabase
          .from("corrections")
          .update({ proposition_drained_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      continue;
    }

    let candidates;
    try {
      candidates = await runRouteAndExtract(signal, {
        router: routerOpts,
        extractor: extractorOpts,
        extractors: extractorsMap,
      });
    } catch (err) {
      log("protocol_v2_cron_corrections_route_error", {
        correction_id: row.id,
        message: err.message,
      });
      candidates = [];
    }

    if (!candidates || candidates.length === 0) {
      summary.skipped++;
      rowResult.outcomes.push({ action: "skipped", reason: "no_candidates" });
    } else {
      for (const candidate of candidates) {
        const embedding = await embed(candidate.proposal.proposed_text);
        let similar = [];
        if (Array.isArray(embedding) && embedding.length > 0) {
          similar = await findSimilar(supabase, {
            documentId,
            embedding,
            targetKind: candidate.target_kind,
            threshold: SEMANTIC_DEDUP_THRESHOLD,
            limit: 5,
          });
        }
        const outcome = await persistCandidate({
          supabase,
          documentId,
          eventId: row.id,
          candidate,
          embedding,
          similar,
          dryRun,
          source: "chat_rewrite", // proposition.source enum value for corrections-sourced rows
        });
        rowResult.outcomes.push(outcome);
        if (outcome.action === "merged" || outcome.action === "merge_dry") summary.merged++;
        else if (outcome.action === "inserted" || outcome.action === "insert_dry") summary.inserted++;
        else if (outcome.action === "silenced") summary.silenced++;
      }
    }

    summary.results.push(rowResult);

    if (!dryRun) {
      await supabase
        .from("corrections")
        .update({ proposition_drained_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  return summary;
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────
async function main() {
  if (!isProtocolEmbeddingAvailable()) {
    console.warn("⚠️  VOYAGE_API_KEY not set — embeddings disabled, dedup will be coarse");
  }

  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;
  const skipCorrections = argv.includes("--no-corrections");

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`🧠 protocole-vivant cron — limit=${limit} dry-run=${dryRun}`);

  const eventsSummary = await drainEventsToProposition({ supabase, limit, dryRun });
  console.log("# events");
  console.log(JSON.stringify(eventsSummary, null, 2));

  if (!skipCorrections) {
    const correctionsSummary = await drainCorrectionsToProposition({ supabase, limit, dryRun });
    console.log("# corrections");
    console.log(JSON.stringify(correctionsSummary, null, 2));
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Re-export thresholds so callers can introspect.
export { MIN_CONFIDENCE_INSERT, MIN_COUNT_INSERT };

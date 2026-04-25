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

/**
 * Find the active protocol_document for a persona.
 * Returns null if none.
 */
async function getActiveDocumentId(supabase, personaId) {
  if (!personaId) return null;
  const { data, error } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
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
    source: "feedback_event",
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

// ─── CLI entrypoint ────────────────────────────────────────────────────────
async function main() {
  if (!isProtocolEmbeddingAvailable()) {
    console.warn("⚠️  VOYAGE_API_KEY not set — embeddings disabled, dedup will be coarse");
  }

  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`🧠 protocole-vivant cron — limit=${limit} dry-run=${dryRun}`);
  const summary = await drainEventsToProposition({ supabase, limit, dryRun });
  console.log(JSON.stringify(summary, null, 2));
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

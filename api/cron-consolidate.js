// ============================================================
// CRON — Consolidation + async graph extraction scheduler
// Runs every 10 minutes. Two responsibilities:
//   1. Consolidate corrections for personas with enough active feedback
//   2. Process knowledge_files with extraction_status='pending'
//      (decoupled from upload endpoint so uploads stay fast & reliable)
//
// Vercel authenticates cron calls via Authorization: Bearer <CRON_SECRET>
// ============================================================

export const maxDuration = 300;

import { supabase } from "../lib/supabase.js";
import { consolidateCorrections } from "../lib/correction-consolidation.js";
import { extractGraphFromFile } from "../lib/graph-extraction-file.js";
import { clearIntelligenceCache } from "../lib/knowledge-db.js";
import { parseOperatingProtocol } from "../lib/protocol-parser.js";

// Minimum active corrections to trigger a consolidation
const MIN_ACTIVE_CORRECTIONS = 3;

// Hard cap: never consolidate more than N personas per run (stay within maxDuration)
const MAX_PERSONAS_PER_RUN = 20;

// Graph extraction budget (within the 300s cron window, after consolidations)
const EXTRACTION_PER_FILE_TIMEOUT_MS = 90_000;      // Haiku call cap
const EXTRACTION_RESERVE_MS = 120_000;              // stop taking new files when <2min left
const EXTRACTION_MAX_ATTEMPTS = 3;                  // give up after N failures
const EXTRACTION_MAX_FILES_PER_RUN = 5;             // safety cap

// Protocol parsing budget (phase 3 — same shape, tighter caps)
const PROTOCOL_PER_FILE_TIMEOUT_MS = 90_000;
const PROTOCOL_RESERVE_MS = 30_000;                 // cheaper than graph; smaller reserve
const PROTOCOL_MAX_ATTEMPTS = 3;
const PROTOCOL_MAX_PER_RUN = 2;

export default async function handler(req, res) {
  // Vercel cron sends a Bearer token matching CRON_SECRET env var
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
    // Find personas with enough active corrections, oldest consolidation first
    const { data: personas, error } = await supabase
      .from("personas")
      .select("id, slug, client_id, intelligence_source_id, last_consolidation_at")
      .order("last_consolidation_at", { ascending: true, nullsFirst: true })
      .limit(100);

    if (error) throw error;
    if (!personas || personas.length === 0) {
      res.status(200).json({ ok: true, scanned: 0, consolidated: 0, durationMs: Date.now() - startedAt });
      return;
    }

    // Dedup by intelligence source (shared personas consolidate once)
    const seenIntelIds = new Set();
    const candidates = [];

    for (const p of personas) {
      const intelId = p.intelligence_source_id || p.id;
      if (seenIntelIds.has(intelId)) continue;
      seenIntelIds.add(intelId);

      // Count active corrections for this intelligence source
      const { count } = await supabase
        .from("corrections")
        .select("id", { count: "exact", head: true })
        .eq("persona_id", intelId)
        .eq("status", "active");

      if ((count || 0) >= MIN_ACTIVE_CORRECTIONS) {
        candidates.push({ personaId: p.id, intelId, activeCount: count });
      }

      if (candidates.length >= MAX_PERSONAS_PER_RUN) break;
    }

    // Consolidate sequentially (no parallel — avoids writingRules races)
    for (const c of candidates) {
      try {
        const result = await consolidateCorrections(c.personaId);
        results.push({ personaId: c.personaId, ok: true, ...result });

        // Stamp last run time
        await supabase.from("personas")
          .update({ last_consolidation_at: new Date().toISOString() })
          .eq("id", c.personaId)
          .then(() => {}, () => {});
      } catch (err) {
        results.push({ personaId: c.personaId, ok: false, error: err.message });
        console.error(JSON.stringify({ event: "cron_consolidate_error", personaId: c.personaId, error: err.message }));
      }
    }

    // ── Phase 2: process pending graph extractions within remaining budget ──
    const extractionResults = await processPendingExtractions(startedAt);

    // ── Phase 3: process pending operating protocols ──
    const protocolResults = await processPendingProtocols(startedAt);

    const summary = {
      ok: true,
      scanned: personas.length,
      candidates: candidates.length,
      consolidated: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      extractions: extractionResults,
      protocols: protocolResults,
      durationMs: Date.now() - startedAt,
      results,
    };
    console.log(JSON.stringify({ event: "cron_consolidate_summary", ...summary }));
    res.status(200).json(summary);
  } catch (err) {
    console.error(JSON.stringify({ event: "cron_consolidate_fatal", error: err.message }));
    res.status(500).json({ error: err.message, durationMs: Date.now() - startedAt });
  }
}

/**
 * Claim-and-process pending knowledge_files extractions.
 *
 * Pattern per file:
 *  1. Atomically flip status pending→processing (only if still pending).
 *     This makes concurrent cron runs safe (Vercel serializes, but defensive).
 *  2. Load file + contributing client (for API key).
 *  3. Run extractGraphFromFile with per-file timeout.
 *  4. On success: status='done'. On failure: retry if attempts < max, else 'failed'.
 */
async function processPendingExtractions(cronStartedAt) {
  const processed = [];
  let attempts = 0;

  // Reset rows stuck in 'processing' for >10 min (worker died mid-extract).
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await supabase
    .from("knowledge_files")
    .update({ extraction_status: "pending" })
    .eq("extraction_status", "processing")
    .lt("extraction_attempted_at", staleCutoff);

  while (processed.length < EXTRACTION_MAX_FILES_PER_RUN) {
    const elapsedMs = Date.now() - cronStartedAt;
    const remainingMs = (maxDuration * 1000) - elapsedMs;
    if (remainingMs < EXTRACTION_RESERVE_MS) {
      console.log(JSON.stringify({ event: "cron_extraction_budget_stop", elapsedMs, remainingMs }));
      break;
    }

    // Pick oldest pending file
    const { data: candidates } = await supabase
      .from("knowledge_files")
      .select("id, persona_id, path, content, contributed_by, extraction_attempts")
      .eq("extraction_status", "pending")
      .lt("extraction_attempts", EXTRACTION_MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(1);

    if (!candidates || candidates.length === 0) break;
    const file = candidates[0];
    attempts++;

    // Atomic claim: only proceed if this row is still 'pending'.
    // If another worker grabbed it, skip silently.
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabase
      .from("knowledge_files")
      .update({
        extraction_status: "processing",
        extraction_attempted_at: nowIso,
        extraction_attempts: (file.extraction_attempts || 0) + 1,
      })
      .eq("id", file.id)
      .eq("extraction_status", "pending")
      .select("id");

    if (claimErr || !claimed || claimed.length === 0) {
      console.log(JSON.stringify({ event: "cron_extraction_claim_skipped", file: file.path, error: claimErr?.message }));
      continue;
    }

    // Load client (for API key) if known
    let client = null;
    if (file.contributed_by) {
      const { data: cRow } = await supabase
        .from("clients").select("id, anthropic_api_key").eq("id", file.contributed_by).single();
      client = cRow || null;
    }

    const fileStart = Date.now();
    try {
      const result = await extractGraphFromFile(
        file.persona_id,
        file.content || "",
        client,
        { timeoutMs: EXTRACTION_PER_FILE_TIMEOUT_MS },
      );

      await supabase.from("knowledge_files")
        .update({
          extraction_status: "done",
          extraction_error: null,
        })
        .eq("id", file.id);

      clearIntelligenceCache(file.persona_id);

      processed.push({
        path: file.path,
        persona: file.persona_id,
        ok: true,
        count: result.count,
        debug: result.debug,
        ms: Date.now() - fileStart,
      });
      console.log(JSON.stringify({ event: "cron_extraction_done", file: file.path, persona: file.persona_id, count: result.count, debug: result.debug, ms: Date.now() - fileStart }));
    } catch (err) {
      const nextAttempts = (file.extraction_attempts || 0) + 1;
      const terminal = nextAttempts >= EXTRACTION_MAX_ATTEMPTS;
      await supabase.from("knowledge_files")
        .update({
          extraction_status: terminal ? "failed" : "pending",
          extraction_error: err.message,
        })
        .eq("id", file.id);

      processed.push({
        path: file.path,
        persona: file.persona_id,
        ok: false,
        error: err.message,
        attempts: nextAttempts,
        terminal,
        ms: Date.now() - fileStart,
      });
      console.error(JSON.stringify({ event: "cron_extraction_error", file: file.path, persona: file.persona_id, error: err.message, attempts: nextAttempts, terminal }));
    }
  }

  return {
    picked: attempts,
    processed: processed.length,
    ok: processed.filter(p => p.ok).length,
    failed: processed.filter(p => !p.ok).length,
    details: processed,
  };
}

/**
 * Claim-and-process pending operating_protocols (status='pending').
 *
 * Mirrors processPendingExtractions: atomic claim (pending→processing via
 * attempts bump), load source file + contributing client, call parser,
 * mark 'failed' on throw with attempt-based terminal flag.
 *
 * Uses the dedicated parse_attempts column on operating_protocols (vs.
 * extraction_attempts on knowledge_files). The parser internally writes
 * status='parsed' and parsed_json on success.
 */
async function processPendingProtocols(cronStartedAt) {
  const processed = [];
  let attempts = 0;

  while (processed.length < PROTOCOL_MAX_PER_RUN) {
    const elapsedMs = Date.now() - cronStartedAt;
    const remainingMs = (maxDuration * 1000) - elapsedMs;
    if (remainingMs < PROTOCOL_RESERVE_MS) {
      console.log(JSON.stringify({ event: "cron_protocol_budget_stop", elapsedMs, remainingMs }));
      break;
    }

    const { data: candidates } = await supabase
      .from("operating_protocols")
      .select("id, persona_id, source_file_id, parse_attempts")
      .eq("status", "pending")
      .lt("parse_attempts", PROTOCOL_MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(1);

    if (!candidates || candidates.length === 0) break;
    const proto = candidates[0];
    attempts++;

    const nowIso = new Date().toISOString();
    const nextAttempts = (proto.parse_attempts || 0) + 1;

    // Atomic claim via attempts bump (still in 'pending' so re-runnable if crash).
    const { data: claimed } = await supabase
      .from("operating_protocols")
      .update({ parse_attempts: nextAttempts, parse_attempted_at: nowIso })
      .eq("id", proto.id)
      .eq("parse_attempts", proto.parse_attempts || 0)
      .select("id");

    if (!claimed || claimed.length === 0) {
      console.log(JSON.stringify({ event: "cron_protocol_claim_skipped", protocol: proto.id }));
      continue;
    }

    // Load source knowledge_file for content + client (for API key).
    let content = null;
    let client = null;
    if (proto.source_file_id) {
      const { data: file } = await supabase
        .from("knowledge_files")
        .select("content, contributed_by")
        .eq("id", proto.source_file_id)
        .single();
      content = file?.content || null;
      if (file?.contributed_by) {
        const { data: cRow } = await supabase
          .from("clients").select("id, anthropic_api_key").eq("id", file.contributed_by).single();
        client = cRow || null;
      }
    }

    const fileStart = Date.now();
    try {
      if (!content) throw new Error("source_file_missing_or_empty");
      const result = await parseOperatingProtocol(
        proto.id, content, client,
        { timeoutMs: PROTOCOL_PER_FILE_TIMEOUT_MS },
      );
      processed.push({
        protocol: proto.id,
        persona: proto.persona_id,
        ok: true,
        count: result.count,
        debug: result.debug,
        ms: Date.now() - fileStart,
      });
      console.log(JSON.stringify({ event: "cron_protocol_done", protocol: proto.id, persona: proto.persona_id, count: result.count, debug: result.debug, ms: Date.now() - fileStart }));
    } catch (err) {
      const terminal = nextAttempts >= PROTOCOL_MAX_ATTEMPTS;
      await supabase.from("operating_protocols")
        .update({
          status: terminal ? "failed" : "pending",
          parse_error: err.message,
        })
        .eq("id", proto.id);

      processed.push({
        protocol: proto.id,
        persona: proto.persona_id,
        ok: false,
        error: err.message,
        attempts: nextAttempts,
        terminal,
        ms: Date.now() - fileStart,
      });
      console.error(JSON.stringify({ event: "cron_protocol_error", protocol: proto.id, persona: proto.persona_id, error: err.message, attempts: nextAttempts, terminal }));
    }
  }

  return {
    picked: attempts,
    processed: processed.length,
    ok: processed.filter(p => p.ok).length,
    failed: processed.filter(p => !p.ok).length,
    details: processed,
  };
}

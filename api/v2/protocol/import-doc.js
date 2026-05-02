// Protocol v2 — Import a single document and produce propositions across
// all sections in one shot.
//
// POST /api/v2/protocol/import-doc
//   body: {
//     persona_id: <uuid>,
//     doc_text:   <string, full extracted text>,
//     doc_filename?: <string>,
//     doc_kind?:  <string>  (persona_context | operational_playbook |
//                            icp_audience | positioning | generic)
//   }
//   → {
//       document_id, batch_id,
//       chunks_processed, candidates_total,
//       propositions_created, propositions_merged, silenced,
//       propositions: [{id, target_kind, intent, proposed_text, rationale, confidence}]
//     }
//
// Flow :
//   1. Auth + persona access. Resolve persona → active GLOBAL protocol_document
//      (source_core IS NULL).
//   2. Chunk the doc into ≤3 500-char prose blocks (paragraph-aware, sentence
//      fallback for very long paragraphs).
//   3. Routing per doc_kind (KIND_ROUTING) :
//        - extractTargets === null   → for each chunk, ONE Sonnet tool_use
//          call (extractFromChunk) emits 0..N propositions across all 6
//          target_kinds. Used by operational_playbook + generic.
//        - extractTargets === []     → no extraction (identity-only, e.g.
//          persona_context).
//        - extractTargets === [kinds] → for each chunk, ONE Sonnet tool_use
//          call (extractFromChunk with allowedTargets=[kinds]) — same single-
//          call architecture as the null path, but the tool enum + prompt
//          are restricted to the listed kinds. Used by icp_audience +
//          positioning. Replaces the legacy runExtractors per-target
//          pipeline (which produced 0 candidates on Nicolas's audience.odt
//          + positionnement.odt — the per-target extractors are too strict
//          on prose narrative).
//      Both extracting paths share the same Sonnet model + prompt strategy
//      from docs/superpowers/specs/2026-05-02-extracteur-recall-handoff.md.
//   4. For each extracted candidate :
//        - Embed `proposed_text` (Voyage 1024 dims).
//        - `findSimilarProposition` against pending propositions of this doc
//          (same target_kind, threshold 0.85).
//        - Match → MERGE: append batch_id to source_refs, count++.
//        - No match + confidence ≥ 0.5 → INSERT pending proposition.
//        - Otherwise → silenced (low confidence singleton).
//   5. Return summary + the freshly-created propositions for the UI to show.
//
// Why threshold 0.5 (vs 0.75 for cron-derived feedback events) :
//   Doc upload is an explicit user action ("here is my source material").
//   We want propositions to surface for review, not silently filter them
//   out. The user prunes via the Propositions queue.
//
// Source value is `upload_batch` (one of the canonical proposition.source
// enum values added in 038 migration). Each call generates a fresh UUID
// `batch_id` used as `source_ref`/`source_refs[0]` so an admin can later
// trace every proposition back to a specific import batch.

export const maxDuration = 60;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";
import {
  routeAndExtract as _routeAndExtract,
  runExtractors as _runExtractors,
} from "../../../lib/protocol-v2-extractor-router.js";
import { extractFromChunk as _extractFromChunk } from "../../../lib/protocol-v2-doc-extractor.js";
import {
  embedForProposition as _embedForProposition,
  findSimilarProposition as _findSimilarProposition,
  SEMANTIC_DEDUP_THRESHOLD,
} from "../../../lib/protocol-v2-embeddings.js";
import { randomUUID } from "node:crypto";
import { log } from "../../../lib/log.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOC_LEN = 100_000;
const MAX_CHUNK_LEN = 3500;
const MIN_CHUNK_LEN = 80;
const MIN_CONFIDENCE_INSERT = 0.5;

// Routing strategy per doc_kind. Two orthogonal axes :
//   - appendToIdentity: dump the whole doc text into the identity section
//     prose (with a filename separator). Used when the doc primarily
//     describes WHO the persona is (background, positioning) — that
//     content belongs in the system prompt as voice/context, not as
//     extracted rules.
//   - extractTargets: which extractors to run on each chunk.
//       null  = use the LLM router (it picks 0-2 target_kinds via Haiku,
//               then runs the matching Sonnet extractor) — current
//               default behavior.
//       []    = no extractors at all (pure prose append).
//       array = bypass the router, run only the listed extractors per chunk.
//
// Rationale per kind, calibrated on Nicolas' 4 source docs (2026-05-02) :
//   - persona_context (Background.odt) → identity prose only. The bio,
//     convictions, ton — meant for the system prompt, not for hard_rules
//     where the extractor would reject them anyway.
//   - operational_playbook (Process Setter PDF) → router decides. The doc
//     is structured exactly like a setter playbook (rules + scoring +
//     ICP + process + templates), the LLM router will route each chunk
//     correctly.
//   - icp_audience (AudienceCible.odt) → only icp_patterns + process.
//     The doc is mostly P1/P2 targeting + filtering rules; running
//     hard_rules or templates extractors on it produces noise.
//   - positioning (Positionnement.odt) → identity prose AND extract
//     process + icp_patterns (USP, pain points, R1-R4 process). Skip
//     hard_rules / scoring / templates which would catch transient
//     stack noise (BreakCold migration, etc).
//   - generic → router (current behavior).
const KIND_ROUTING = Object.freeze({
  persona_context:      { appendToIdentity: true,  extractTargets: [] },
  operational_playbook: { appendToIdentity: false, extractTargets: null },
  icp_audience:         { appendToIdentity: false, extractTargets: ["icp_patterns", "process"] },
  positioning:          { appendToIdentity: true,  extractTargets: ["process", "icp_patterns"] },
  generic:              { appendToIdentity: false, extractTargets: null },
});

const VALID_DOC_KINDS = new Set(Object.keys(KIND_ROUTING));

/**
 * Split a long text into prose chunks suitable for the protocol extractors.
 *
 * Strategy :
 *   - Split on blank lines (paragraph boundary).
 *   - Drop paragraphs shorter than MIN_CHUNK_LEN (likely headings / noise).
 *   - Concatenate adjacent paragraphs while staying ≤ MAX_CHUNK_LEN.
 *   - For paragraphs longer than MAX_CHUNK_LEN, hard-split at sentence
 *     boundaries so a single very long block doesn't bypass the limit.
 *
 * Pure / sync / exported for tests.
 */
export function chunkDoc(text) {
  if (typeof text !== "string") return [];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length >= MIN_CHUNK_LEN);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > MAX_CHUNK_LEN) {
      if (cur) {
        chunks.push(cur.trim());
        cur = "";
      }
      const sentences = p.split(/(?<=[.!?])\s+/);
      let buf = "";
      for (const s of sentences) {
        const next = buf ? `${buf} ${s}` : s;
        if (next.length > MAX_CHUNK_LEN && buf) {
          chunks.push(buf.trim());
          buf = s;
        } else {
          buf = next;
        }
      }
      if (buf) chunks.push(buf.trim());
      continue;
    }
    const next = cur ? `${cur}\n\n${p}` : p;
    if (next.length > MAX_CHUNK_LEN && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

/**
 * Append a doc text to the persona's `identity` section prose.
 * Returns {appended, chars_added, reason?}. Graceful no-op if the
 * identity section doesn't exist yet (pre-067 backfill).
 *
 * Exported for tests.
 */
export async function appendToIdentitySection(supabase, documentId, docFilename, docText) {
  const { data: section, error } = await supabase
    .from("protocol_section")
    .select("id, prose")
    .eq("document_id", documentId)
    .eq("kind", "identity")
    .maybeSingle();
  if (error) return { appended: false, reason: `query_error: ${error.message}` };
  if (!section) return { appended: false, reason: "no_identity_section" };

  const separator = docFilename ? `\n\n--- ${docFilename} ---\n\n` : "\n\n---\n\n";
  const trimmed = (section.prose || "").trim();
  const newProse = trimmed ? `${trimmed}${separator}${docText}` : docText;

  const { error: updErr } = await supabase
    .from("protocol_section")
    .update({ prose: newProse })
    .eq("id", section.id);
  if (updErr) return { appended: false, reason: `update_error: ${updErr.message}` };

  return { appended: true, chars_added: docText.length, section_id: section.id };
}

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    routeAndExtract = _routeAndExtract,
    runExtractors = _runExtractors,
    extractFromChunk = _extractFromChunk,
    embedForProposition = _embedForProposition,
    findSimilarProposition = _findSimilarProposition,
    appendToIdentity = appendToIdentitySection,
  } = deps || {};

  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const { persona_id, doc_text, doc_filename, doc_kind } = body;

  if (!persona_id || typeof persona_id !== "string" || !UUID_RE.test(persona_id)) {
    res.status(400).json({ error: "persona_id is required (uuid)" });
    return;
  }
  if (typeof doc_text !== "string" || !doc_text.trim()) {
    res.status(400).json({ error: "doc_text is required (non-empty string)" });
    return;
  }
  if (doc_text.length > MAX_DOC_LEN) {
    res.status(400).json({ error: `doc_text too long (max ${MAX_DOC_LEN} chars)` });
    return;
  }
  const docKind = typeof doc_kind === "string" && VALID_DOC_KINDS.has(doc_kind) ? doc_kind : "generic";
  const routing = KIND_ROUTING[docKind];
  const docFilename =
    typeof doc_filename === "string" && doc_filename.length <= 200 ? doc_filename : null;

  // Chunk before any DB access so a useless doc fails fast without auth churn.
  const chunks = chunkDoc(doc_text);
  if (chunks.length === 0) {
    res
      .status(400)
      .json({ error: "no extractable content (after paragraph split)" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, persona_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Resolve persona → active global protocol_document.
  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", persona_id)
    .eq("status", "active")
    .is("source_core", null)
    .limit(1)
    .maybeSingle();
  if (docErr) {
    log("protocol_v2_import_doc_lookup_error", { message: docErr.message });
    res.status(500).json({ error: "Failed to resolve protocol document" });
    return;
  }
  if (!doc?.id) {
    res
      .status(404)
      .json({ error: "no active protocol_document for this persona" });
    return;
  }
  const documentId = doc.id;

  const batchId = randomUUID();
  const ctx = { doc_filename: docFilename, doc_kind: docKind };

  // 1. Optional identity-prose append, BEFORE extraction.
  // We do this first so that even if extraction fails, the persona context
  // is preserved.
  let identitySummary = null;
  if (routing.appendToIdentity) {
    identitySummary = await appendToIdentity(supabase, documentId, docFilename, doc_text);
    if (identitySummary && !identitySummary.appended) {
      log("protocol_v2_import_doc_identity_skip", { reason: identitySummary.reason });
    }
  }

  // 2. Extraction phase. Three branches based on routing.extractTargets :
  //    null  → router decides (current default)
  //    []    → skip extraction entirely
  //    array → bypass router, run only the listed extractors per chunk
  /** @type {Array<{target_kind:string, proposal:object}>} */
  const allCandidates = [];
  if (routing.extractTargets === null) {
    // Single Sonnet tool_use call per chunk emits 0..N typed propositions.
    // Replaces the old Haiku-router + per-target Sonnet pipeline that gated
    // prose chunks (recall ~5% on Nicolas process-setter.md). See
    // docs/superpowers/specs/2026-05-02-extracteur-recall-handoff.md.
    const settled = await Promise.allSettled(
      chunks.map((chunk) => extractFromChunk(chunk, ctx, {})),
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        allCandidates.push(...s.value);
      } else if (s.status === "rejected") {
        log("protocol_v2_import_doc_chunk_error", {
          message: s.reason?.message || String(s.reason),
        });
      }
    }
  } else if (routing.extractTargets.length > 0) {
    // Explicit targets path (icp_audience, positioning) : delegate to the
    // single-call doc extractor with allowedTargets so Sonnet self-routes
    // per-item but limited to the allowed enum. Replaces the legacy
    // runExtractors per-target Sonnet pipeline that produced 0 candidates
    // on Nicolas's audience-cible.odt + positionnement.odt (the per-target
    // extractors are too strict on prose narrative).
    const settled = await Promise.allSettled(
      chunks.map((chunk) =>
        extractFromChunk(chunk, ctx, { allowedTargets: routing.extractTargets }),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        allCandidates.push(...s.value);
      } else if (s.status === "rejected") {
        log("protocol_v2_import_doc_chunk_error", {
          message: s.reason?.message || String(s.reason),
        });
      }
    }
  }
  // routing.extractTargets === [] → no extractors called, allCandidates stays empty.

  const created = [];
  let mergedCount = 0;
  let silenced = 0;

  for (const cand of allCandidates) {
    const proposal = cand?.proposal;
    if (!proposal || typeof proposal.proposed_text !== "string") continue;

    const embedding = await embedForProposition(proposal.proposed_text);
    let similar = [];
    if (Array.isArray(embedding) && embedding.length > 0) {
      similar = await findSimilarProposition(supabase, {
        documentId,
        embedding,
        targetKind: cand.target_kind,
        threshold: SEMANTIC_DEDUP_THRESHOLD,
        limit: 1,
      });
    }

    if (similar.length > 0) {
      const top = similar[0];
      const newRefs = Array.from(new Set([...(top.source_refs || []), batchId])).filter(Boolean);
      const { error: mergeErr } = await supabase
        .from("proposition")
        .update({ source_refs: newRefs, count: newRefs.length })
        .eq("id", top.id);
      if (mergeErr) {
        log("protocol_v2_import_doc_merge_error", { id: top.id, message: mergeErr.message });
      } else {
        mergedCount++;
      }
      continue;
    }

    if (typeof proposal.confidence !== "number" || proposal.confidence < MIN_CONFIDENCE_INSERT) {
      silenced++;
      continue;
    }

    const insertRow = {
      document_id: documentId,
      source: "upload_batch",
      source_ref: batchId,
      source_refs: [batchId],
      count: 1,
      intent: proposal.intent,
      target_kind: cand.target_kind,
      proposed_text: proposal.proposed_text,
      rationale: proposal.rationale || null,
      confidence: proposal.confidence,
      embedding: embedding ?? null,
      status: "pending",
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("proposition")
      .insert(insertRow)
      .select("id, target_kind, intent, proposed_text, rationale, confidence")
      .single();
    if (insertErr) {
      log("protocol_v2_import_doc_insert_error", { message: insertErr.message });
      continue;
    }
    if (inserted) created.push(inserted);
  }

  // Persist the batch metadata so the calibration view can show "this doc
  // produced N propositions, enriched identity by M chars". Best-effort —
  // a failure here doesn't invalidate the propositions already in the
  // queue, just hides this batch from the calibration view.
  const batchRow = {
    id: batchId,
    document_id: documentId,
    doc_filename: docFilename,
    doc_kind: docKind,
    identity_appended: !!identitySummary?.appended,
    identity_chars_added: identitySummary?.appended ? identitySummary.chars_added : 0,
    chunks_processed: chunks.length,
    candidates_total: allCandidates.length,
    propositions_created: created.length,
    propositions_merged: mergedCount,
    silenced,
  };
  const { error: batchErr } = await supabase
    .from("protocol_import_batch")
    .insert(batchRow);
  if (batchErr) {
    log("protocol_v2_import_doc_batch_insert_error", { message: batchErr.message });
  }

  res.status(200).json({
    document_id: documentId,
    batch_id: batchId,
    doc_kind: docKind,
    chunks_processed: chunks.length,
    candidates_total: allCandidates.length,
    propositions_created: created.length,
    propositions_merged: mergedCount,
    silenced,
    identity_appended: !!identitySummary?.appended,
    identity_chars_added: identitySummary?.appended ? identitySummary.chars_added : 0,
    propositions: created,
  });
}

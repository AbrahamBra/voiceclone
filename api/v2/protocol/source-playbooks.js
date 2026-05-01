// Source-specific playbooks v2 — list + create + edit + archive.
//
// V2 (#164) shipped GET + POST. V2.1 adds PATCH (edit prose + re-extract
// with content_hash dedup, preserves prior artifacts and their fire stats)
// and DELETE (soft archive via status='archived', frees the (persona,
// source_core) slot for a fresh upload).
//
// Endpoints :
//   GET  /api/v2/protocol/source-playbooks?persona=<uuid>
//     → { playbooks: [{ id, source_core, version, status, created_at,
//          sections_count, artifacts_count, pending_propositions_count }] }
//
//   GET  /api/v2/protocol/source-playbooks?id=<uuid>
//     → { playbook: { id, source_core, version, status, ..., section: { id,
//          heading, prose } } }
//     Detail view used by the edit form to pre-fill prose+heading.
//
//   POST /api/v2/protocol/source-playbooks
//     Two shapes (discriminated by body) :
//       a) Create new playbook :
//          body: { persona_id, source_core, prose, heading? }
//          → { document_id, section_id, candidates_total, artifacts_created,
//               low_confidence_dropped }
//       b) Append a new section to existing playbook (V2.2 — for spyer's
//          5 named instances and similar multi-section sources) :
//          body: { playbook_id, prose, heading? }
//          → { document_id, section_id, order, candidates_total,
//               artifacts_created, low_confidence_dropped }
//
//   PATCH /api/v2/protocol/source-playbooks?id=<uuid>
//     body: { prose, heading? }
//     → { document_id, section_id, candidates_total, artifacts_created,
//          artifacts_dedup_skipped, low_confidence_dropped, extraction_error? }
//
//   DELETE /api/v2/protocol/source-playbooks?id=<uuid>
//     → { archived: true, document_id }
//
// Auth : authenticateRequest + hasPersonaAccess. Admins bypass.
//
// Concurrency : one active doc per (persona, source_core). DELETE flips
// status='archived' so a new active doc can take that slot — past artifacts
// stay around for analytics under the archived doc.
//
// Cohabite avec api/v2/protocol/extract.js (édition section in-place) et
// api/v2/propositions.js (review de propositions). Cf migration 055.

export const maxDuration = 15;

import crypto from "node:crypto";
import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";
import { computeArtifactHash } from "../../../lib/protocol-v2-db.js";
import { routeAndExtract as _routeAndExtract } from "../../../lib/protocol-v2-extractor-router.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keep in lockstep with src/lib/source-core.js + supabase/055.
const SOURCE_CORE_VALUES = new Set([
  "visite_profil", "dr_recue", "interaction_contenu",
  "premier_degre", "spyer", "sales_nav",
]);

const MAX_PROSE_LEN = 50000;          // ~250kB of UTF-8 text — Notion docs fit
const MIN_CONFIDENCE_AUTO_ACCEPT = 0.75; // mirrors MIN_CONFIDENCE_INSERT
const DEFAULT_EXTRACTION_TIMEOUT_MS = 12000;
const DEFAULT_HEADING_PREFIX = "Playbook";

// target_kind → artifact kind+severity mapping for bulk-imported candidates.
// Different from propositions.js INTENT_TO_ARTIFACT_KIND because that mapping
// is intent-driven (add_rule / add_paragraph) for incremental learning ;
// here we're seeding a brand-new playbook from a complete doc, so we honour
// the section_kind the extractor routed each candidate to.
const TARGET_KIND_TO_ARTIFACT = {
  hard_rules:   { kind: "hard_check",        severity: "hard" },
  errors:       { kind: "hard_check",        severity: "hard" },
  templates:    { kind: "template_skeleton", severity: "light" },
  icp_patterns: { kind: "pattern",           severity: "strong" },
  process:      { kind: "state_transition",  severity: "strong" },
  scoring:      { kind: "score_axis",        severity: "light" },
  identity:     { kind: "pattern",           severity: "strong" },
  custom:       { kind: "pattern",           severity: "light" },
};

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    routeAndExtract = _routeAndExtract,
    extractionTimeoutMs = DEFAULT_EXTRACTION_TIMEOUT_MS,
    killSwitch = process.env.PROTOCOL_V2_EXTRACTION,
  } = deps || {};

  setCors(res, "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (req.method === "GET") {
    return handleList({ req, res, supabase, client, isAdmin, hasPersonaAccess });
  }
  if (req.method === "POST") {
    // Body discriminator : `playbook_id` → append section to existing playbook ;
    // otherwise (default) → create a new playbook.
    const body = req.body || {};
    if (body.playbook_id !== undefined && body.persona_id !== undefined) {
      res.status(400).json({ error: "specify EITHER playbook_id (append section) OR persona_id (create playbook), not both" });
      return;
    }
    if (body.playbook_id !== undefined) {
      return handleAppendSection({
        req, res, supabase, client, isAdmin, hasPersonaAccess,
        routeAndExtract, extractionTimeoutMs, killSwitch,
      });
    }
    return handleCreate({
      req, res, supabase, client, isAdmin, hasPersonaAccess,
      routeAndExtract, extractionTimeoutMs, killSwitch,
    });
  }
  if (req.method === "PATCH") {
    return handleEdit({
      req, res, supabase, client, isAdmin, hasPersonaAccess,
      routeAndExtract, extractionTimeoutMs, killSwitch,
    });
  }
  if (req.method === "DELETE") {
    return handleArchive({ req, res, supabase, client, isAdmin, hasPersonaAccess });
  }
  res.status(405).json({ error: "Method not allowed" });
}

// ── GET — list (?persona=) or detail (?id=) ──────────────────────
async function handleList({ req, res, supabase, client, isAdmin, hasPersonaAccess }) {
  const docId = (req.query?.id || "").trim();
  if (docId) {
    return handleDetail({ req, res, supabase, client, isAdmin, hasPersonaAccess, docId });
  }
  const personaId = (req.query?.persona || "").trim();
  if (!personaId || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona or id query param required (uuid)" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // 1. Active source-specific docs for this persona.
  const { data: docs, error: docsErr } = await supabase
    .from("protocol_document")
    .select("id, source_core, version, status, parent_template_id, created_at, updated_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .not("source_core", "is", null)
    .order("source_core", { ascending: true });
  if (docsErr) {
    res.status(500).json({ error: "db error", detail: docsErr.message });
    return;
  }

  if (!docs || docs.length === 0) {
    res.status(200).json({ playbooks: [] });
    return;
  }

  const docIds = docs.map((d) => d.id);

  // 2. Counts in parallel : sections, artifacts, pending propositions.
  const [sectionsRes, artifactsRes, propsRes] = await Promise.all([
    supabase.from("protocol_section").select("id, document_id").in("document_id", docIds),
    supabase.from("protocol_artifact").select("id, source_section_id, protocol_section!inner(document_id)").in("protocol_section.document_id", docIds).eq("is_active", true),
    supabase.from("proposition").select("id, document_id").in("document_id", docIds).eq("status", "pending"),
  ]);

  const sectionsByDoc = bucket(sectionsRes.data || [], "document_id");
  const artifactsByDoc = bucket(
    (artifactsRes.data || []).map((a) => ({ id: a.id, document_id: a.protocol_section?.document_id })),
    "document_id"
  );
  const propsByDoc = bucket(propsRes.data || [], "document_id");

  const playbooks = docs.map((d) => ({
    id: d.id,
    source_core: d.source_core,
    version: d.version,
    status: d.status,
    parent_template_id: d.parent_template_id,
    created_at: d.created_at,
    updated_at: d.updated_at,
    sections_count: (sectionsByDoc[d.id] || []).length,
    artifacts_count: (artifactsByDoc[d.id] || []).length,
    pending_propositions_count: (propsByDoc[d.id] || []).length,
  }));

  res.status(200).json({ playbooks });
}

function bucket(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    (out[k] = out[k] || []).push(r);
  }
  return out;
}

// Detail of a single playbook : V2.1 returned only `section` (first one).
// V2.2 returns `sections[]` so multi-instance playbooks (typically spyer with
// 5 instances) can be displayed and edited per-section. The legacy `section`
// field is kept as an alias for the lowest-order section (back-compat with
// any client that pinned to V2.1's shape).
async function handleDetail({ req, res, supabase, client, isAdmin, hasPersonaAccess, docId }) {
  if (!UUID_RE.test(docId)) {
    res.status(400).json({ error: "id must be a uuid" });
    return;
  }
  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id, owner_kind, owner_id, source_core, version, status, parent_template_id, created_at, updated_at")
    .eq("id", docId)
    .maybeSingle();
  if (docErr || !doc) {
    res.status(404).json({ error: "playbook not found" });
    return;
  }
  if (doc.owner_kind !== "persona" || !doc.source_core) {
    res.status(422).json({ error: "this endpoint only returns source-specific persona playbooks" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, doc.owner_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { data: sections } = await supabase
    .from("protocol_section")
    .select("id, heading, prose, kind, order, updated_at")
    .eq("document_id", docId)
    .order("order", { ascending: true });
  const sectionsList = sections || [];
  res.status(200).json({
    playbook: {
      id: doc.id,
      source_core: doc.source_core,
      version: doc.version,
      status: doc.status,
      parent_template_id: doc.parent_template_id,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      sections: sectionsList,
      // V2.1 back-compat alias.
      section: sectionsList[0] || null,
    },
  });
}

// ── POST — create a new source playbook from prose ───────────────
async function handleCreate({
  req, res, supabase, client, isAdmin, hasPersonaAccess,
  routeAndExtract, extractionTimeoutMs, killSwitch,
}) {
  const { persona_id, source_core, prose, heading } = req.body || {};

  if (!persona_id || !UUID_RE.test(persona_id)) {
    res.status(400).json({ error: "persona_id is required (uuid)" });
    return;
  }
  if (!source_core || !SOURCE_CORE_VALUES.has(source_core)) {
    res.status(400).json({ error: `source_core must be one of: ${[...SOURCE_CORE_VALUES].join(", ")}` });
    return;
  }
  if (typeof prose !== "string" || !prose.trim()) {
    res.status(400).json({ error: "prose is required (non-empty string)" });
    return;
  }
  if (prose.length > MAX_PROSE_LEN) {
    res.status(400).json({ error: `prose too long (max ${MAX_PROSE_LEN} chars)` });
    return;
  }
  if (heading !== undefined && (typeof heading !== "string" || heading.length > 200)) {
    res.status(400).json({ error: "heading must be a string ≤ 200 chars" });
    return;
  }

  if (!isAdmin && !(await hasPersonaAccess(client?.id, persona_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // 1. Refuse if persona already has an active playbook for this source_core.
  // (V2.1 will add archive flow ; for now manual SQL or supabase dashboard.)
  const { data: existing } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", persona_id)
    .eq("status", "active")
    .eq("source_core", source_core)
    .maybeSingle();
  if (existing?.id) {
    res.status(409).json({ error: "active playbook already exists for this source_core", document_id: existing.id });
    return;
  }

  // 2. Insert protocol_document.
  const documentId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: docErr } = await supabase.from("protocol_document").insert({
    id: documentId,
    owner_kind: "persona",
    owner_id: persona_id,
    version: 1,
    status: "active",
    source_core,
    created_at: now,
    updated_at: now,
  });
  if (docErr) {
    res.status(500).json({ error: "doc insert failed", detail: docErr.message });
    return;
  }

  // 3. Insert protocol_section (kind=custom — playbook content is free-form).
  const finalHeading = (heading || `${DEFAULT_HEADING_PREFIX} ${source_core}`).slice(0, 200);
  const { error: secErr } = await supabase.from("protocol_section").insert({
    id: sectionId,
    document_id: documentId,
    order: 0,
    kind: "custom",
    heading: finalHeading,
    prose: prose.trim(),
    structured: null,
    client_visible: false, // agency-authored, not exposed to client by default
    client_editable: false,
    author_kind: "user",
  });
  if (secErr) {
    // Roll back the doc insert manually (no transactions across multiple .from() calls).
    await supabase.from("protocol_document").delete().eq("id", documentId);
    res.status(500).json({ error: "section insert failed", detail: secErr.message });
    return;
  }

  // 4. If extraction killswitch is off, return early — caller can edit prose
  // later via the existing /api/v2/protocol/extract endpoint to trigger.
  if (killSwitch === "off") {
    res.status(201).json({
      document_id: documentId,
      section_id: sectionId,
      candidates_total: 0,
      artifacts_created: 0,
      low_confidence_dropped: 0,
      extraction_skipped: true,
    });
    return;
  }

  // 5. Run extraction. Defensive : never let an extractor failure break the
  // create — the doc + section are already saved, the user can retrigger.
  let candidates = [];
  let extractionError = null;
  try {
    const signal = {
      source_type: "prose_edit",
      source_text: prose,
      context: {
        section_kind: "custom",
        section_heading: finalHeading,
        source_core,
      },
    };
    candidates = await raceWithTimeout(
      routeAndExtract(signal),
      extractionTimeoutMs,
      "extraction_timeout",
    );
  } catch (err) {
    extractionError = err?.message || "extraction_failed";
  }

  // 6. Auto-accept high-confidence candidates : insert proposition
  // (status=accepted) + materialize artifact directly. Low-confidence
  // candidates are dropped ; caller can retrigger extraction for refinement.
  let artifactsCreated = 0;
  let lowConfDropped = 0;
  for (const candidate of candidates || []) {
    const conf = candidate?.proposal?.confidence;
    const text = (candidate?.proposal?.proposed_text || "").trim();
    if (!text) continue;
    if (typeof conf !== "number" || conf < MIN_CONFIDENCE_AUTO_ACCEPT) {
      lowConfDropped++;
      continue;
    }
    const targetKind = candidate.target_kind;
    const artifactKindMeta = TARGET_KIND_TO_ARTIFACT[targetKind] || TARGET_KIND_TO_ARTIFACT.custom;
    const hash = computeArtifactHash(text);
    if (!hash) continue;

    // Insert proposition first (status=accepted) — keeps the audit trail and
    // mirrors the manual accept flow shape, just bypassing the queue.
    const propId = crypto.randomUUID();
    const { error: propErr } = await supabase.from("proposition").insert({
      id: propId,
      document_id: documentId,
      source: "manual",
      source_ref: null,
      source_refs: [],
      count: 1,
      intent: candidate.proposal.intent || "add_rule",
      target_kind: targetKind,
      target_section_id: sectionId,
      proposed_text: text,
      rationale: candidate.proposal.rationale || null,
      confidence: conf,
      status: "accepted",
      resolved_at: now,
      created_at: now,
    });
    if (propErr) continue; // skip, don't fail the whole create

    // Materialize artifact.
    const { error: artErr } = await supabase.from("protocol_artifact").insert({
      source_section_id: sectionId,
      source_quote: candidate.proposal.rationale || null,
      kind: artifactKindMeta.kind,
      content: {
        text,
        intent: candidate.proposal.intent || "add_rule",
        source_proposition_id: propId,
        source_kind: targetKind,
        confidence: conf,
      },
      severity: artifactKindMeta.severity,
      content_hash: hash,
      is_active: true,
      is_manual_override: false,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
    });
    if (artErr) continue;
    artifactsCreated++;
  }

  res.status(201).json({
    document_id: documentId,
    section_id: sectionId,
    candidates_total: (candidates || []).length,
    artifacts_created: artifactsCreated,
    low_confidence_dropped: lowConfDropped,
    extraction_error: extractionError,
  });
}

function raceWithTimeout(promise, ms, errorMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms)),
  ]);
}

// ── PATCH — edit prose + re-extract with content_hash dedup ──────
//
// Re-extraction strategy : runs the extractor on the new prose, computes
// content_hash for each candidate, and skips candidates whose hash already
// exists on this section. This preserves prior artifacts (and their stats —
// fires, last_fired_at, accuracy) instead of trashing them on every save.
// Existing artifacts stay active ; new ones are added incrementally.
//
// V2.2 : optional `section_id` in the body targets a specific section. When
// omitted, defaults to the lowest-order section (V2.1 behavior preserved for
// callers that don't yet know about multi-section playbooks).
//
// Doesn't deactivate artifacts that "disappeared" from the new prose. That
// would require a separate UI for the user to confirm the deletion (V2.3+).
async function handleEdit({
  req, res, supabase, client, isAdmin, hasPersonaAccess,
  routeAndExtract, extractionTimeoutMs, killSwitch,
}) {
  const documentId = (req.query?.id || "").trim();
  if (!documentId || !UUID_RE.test(documentId)) {
    res.status(400).json({ error: "id query param required (uuid)" });
    return;
  }

  const { prose, heading, section_id } = req.body || {};
  if (typeof prose !== "string" || !prose.trim()) {
    res.status(400).json({ error: "prose is required (non-empty string)" });
    return;
  }
  if (prose.length > MAX_PROSE_LEN) {
    res.status(400).json({ error: `prose too long (max ${MAX_PROSE_LEN} chars)` });
    return;
  }
  if (heading !== undefined && (typeof heading !== "string" || heading.length > 200)) {
    res.status(400).json({ error: "heading must be a string ≤ 200 chars" });
    return;
  }
  if (section_id !== undefined && (typeof section_id !== "string" || !UUID_RE.test(section_id))) {
    res.status(400).json({ error: "section_id must be a uuid" });
    return;
  }

  // 1. Fetch the doc to verify it exists, get persona for access check, and
  // confirm it's a source-specific playbook (not the global protocol — that
  // has its own edit flow via /api/v2/protocol/extract).
  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id, owner_kind, owner_id, source_core, status")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) {
    res.status(404).json({ error: "playbook not found" });
    return;
  }
  if (doc.owner_kind !== "persona" || !doc.source_core) {
    res.status(422).json({ error: "this endpoint only edits source-specific persona playbooks" });
    return;
  }
  if (doc.status !== "active") {
    res.status(409).json({ error: "playbook is not active (status=" + doc.status + ")" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, doc.owner_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // 2. Fetch the targeted section. When `section_id` is provided, fetch that
  // exact one (and verify it belongs to this doc). When omitted, fall back
  // to the lowest-order section for V2.1 back-compat with single-section
  // callers.
  let section = null;
  if (section_id) {
    const { data: oneSection } = await supabase
      .from("protocol_section")
      .select("id, document_id, order, heading, prose")
      .eq("id", section_id)
      .maybeSingle();
    if (!oneSection) {
      res.status(404).json({ error: "section not found" });
      return;
    }
    if (oneSection.document_id !== documentId) {
      res.status(403).json({ error: "section does not belong to this playbook" });
      return;
    }
    section = oneSection;
  } else {
    const { data: sections } = await supabase
      .from("protocol_section")
      .select("id, document_id, order, heading, prose")
      .eq("document_id", documentId)
      .order("order", { ascending: true })
      .limit(1);
    if (!sections || sections.length === 0) {
      res.status(422).json({ error: "playbook has no section to edit" });
      return;
    }
    section = sections[0];
  }
  const finalHeading = (heading !== undefined ? heading : section.heading) || `${DEFAULT_HEADING_PREFIX} ${doc.source_core}`;

  // 3. Update prose + heading on the section.
  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("protocol_section")
    .update({ prose: prose.trim(), heading: finalHeading.slice(0, 200), updated_at: now })
    .eq("id", section.id);
  if (updErr) {
    res.status(500).json({ error: "section update failed", detail: updErr.message });
    return;
  }
  await supabase.from("protocol_document").update({ updated_at: now }).eq("id", documentId);

  // 4. Killswitch off → save prose only, no extraction. Short-circuit.
  if (killSwitch === "off") {
    res.status(200).json({
      document_id: documentId,
      section_id: section.id,
      candidates_total: 0,
      artifacts_created: 0,
      artifacts_dedup_skipped: 0,
      low_confidence_dropped: 0,
      extraction_skipped: true,
    });
    return;
  }

  // 5. Load existing content_hashes for THIS section to dedup. Active or not :
  // we don't want to re-create an artifact that was previously deactivated by
  // the user — it would silently revive their rejection.
  const { data: existingArtifacts } = await supabase
    .from("protocol_artifact")
    .select("content_hash")
    .eq("source_section_id", section.id);
  const existingHashes = new Set((existingArtifacts || []).map((a) => a.content_hash).filter(Boolean));

  // 6. Run extraction.
  let candidates = [];
  let extractionError = null;
  try {
    const signal = {
      source_type: "prose_edit",
      source_text: prose,
      context: {
        section_kind: "custom",
        section_heading: finalHeading,
        source_core: doc.source_core,
      },
    };
    candidates = await raceWithTimeout(
      routeAndExtract(signal),
      extractionTimeoutMs,
      "extraction_timeout",
    );
  } catch (err) {
    extractionError = err?.message || "extraction_failed";
  }

  // 7. Auto-accept high-conf candidates whose hash is NEW. Prior artifacts
  // (matching hashes) stay untouched — their stats are preserved.
  let artifactsCreated = 0;
  let dedupSkipped = 0;
  let lowConfDropped = 0;
  for (const candidate of candidates || []) {
    const conf = candidate?.proposal?.confidence;
    const text = (candidate?.proposal?.proposed_text || "").trim();
    if (!text) continue;
    if (typeof conf !== "number" || conf < MIN_CONFIDENCE_AUTO_ACCEPT) {
      lowConfDropped++;
      continue;
    }
    const hash = computeArtifactHash(text);
    if (!hash) continue;
    if (existingHashes.has(hash)) {
      dedupSkipped++;
      continue;
    }
    const targetKind = candidate.target_kind;
    const artifactKindMeta = TARGET_KIND_TO_ARTIFACT[targetKind] || TARGET_KIND_TO_ARTIFACT.custom;

    const propId = crypto.randomUUID();
    const { error: propErr } = await supabase.from("proposition").insert({
      id: propId,
      document_id: documentId,
      source: "manual",
      source_ref: null,
      source_refs: [],
      count: 1,
      intent: candidate.proposal.intent || "add_rule",
      target_kind: targetKind,
      target_section_id: section.id,
      proposed_text: text,
      rationale: candidate.proposal.rationale || null,
      confidence: conf,
      status: "accepted",
      resolved_at: now,
      created_at: now,
    });
    if (propErr) continue;

    const { error: artErr } = await supabase.from("protocol_artifact").insert({
      source_section_id: section.id,
      source_quote: candidate.proposal.rationale || null,
      kind: artifactKindMeta.kind,
      content: {
        text,
        intent: candidate.proposal.intent || "add_rule",
        source_proposition_id: propId,
        source_kind: targetKind,
        confidence: conf,
      },
      severity: artifactKindMeta.severity,
      content_hash: hash,
      is_active: true,
      is_manual_override: false,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
    });
    if (artErr) continue;
    existingHashes.add(hash); // guard against intra-batch duplicates
    artifactsCreated++;
  }

  res.status(200).json({
    document_id: documentId,
    section_id: section.id,
    candidates_total: (candidates || []).length,
    artifacts_created: artifactsCreated,
    artifacts_dedup_skipped: dedupSkipped,
    low_confidence_dropped: lowConfDropped,
    extraction_error: extractionError,
  });
}

// ── POST (alt) — append a section to an existing playbook ────────
//
// V2.2 : enables multi-section playbooks. Spyer with 5 instances
// (Alec/Nina/Margo/Franck/Max) is the canonical use case — each instance
// becomes its own section under the single `spyer` playbook doc, with its
// own prose + extracted artifacts. The doc-level (persona, source_core)
// uniqueness invariant stays untouched : we don't create a new doc, we add
// a section to the existing one.
//
// New section order = max(existing orders) + 1. The 1st section (order=0)
// stays the V2.1 "default" target for PATCH without section_id.
async function handleAppendSection({
  req, res, supabase, client, isAdmin, hasPersonaAccess,
  routeAndExtract, extractionTimeoutMs, killSwitch,
}) {
  const { playbook_id, prose, heading } = req.body || {};

  if (!playbook_id || !UUID_RE.test(playbook_id)) {
    res.status(400).json({ error: "playbook_id is required (uuid)" });
    return;
  }
  if (typeof prose !== "string" || !prose.trim()) {
    res.status(400).json({ error: "prose is required (non-empty string)" });
    return;
  }
  if (prose.length > MAX_PROSE_LEN) {
    res.status(400).json({ error: `prose too long (max ${MAX_PROSE_LEN} chars)` });
    return;
  }
  if (heading !== undefined && (typeof heading !== "string" || heading.length > 200)) {
    res.status(400).json({ error: "heading must be a string ≤ 200 chars" });
    return;
  }

  // 1. Verify playbook exists, is source-specific, and is active.
  const { data: doc } = await supabase
    .from("protocol_document")
    .select("id, owner_kind, owner_id, source_core, status")
    .eq("id", playbook_id)
    .maybeSingle();
  if (!doc) {
    res.status(404).json({ error: "playbook not found" });
    return;
  }
  if (doc.owner_kind !== "persona" || !doc.source_core) {
    res.status(422).json({ error: "this endpoint only appends sections to source-specific persona playbooks" });
    return;
  }
  if (doc.status !== "active") {
    res.status(409).json({ error: "playbook is not active (status=" + doc.status + ")" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, doc.owner_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // 2. Compute next order = max(existing order) + 1.
  // Compute via JS Math.max rather than DESC+limit so the result doesn't
  // depend on Supabase row ordering for tiny lists. Section IDs are also
  // captured here for the dedup query at step 6 — saves a round-trip.
  const { data: existingSections } = await supabase
    .from("protocol_section")
    .select("id, order")
    .eq("document_id", playbook_id);
  const orderValues = (existingSections || [])
    .map((s) => (typeof s.order === "number" ? s.order : -1))
    .filter((n) => n >= 0);
  const nextOrder = orderValues.length > 0 ? Math.max(...orderValues) + 1 : 0;
  const allSectionIds = (existingSections || []).map((s) => s.id).filter(Boolean);

  // 3. Insert the new section.
  const sectionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const finalHeading = (heading || `${DEFAULT_HEADING_PREFIX} ${doc.source_core} #${nextOrder + 1}`).slice(0, 200);
  const { error: secErr } = await supabase.from("protocol_section").insert({
    id: sectionId,
    document_id: playbook_id,
    order: nextOrder,
    kind: "custom",
    heading: finalHeading,
    prose: prose.trim(),
    structured: null,
    client_visible: false,
    client_editable: false,
    author_kind: "user",
  });
  if (secErr) {
    res.status(500).json({ error: "section insert failed", detail: secErr.message });
    return;
  }
  await supabase.from("protocol_document").update({ updated_at: now }).eq("id", playbook_id);

  // 4. Killswitch off → save section only, no extraction.
  if (killSwitch === "off") {
    res.status(201).json({
      document_id: playbook_id,
      section_id: sectionId,
      order: nextOrder,
      candidates_total: 0,
      artifacts_created: 0,
      low_confidence_dropped: 0,
      extraction_skipped: true,
    });
    return;
  }

  // 5. Run extraction on the new section's prose.
  let candidates = [];
  let extractionError = null;
  try {
    const signal = {
      source_type: "prose_edit",
      source_text: prose,
      context: {
        section_kind: "custom",
        section_heading: finalHeading,
        source_core: doc.source_core,
      },
    };
    candidates = await raceWithTimeout(
      routeAndExtract(signal),
      extractionTimeoutMs,
      "extraction_timeout",
    );
  } catch (err) {
    extractionError = err?.message || "extraction_failed";
  }

  // 6. Auto-accept high-conf candidates. Dedup against ALL artifacts of the
  // playbook (not just this section) — instance-specific artifacts that are
  // identical across sections (e.g. shared cadence rule) only need to be
  // injected once into the system_prompt anyway. We use the section IDs we
  // already collected at step 2 ; if there are no existing sections the
  // dedup pool is empty.
  let existingHashes = new Set();
  if (allSectionIds.length > 0) {
    const { data: docArtifacts } = await supabase
      .from("protocol_artifact")
      .select("content_hash")
      .in("source_section_id", allSectionIds);
    existingHashes = new Set(
      (docArtifacts || []).map((a) => a.content_hash).filter(Boolean),
    );
  }

  let artifactsCreated = 0;
  let dedupSkipped = 0;
  let lowConfDropped = 0;
  for (const candidate of candidates || []) {
    const conf = candidate?.proposal?.confidence;
    const text = (candidate?.proposal?.proposed_text || "").trim();
    if (!text) continue;
    if (typeof conf !== "number" || conf < MIN_CONFIDENCE_AUTO_ACCEPT) {
      lowConfDropped++;
      continue;
    }
    const hash = computeArtifactHash(text);
    if (!hash) continue;
    if (existingHashes.has(hash)) {
      dedupSkipped++;
      continue;
    }
    const targetKind = candidate.target_kind;
    const artifactKindMeta = TARGET_KIND_TO_ARTIFACT[targetKind] || TARGET_KIND_TO_ARTIFACT.custom;

    const propId = crypto.randomUUID();
    const { error: propErr } = await supabase.from("proposition").insert({
      id: propId,
      document_id: playbook_id,
      source: "manual",
      source_ref: null,
      source_refs: [],
      count: 1,
      intent: candidate.proposal.intent || "add_rule",
      target_kind: targetKind,
      target_section_id: sectionId,
      proposed_text: text,
      rationale: candidate.proposal.rationale || null,
      confidence: conf,
      status: "accepted",
      resolved_at: now,
      created_at: now,
    });
    if (propErr) continue;

    const { error: artErr } = await supabase.from("protocol_artifact").insert({
      source_section_id: sectionId,
      source_quote: candidate.proposal.rationale || null,
      kind: artifactKindMeta.kind,
      content: {
        text,
        intent: candidate.proposal.intent || "add_rule",
        source_proposition_id: propId,
        source_kind: targetKind,
        confidence: conf,
      },
      severity: artifactKindMeta.severity,
      content_hash: hash,
      is_active: true,
      is_manual_override: false,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
    });
    if (artErr) continue;
    existingHashes.add(hash);
    artifactsCreated++;
  }

  res.status(201).json({
    document_id: playbook_id,
    section_id: sectionId,
    order: nextOrder,
    candidates_total: (candidates || []).length,
    artifacts_created: artifactsCreated,
    artifacts_dedup_skipped: dedupSkipped,
    low_confidence_dropped: lowConfDropped,
    extraction_error: extractionError,
  });
}

// ── DELETE — soft archive a playbook (status='archived') ─────────
//
// Doesn't drop rows. Frees the (persona, source_core) active slot so a fresh
// POST can take that slot. Past artifacts/sections/propositions stay attached
// to the archived doc for audit + analytics.
async function handleArchive({ req, res, supabase, client, isAdmin, hasPersonaAccess }) {
  const documentId = (req.query?.id || "").trim();
  if (!documentId || !UUID_RE.test(documentId)) {
    res.status(400).json({ error: "id query param required (uuid)" });
    return;
  }

  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id, owner_kind, owner_id, source_core, status")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) {
    res.status(404).json({ error: "playbook not found" });
    return;
  }
  if (doc.owner_kind !== "persona" || !doc.source_core) {
    res.status(422).json({ error: "this endpoint only archives source-specific persona playbooks" });
    return;
  }
  if (doc.status === "archived") {
    res.status(200).json({ archived: true, document_id: documentId, already_archived: true });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, doc.owner_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { error: updErr } = await supabase
    .from("protocol_document")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", documentId);
  if (updErr) {
    res.status(500).json({ error: "archive failed", detail: updErr.message });
    return;
  }

  res.status(200).json({ archived: true, document_id: documentId });
}

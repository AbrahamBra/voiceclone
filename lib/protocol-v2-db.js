// Data access layer for the protocole vivant. Read-only in this chunk.
// Writes (create/update/publish) will come in chunks 2-4.
//
// Pattern: all functions take a Supabase client as first argument to allow
// test stubs and singleton reuse via `supabase` from lib/supabase.js in endpoints.

import crypto from "node:crypto";

/**
 * Stable hash on the SEMANTICS of an artifact's text content
 * (lowercase, collapsed whitespace, alphanumeric+space only).
 *
 * Used by accept-proposition flow to materialize protocol_artifact rows
 * with a content_hash that survives reformulation. Preserves stats.fires
 * cross-version (per migration 038 comment on protocol_artifact.content_hash).
 *
 * @param {string} text
 * @returns {string|null} 64-char sha256 hex, or null on empty/invalid input.
 */
export function computeArtifactHash(text) {
  if (typeof text !== "string") return null;
  const norm = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
  if (!norm) return null;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

/**
 * Returns the ACTIVE GLOBAL document for a persona (max 1), or null.
 *
 * "Global" = source_core IS NULL (voice / values / persona / offer / 10 règles d'or).
 * Source-specific playbooks (source_core != NULL) are fetched separately via
 * getActivePlaybookForSource. Migration 055 introduced the source_core dimension.
 *
 * Uses .maybeSingle() so a row count of 0 returns null cleanly (instead of error).
 * The (owner_kind, owner_id, source_core IS NULL, status='active') tuple is
 * expected to be ≤ 1 row by convention but not enforced at the DB level.
 */
export async function getActiveDocument(sb, personaId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("id, version, status, source_core, parent_template_id, created_at, updated_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .is("source_core", null)
    .maybeSingle();
  if (error) return null;
  return data;
}

/**
 * Returns the ACTIVE source-specific playbook document for a persona, or null.
 *
 * Source-specific playbooks (e.g. visite_profil, dr_recue, spyer) sit alongside
 * the global doc returned by getActiveDocument. They typically reference a
 * universal template via parent_template_id. Cf migration 055.
 *
 * @param {object} sb supabase client
 * @param {string} personaId
 * @param {string} sourceCore one of the 6 core source categories
 * @returns {Promise<object|null>}
 */
export async function getActivePlaybookForSource(sb, personaId, sourceCore) {
  if (!sourceCore) return null;
  const { data, error } = await sb
    .from("protocol_document")
    .select("id, version, status, source_core, parent_template_id, created_at, updated_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .eq("source_core", sourceCore)
    .maybeSingle();
  if (error) return null;
  return data;
}

/**
 * Lists sections of a document in display order.
 */
export async function listSections(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_section")
    .select(
      'id, document_id, "order", kind, heading, prose, structured, inherited_from_section_id, client_visible, client_editable, author_kind, updated_at'
    )
    .eq("document_id", documentId)
    .order('"order"', { ascending: true });
  if (error) return [];
  return data || [];
}

/**
 * Lists artifacts of a section.
 * @param options.activeOnly  only return is_active=true (default true)
 */
export async function listArtifacts(sb, sectionId, { activeOnly = true } = {}) {
  let q = sb
    .from("protocol_artifact")
    .select("id, source_section_id, source_quote, kind, content, severity, scenarios, is_active, is_manual_override, content_hash, stats, created_at")
    .eq("source_section_id", sectionId);
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

/**
 * Returns active artifacts for the persona's active docs (Chantier 2bis +
 * migration 055).
 *
 * - Always includes artifacts from the GLOBAL doc (source_core IS NULL).
 * - If `sourceCore` is provided, ALSO includes artifacts from the matching
 *   source-specific playbook (source_core = sourceCore). Backward-compat:
 *   callers that omit sourceCore get the same behavior as before 055.
 *
 * Used by the chat pipeline to inject learned rules into the prompt and
 * log firings against them. Sorted by created_at DESC so the most-recent
 * learnings have priority under the prompt token budget.
 *
 * Best-effort: returns [] on any error (caller wraps in .catch anyway).
 *
 * @param {object} sb supabase client
 * @param {string} personaId
 * @param {object} [opts]
 * @param {number} [opts.limit=30] max artifacts to return (across both docs)
 * @param {string|null} [opts.sourceCore=null] one of the 6 core source
 *   categories — when set, the source-specific playbook is merged in.
 * @returns {Promise<Array<{id:string, source_section_id:string, kind:string, content:object, severity:string}>>}
 */
export async function getActiveArtifactsForPersona(sb, personaId, { limit = 30, sourceCore = null } = {}) {
  const [globalDoc, playbookDoc] = await Promise.all([
    getActiveDocument(sb, personaId),
    sourceCore ? getActivePlaybookForSource(sb, personaId, sourceCore) : Promise.resolve(null),
  ]);

  // Collect doc IDs to query: the persona's own active docs, PLUS any parent
  // template they were forked from (so the fork inherits operational artifacts
  // — strategy, cadence, etc. — kept on the universal template, while still
  // overriding voice/values via its own artifacts). Without this, a fork that
  // only re-asserts voice would silently strip away the playbook content it
  // inherited from. Cf migration 055.
  const docIds = new Set();
  for (const d of [globalDoc, playbookDoc]) {
    if (!d) continue;
    docIds.add(d.id);
    if (d.parent_template_id) docIds.add(d.parent_template_id);
  }
  if (docIds.size === 0) return [];

  const { data: sections } = await sb
    .from("protocol_section")
    .select("id")
    .in("document_id", [...docIds]);
  if (!sections || sections.length === 0) return [];

  const sectionIds = sections.map((s) => s.id);
  const { data: artifacts } = await sb
    .from("protocol_artifact")
    .select("id, source_section_id, kind, content, severity")
    .in("source_section_id", sectionIds)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  return artifacts || [];
}

/**
 * Counts pending propositions for a document (UI badge).
 */
export async function countPendingPropositions(sb, documentId) {
  const { count, error } = await sb
    .from("proposition")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("status", "pending");
  if (error) return 0;
  return count || 0;
}

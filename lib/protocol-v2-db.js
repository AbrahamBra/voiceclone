// Data access layer for the protocole vivant. Read-only in this chunk.
// Writes (create/update/publish) will come in chunks 2-4.
//
// Pattern: all functions take a Supabase client as first argument to allow
// test stubs and singleton reuse via `supabase` from lib/supabase.js in endpoints.

/**
 * Returns the ACTIVE document for a persona (max 1), or null.
 */
export async function getActiveDocument(sb, personaId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("id, version, status, parent_template_id, created_at, updated_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .single();
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

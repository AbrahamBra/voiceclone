// Versioning helpers for the Protocol v2 doctrine.
//
// A doctrine evolves as a sequence of `protocol_document` rows of status
// 'draft' | 'active' | 'archived'. Publishing a draft means:
//   1. Migrating live `stats` (fires / last_fired_at / accuracy) from the
//      previous active document onto matching artifacts of the new one,
//      preserving learning across paragraph reformulations. Match key is
//      `content_hash` (already normalised — punctuation/casing-insensitive).
//   2. Flipping the draft to 'active'.
//   3. Archiving the previously-active document.
//
// "Atomicity" tradeoff (no SQL transaction available client-side, no SECURITY
// DEFINER function defined for this op yet): we do steps in this order to
// minimise damage on partial failure:
//   - stats migration first (safe to retry, idempotent — overwrites with same
//     content),
//   - draft → active second,
//   - old active → archived last.
// Worst case is "two active docs" if the last step fails, which is recoverable
// (the newest one wins, an admin job can archive the older). The reverse order
// would risk "zero active docs", which breaks the read path.

const PUBLISH_ERRORS = Object.freeze({
  DRAFT_MISSING: "draft document not found",
  NOT_A_DRAFT: "document status is not 'draft'",
  OWNER_MISMATCH: "current active document has a different owner",
  SELF_PUBLISH: "draft and active document share the same id",
});

/**
 * Build a list of stats-migration updates to apply to artifacts of the new
 * draft document, sourced from the previous active document.
 *
 * Pure function — exported for tests.
 *
 * @param {Array<{id:string, content_hash?:string, stats?:object}>} oldArtifacts
 * @param {Array<{id:string, content_hash?:string}>} newArtifacts
 * @returns {Array<{artifactId:string, stats:object}>}
 */
export function buildStatsMigrationPlan(oldArtifacts, newArtifacts) {
  if (!Array.isArray(oldArtifacts) || !Array.isArray(newArtifacts)) return [];
  if (oldArtifacts.length === 0 || newArtifacts.length === 0) return [];

  // Index old artifacts by content_hash, keeping the most-fired one when several
  // share a hash (= keep the strongest learning signal across reformulations).
  const byHash = new Map();
  for (const a of oldArtifacts) {
    const h = a?.content_hash;
    if (!h) continue;
    const fires = a.stats?.fires ?? 0;
    const prev = byHash.get(h);
    if (!prev || fires > (prev.stats?.fires ?? 0)) byHash.set(h, a);
  }

  const plan = [];
  for (const n of newArtifacts) {
    const h = n?.content_hash;
    if (!h) continue;
    const match = byHash.get(h);
    if (!match) continue;
    plan.push({ artifactId: n.id, stats: match.stats || {} });
  }
  return plan;
}

/**
 * Validate that the current state allows publishing this draft.
 *
 * Pure function.
 *
 * @param {object|null} draft
 * @param {object|null} currentActive
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validatePublishTransition(draft, currentActive) {
  if (!draft) return { ok: false, error: PUBLISH_ERRORS.DRAFT_MISSING };
  if (draft.status !== "draft") return { ok: false, error: PUBLISH_ERRORS.NOT_A_DRAFT };
  if (currentActive) {
    if (draft.id === currentActive.id) {
      return { ok: false, error: PUBLISH_ERRORS.SELF_PUBLISH };
    }
    if (
      draft.owner_kind !== currentActive.owner_kind ||
      draft.owner_id !== currentActive.owner_id
    ) {
      return { ok: false, error: PUBLISH_ERRORS.OWNER_MISMATCH };
    }
  }
  return { ok: true };
}

/**
 * Publish a draft document.
 *
 * @param sb           Supabase client (or test stub).
 * @param documentId   id of the draft to publish.
 * @returns {Promise<{
 *   document?: object,
 *   archived_document_id?: string|null,
 *   stats_migrated?: number,
 *   error?: string,
 * }>}
 */
export async function publishDraft(sb, { documentId }) {
  // ── 1. Load draft ─────────────────────────────────────────────
  const { data: draft } = await sb
    .from("protocol_document")
    .select("id, status, version, owner_kind, owner_id")
    .eq("id", documentId)
    .single();

  // ── 2. Load current active for same owner ─────────────────────
  let currentActive = null;
  if (draft) {
    const { data } = await sb
      .from("protocol_document")
      .select("id, status, version, owner_kind, owner_id")
      .eq("owner_kind", draft.owner_kind)
      .eq("owner_id", draft.owner_id)
      .eq("status", "active")
      .maybeSingle();
    currentActive = data || null;
  }

  // ── 3. Validate ───────────────────────────────────────────────
  const check = validatePublishTransition(draft, currentActive);
  if (!check.ok) return { error: check.error };

  // ── 4. Stats migration (best-effort, before the doc flip) ────
  let statsMigrated = 0;
  if (currentActive) {
    statsMigrated = await migrateStats(sb, {
      fromDocumentId: currentActive.id,
      toDocumentId: draft.id,
    });
  }

  // ── 5. Flip draft → active ────────────────────────────────────
  const { data: activated, error: activateErr } = await sb
    .from("protocol_document")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", draft.id)
    .select("id, status, version, owner_kind, owner_id")
    .single();
  if (activateErr) return { error: "publish failed: could not flip draft to active" };

  // ── 6. Archive the previous active (if any) ───────────────────
  let archivedId = null;
  if (currentActive) {
    const { error: archiveErr } = await sb
      .from("protocol_document")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", currentActive.id);
    if (!archiveErr) archivedId = currentActive.id;
    // If archive failed: we now have two active docs for this owner.
    // The new one is the canonical winner (read path filters by status='active'
    // and orders by version DESC). Surfacing the failure is enough — caller may
    // alert; an admin/cron task can clean the stale active later.
  }

  return {
    document: activated,
    archived_document_id: archivedId,
    stats_migrated: statsMigrated,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function migrateStats(sb, { fromDocumentId, toDocumentId }) {
  const oldArtifacts = await loadDocumentArtifacts(sb, fromDocumentId);
  const newArtifacts = await loadDocumentArtifacts(sb, toDocumentId);
  const plan = buildStatsMigrationPlan(oldArtifacts, newArtifacts);

  let migrated = 0;
  for (const step of plan) {
    const { error } = await sb
      .from("protocol_artifact")
      .update({ stats: step.stats })
      .eq("id", step.artifactId);
    if (!error) migrated += 1;
  }
  return migrated;
}

async function loadDocumentArtifacts(sb, documentId) {
  // Two-hop fetch (no FK join in our minimal mock): sections of the doc, then
  // artifacts of those sections.
  const { data: sections } = await sb
    .from("protocol_section")
    .select("id")
    .eq("document_id", documentId);
  const sectionIds = (sections || []).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const { data: artifacts } = await sb
    .from("protocol_artifact")
    .select("id, source_section_id, content_hash, stats")
    .in("source_section_id", sectionIds);
  return artifacts || [];
}

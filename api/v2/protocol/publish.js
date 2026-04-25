// POST /api/v2/protocol/publish
//   body: { documentId: <uuid> }
//   → { document, archived_document_id, stats_migrated }
//
// Flips a draft `protocol_document` to active, archives the previous active
// version (if any), and migrates `stats` from the previous active artifacts
// onto the new ones whose `content_hash` matches. Heavy lifting lives in
// lib/protocol-v2-versioning.js (Task 4.5) — this endpoint is auth + I/O glue.
//
// Auth pattern : identique à api/v2/protocol.js / propositions.js / extract.js.
// Handler accepts an optional `deps` 3rd argument for test injection.

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";
import { publishDraft as _publishDraft } from "../../../lib/protocol-v2-versioning.js";
import { generateNarrative as _generateNarrative } from "../../../lib/protocol-v2-changelog-narrator.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    publishDraft = _publishDraft,
    generateNarrative = _generateNarrative,
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
  const { documentId } = body;
  if (!documentId || typeof documentId !== "string" || !UUID_RE.test(documentId)) {
    res.status(400).json({ error: "documentId is required (uuid)" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // Resolve doc → persona for access control.
  // Template publish is out of scope for Chunk 4 — only persona-owned docs.
  const personaId = await documentPersonaId(supabase, documentId);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Bind generateNarrative with the auth client so it can resolve API key
  // overrides per-tenant if relevant. The narrator returns
  // { narrative, brief } or { error } — publishDraft swallows errors and
  // records the publish event without narrative on failure.
  const narratorBound = ({ accepted, rejected, revised, version }) =>
    generateNarrative({
      client,
      accepted,
      rejected,
      revised,
      fromVersion: version > 1 ? version - 1 : undefined,
      toVersion: version,
    });

  const result = await publishDraft(supabase, {
    documentId,
    publishedBy: client?.id || null,
    generateNarrative: narratorBound,
  });
  if (result.error) {
    res.status(mapPublishErrorToStatus(result.error)).json({ error: result.error });
    return;
  }

  res.status(200).json({
    document: result.document,
    archived_document_id: result.archived_document_id,
    stats_migrated: result.stats_migrated,
    publish_event_id: result.publish_event_id,
  });
}

// Map publishDraft error strings (defined in lib/protocol-v2-versioning.js) to
// HTTP status codes. Anything unrecognised → 500.
function mapPublishErrorToStatus(error) {
  if (/not found|missing/i.test(error)) return 404;
  if (/not.*'draft'|status/i.test(error)) return 409;
  return 500;
}

async function documentPersonaId(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("owner_id, owner_kind")
    .eq("id", documentId)
    .single();
  if (error || !data || data.owner_kind !== "persona") return null;
  return data.owner_id;
}

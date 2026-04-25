// Protocol v2 — save section prose + run extractors inline.
//
// POST /api/v2/protocol/extract
//   body: { document_id: <uuid>, section_id: <uuid>, prose: <string> }
//   → { saved: true, candidates: [{ target_kind, intent, proposed_text,
//       rationale, confidence }] }
//
// Flow:
//   1. Auth (authenticateRequest + hasPersonaAccess sur persona du document).
//   2. UPDATE protocol_section.prose (assert section ∈ document).
//   3. Si PROTOCOL_V2_EXTRACTION === 'off' → renvoie candidates: [] sans LLM.
//   4. Sinon, route + extract le prose via le router (claude-haiku) et les
//      extracteurs (claude-sonnet, parallèle Promise.all). Timeout global
//      configurable, default 12s (laisse 3s de marge sur maxDuration=15).
//   5. Renvoie les candidats au front. Le front (Chunk 3) montre le diff,
//      l'utilisateur accepte/edit/reject — l'INSERT dans `proposition` se
//      fait via /api/v2/propositions { action: 'accept' } (Task 4.3).
//
// Cette endpoint NE persiste PAS dans `proposition`. Le drain via cron
// (scripts/feedback-event-to-proposition.js) reste la voie pour les signaux
// implicites. Cet endpoint sert uniquement le flow "édition prose section".
//
// Auth pattern : identique à api/v2/protocol.js et api/v2/propositions.js.
// Handler accepts an optional `deps` 3rd argument for test injection.

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";
import { routeAndExtract as _routeAndExtract } from "../../../lib/protocol-v2-extractor-router.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROSE_LEN = 20000;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 12000;

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
  const { document_id, section_id, prose } = body;

  if (!document_id || typeof document_id !== "string" || !UUID_RE.test(document_id)) {
    res.status(400).json({ error: "document_id is required (uuid)" });
    return;
  }
  if (!section_id || typeof section_id !== "string" || !UUID_RE.test(section_id)) {
    res.status(400).json({ error: "section_id is required (uuid)" });
    return;
  }
  if (typeof prose !== "string") {
    res.status(400).json({ error: "prose is required (string)" });
    return;
  }
  if (prose.length > MAX_PROSE_LEN) {
    res.status(400).json({ error: `prose too long (max ${MAX_PROSE_LEN} chars)` });
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
  const personaId = await documentPersonaId(supabase, document_id);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Validate section belongs to document, and capture its kind for context.
  const { data: section, error: secErr } = await supabase
    .from("protocol_section")
    .select("id, document_id, kind, heading")
    .eq("id", section_id)
    .single();
  if (secErr || !section) {
    res.status(404).json({ error: "section not found" });
    return;
  }
  if (section.document_id !== document_id) {
    res.status(403).json({ error: "section does not belong to document" });
    return;
  }

  // Save prose first — even if extraction fails, the user's edit is preserved.
  const { error: updErr } = await supabase
    .from("protocol_section")
    .update({ prose })
    .eq("id", section_id);
  if (updErr) {
    res.status(500).json({ error: "save failed" });
    return;
  }

  // Kill-switch (env or deps override).
  if (killSwitch === "off") {
    res.status(200).json({ saved: true, candidates: [] });
    return;
  }

  // Extract from the prose. The signal_type 'prose_edit' is a hint to the
  // router that the source is rich (not a noisy chat correction).
  const signal = {
    source_type: "prose_edit",
    source_text: prose,
    context: {
      section_kind: section.kind,
      section_heading: section.heading || undefined,
    },
  };

  let candidates = [];
  try {
    candidates = await raceWithTimeout(
      routeAndExtract(signal),
      extractionTimeoutMs,
      "extraction_timeout",
    );
  } catch (err) {
    // Don't fail the save when extraction times out / errors.
    res.status(200).json({
      saved: true,
      candidates: [],
      extraction_error: err?.message || "extraction_failed",
    });
    return;
  }

  const trimmed = (candidates || []).map((c) => ({
    target_kind: c.target_kind,
    intent: c.proposal.intent,
    proposed_text: c.proposal.proposed_text,
    rationale: c.proposal.rationale,
    confidence: c.proposal.confidence,
  }));

  res.status(200).json({ saved: true, candidates: trimmed });
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

function raceWithTimeout(promise, ms, errorMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms)),
  ]);
}

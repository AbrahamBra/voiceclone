// GET /api/v2/review-deck?persona_id=<uuid>
//   → text/markdown; charset=utf-8
//
// Spec : docs/superpowers/specs/2026-04-25-review-deck-v0-design.md
// Pure HTTP wrapper around lib/review-deck-builder.js. Auth pattern identical
// to api/v2/protocol/publish.js. `deps` 3rd argument enables test injection.

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";
import { buildReviewDeck as _buildReviewDeck } from "../../lib/review-deck-builder.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    buildReviewDeck = _buildReviewDeck,
  } = deps || {};

  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const personaId = req.query?.persona_id;
  if (!personaId || typeof personaId !== "string" || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona_id is required (uuid)" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const { markdown } = await buildReviewDeck(supabase, personaId);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.status(200).send(markdown);
  } catch (err) {
    if (err?.code === "NOT_FOUND_PERSONA") {
      res.status(404).json({ error: "Ce persona n'existe pas." });
      return;
    }
    if (err?.code === "NOT_FOUND_PROTOCOL") {
      res.status(404).json({ error: "Ce persona n'a pas encore de protocole." });
      return;
    }
    console.error(JSON.stringify({ event: "review_deck_error", persona_id: personaId, error: err?.message }));
    res.status(500).json({ error: "internal error" });
  }
}

// Protocol v2 — read-only endpoint.
//
// GET /api/v2/protocol?persona=<id>
//   → { document, sections: [{ ...s, artifacts: [...] }], pendingPropositionsCount }
//
// Auth: identical to api/protocol.js (authenticateRequest + hasPersonaAccess).
// Writes (save prose, accept proposition, publish) will come in chunks 2-4.
//
// Handler accepts an optional `deps` 3rd argument for test injection. In
// production Vercel calls handler(req, res) and real imports are used.

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  supabase as _supabase,
  hasPersonaAccess as _hasPersonaAccess,
  setCors as _setCors,
} from "../../lib/supabase.js";
import {
  getActiveDocument as _getActiveDocument,
  listSections as _listSections,
  listArtifacts as _listArtifacts,
  countPendingPropositions as _countPendingPropositions,
} from "../../lib/protocol-v2-db.js";

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    getActiveDocument = _getActiveDocument,
    listSections = _listSections,
    listArtifacts = _listArtifacts,
    countPendingPropositions = _countPendingPropositions,
  } = deps || {};

  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const personaId = req.query?.persona;
  if (!personaId) {
    res.status(400).json({ error: "persona is required" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const document = await getActiveDocument(supabase, personaId);
  if (!document) {
    // Persona without v2 document yet (backfill not run, or new persona).
    res.status(200).json({ document: null, sections: [], pendingPropositionsCount: 0 });
    return;
  }

  const sections = await listSections(supabase, document.id);
  const sectionsWithArtifacts = await Promise.all(
    sections.map(async (s) => ({
      ...s,
      artifacts: await listArtifacts(supabase, s.id, { activeOnly: true }),
    })),
  );
  const pendingPropositionsCount = await countPendingPropositions(supabase, document.id);

  res.status(200).json({
    document,
    sections: sectionsWithArtifacts,
    pendingPropositionsCount,
  });
}

// Map proposition.source → human-readable label avec contexte si dispo.
// Utilisé par les endpoints GET propositions et GET contradictions pour
// exposer source_summary aux composants D2 (treatment cockpit V2).
//
// Signature : summarizeSource(p, batchById)
//   p : proposition row (au moins { source, source_ref })
//   batchById : optional map { [batch_id]: { doc_filename, ... } } pour
//               résoudre upload_batch en filename humain. Si non fourni,
//               upload_batch fallback sur "doc importé".

export function summarizeSource(p, batchById = {}) {
  if (!p || !p.source) return null;
  if (p.source === "upload_batch") {
    if (p.source_ref && batchById[p.source_ref]) {
      return batchById[p.source_ref].doc_filename || "doc importé";
    }
    return "doc importé";
  }
  if (p.source === "feedback_event" || p.source === "chat_rewrite") return "Correction setter";
  if (p.source === "client_validation") return "Validation client";
  if (p.source === "agency_supervision") return "Supervision agency";
  if (p.source === "manual") return "Ajout manuel";
  if (p.source === "playbook_extraction") return "Extraction playbook";
  if (p.source === "learning_event") return "Apprentissage";
  if (p.source === "analytics_cron") return "Analyse auto";
  return p.source;
}

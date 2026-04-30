// Source-core taxonomy — migration 055.
//
// 6 universal lead-source categories shared across all clients of the agency.
// Per-setter instances (e.g. "Spyer Alec Henry") live as sections/artifacts
// inside the source-specific protocol_document, NOT as new enum values.
//
// Keep in lockstep with the CHECK constraint in supabase/055_protocol_source_core.sql
// and the SOURCE_CORE_VALUES set in api/chat.js.

/** @typedef {'visite_profil' | 'dr_recue' | 'interaction_contenu' | 'premier_degre' | 'spyer' | 'sales_nav'} SourceCoreId */

/** @type {Array<{ id: SourceCoreId, label: string, hint: string }>} */
export const SOURCE_CORES = [
  {
    id: "visite_profil",
    label: "Visite de profil",
    hint: "Le prospect est passé sur ton profil sans envoyer de demande.",
  },
  {
    id: "dr_recue",
    label: "Demande de connexion reçue",
    hint: "Inbound — le prospect t'a envoyé la demande.",
  },
  {
    id: "interaction_contenu",
    label: "Interaction contenu",
    hint: "Like, commentaire, partage sur un de tes posts.",
  },
  {
    id: "premier_degre",
    label: "1er degré",
    hint: "Connexion déjà acceptée, lead tiède.",
  },
  {
    id: "spyer",
    label: "Spyer",
    hint: "Outbound intercepté sur l'audience d'un compte tiers.",
  },
  {
    id: "sales_nav",
    label: "Sales Nav",
    hint: "Liste outbound froid issue de Sales Navigator.",
  },
];

const VALID_IDS = new Set(SOURCE_CORES.map((s) => s.id));

/**
 * @param {unknown} v
 * @returns {v is SourceCoreId}
 */
export function isSourceCoreId(v) {
  return typeof v === "string" && VALID_IDS.has(v);
}

/**
 * @param {string|null|undefined} id
 * @returns {{ id: SourceCoreId, label: string, hint: string } | null}
 */
export function findSourceCore(id) {
  if (!id) return null;
  return SOURCE_CORES.find((s) => s.id === id) || null;
}

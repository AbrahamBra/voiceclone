// Pipeline d'extraction : playbook source-specific (prose markdown) →
// propositions sur le doc protocole global, taggées avec la provenance
// (source_core + toggle_idx + toggle_title + playbook_id).
//
// Approche toggle-aware : on parse le markdown en toggles via
// playbook-parser.js (convention "## <N>. <TITRE>" sur 8/8 playbooks
// Nicolas), puis on appelle extractFromChunk (PR #222 single-call Sonnet
// tool_use, recall ~80%) sur chaque toggle plutôt que sur la prose entière.
//
// Pourquoi toggle-aware vs prose entière :
//   - Propositions situées ("issue de T2 Qualif/SWOT du playbook visite_profil")
//     → arbitrage UI lisible (vs 60 propositions toutes étiquetées "playbook visite_profil")
//   - La provenance toggle nourrit le signal de convergence après dédup
//     sémantique (ex : règle "max 6 lignes" trouvée en T2 de visite_profil
//     ET T2 de dr_recue ET T2 de interaction_contenu = doctrine commune
//     évidente, signal fort à l'arbitrage)
//   - Coût LLM : 6-7 appels Sonnet par playbook (un par toggle). Acceptable
//     car l'import d'un playbook est ponctuel, pas chaud.
//
// La dédup elle-même (proposition X arrive depuis 3 playbooks différents)
// est faite par les CALLERS via embedForProposition + findSimilarProposition
// (lib/protocol-v2-embeddings.js, threshold 0.85). Ce module ne fait que
// produire les candidats avec leur provenance — c'est le caller qui décide
// merge vs insert.

import { extractFromChunk as _extractFromChunk } from "./protocol-v2-doc-extractor.js";
import { parsePlaybookProse } from "./playbook-parser.js";

// Bornes héritées du doc-extractor (cf MIN_CHUNK_LEN/MAX_CHUNK_LEN dans
// lib/protocol-v2-doc-extractor.js). On filtre AVANT d'appeler pour économiser
// les API calls et logger proprement les toggles skipés.
const MIN_TOGGLE_LEN = 40;
const MAX_TOGGLE_LEN = 4000;

/**
 * Extract toggle-by-toggle and tag each candidate with playbook provenance.
 *
 * @param {object} args
 * @param {string} args.prose - markdown brut du playbook source (concaténation
 *                              de toutes les sections si le playbook en a plusieurs).
 * @param {string} args.sourceCore - 'visite_profil' | 'dr_recue' | … (cf source-core.js).
 * @param {string} args.playbookId - uuid du protocol_document source-specific.
 * @param {string} [args.docFilename] - filename pour le ctx du LLM (audit/log).
 * @param {object} [opts]
 * @param {Function} [opts.extractFromChunk] - injectable for tests.
 * @param {Function} [opts.onSkip] - callback({reason, toggle_idx, prose_len}) pour debug.
 * @returns {Promise<Array<{ target_kind: string, proposal: object, provenance: { source_core: string, toggle_idx: number, toggle_title: string, playbook_id: string } }>>}
 *          Liste plate des candidats extraits. Chaque entrée contient le même
 *          format `{target_kind, proposal}` que extractFromChunk + un champ
 *          `provenance` à plat (le caller fera la dédup et fabriquera le
 *          provenance.playbook_sources de la table proposition).
 */
export async function extractPlaybookToPropositions(args, opts = {}) {
  const { prose, sourceCore, playbookId, docFilename } = args || {};
  const extractFromChunk = opts.extractFromChunk || _extractFromChunk;
  const onSkip = opts.onSkip || (() => {});

  if (typeof prose !== "string" || !prose.trim()) {
    return [];
  }
  if (typeof sourceCore !== "string" || !sourceCore) {
    throw new Error("sourceCore is required");
  }
  if (typeof playbookId !== "string" || !playbookId) {
    throw new Error("playbookId is required");
  }

  const parsed = parsePlaybookProse(prose);
  if (parsed.toggles.length === 0) {
    return [];
  }

  const ctx = {
    doc_filename: docFilename || `playbook:${sourceCore}`,
    doc_kind: "operational_playbook",
  };

  // Extract toggle by toggle. Sequential plutôt que Promise.all pour ne pas
  // hammer la rate limit Sonnet (60s timeout par appel, 6-7 toggles ≈ 6-7
  // requêtes — séquentiel = ~1-3 min total acceptable pour un import).
  const allEnriched = [];
  for (const toggle of parsed.toggles) {
    const proseLen = toggle.prose?.length || 0;
    if (proseLen < MIN_TOGGLE_LEN) {
      onSkip({ reason: "toggle_too_short", toggle_idx: toggle.idx, prose_len: proseLen });
      continue;
    }
    if (proseLen > MAX_TOGGLE_LEN) {
      // Découpe naïve en sous-chunks de 4000 chars sur fin de paragraphe.
      // Préserve l'attribution au même toggle pour tous les sous-chunks.
      const subChunks = splitForExtractor(toggle.prose);
      for (const sub of subChunks) {
        const cands = await extractFromChunk(sub, ctx, {});
        for (const c of cands || []) {
          allEnriched.push({
            ...c,
            provenance: {
              source_core: sourceCore,
              toggle_idx: toggle.idx,
              toggle_title: toggle.title,
              playbook_id: playbookId,
            },
          });
        }
      }
      continue;
    }

    const cands = await extractFromChunk(toggle.prose, ctx, {});
    for (const c of cands || []) {
      allEnriched.push({
        ...c,
        provenance: {
          source_core: sourceCore,
          toggle_idx: toggle.idx,
          toggle_title: toggle.title,
          playbook_id: playbookId,
        },
      });
    }
  }

  return allEnriched;
}

/**
 * Découpe une prose trop longue (>4000 chars) en sous-chunks ≤4000.
 * Cherche des points de coupure naturels (double newline > simple newline >
 * espace) pour ne pas casser une phrase au milieu.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function splitForExtractor(text) {
  if (typeof text !== "string") return [];
  if (text.length <= MAX_TOGGLE_LEN) return [text];

  const out = [];
  let remaining = text;
  while (remaining.length > MAX_TOGGLE_LEN) {
    let cut = remaining.lastIndexOf("\n\n", MAX_TOGGLE_LEN);
    if (cut < MIN_TOGGLE_LEN) cut = remaining.lastIndexOf("\n", MAX_TOGGLE_LEN);
    if (cut < MIN_TOGGLE_LEN) cut = remaining.lastIndexOf(" ", MAX_TOGGLE_LEN);
    if (cut < MIN_TOGGLE_LEN) cut = MAX_TOGGLE_LEN;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length >= MIN_TOGGLE_LEN) {
    out.push(remaining);
  }
  return out;
}

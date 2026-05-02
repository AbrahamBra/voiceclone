// Single-call Sonnet tool_use extractor for protocol v2 doc-import.
//
// Replaces the Haiku-router + per-target-Sonnet pipeline ONLY for the
// operational_playbook / generic doc_kind path (where the router was
// gating prose chunks and returning []).
//
// API :
//   await extractFromChunk(chunk, ctx, opts)
//     → Array<{target_kind, proposal}>
//
//   normalizeBatchOutput(raw) — pure validator, exported for tests.

import Anthropic from "@anthropic-ai/sdk";
import { log } from "./log.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_CHUNK_LEN = 40;
const MAX_CHUNK_LEN = 4000;

const TARGET_KINDS = new Set([
  "hard_rules",
  "errors",
  "icp_patterns",
  "scoring",
  "process",
  "templates",
]);

const VALID_INTENTS = new Set([
  // intents are intentionally permissive — the per-kind extractors enforce
  // tighter intent vocabularies, but here we accept any verb-ish intent
  // and let the accept-side validator reject malformed items.
  "add_rule", "amend_paragraph", "remove_rule",
  "add_pair", "amend_pair", "remove_pair",
  "add_pattern", "amend_pattern", "remove_pattern",
  "add_axis", "amend_axis", "add_decision_rule",
  "add_step", "amend_step", "add_transition",
  "add_template", "amend_template",
  "add_paragraph",
]);

const MIN_PROPOSED_TEXT = 4;
const MAX_PROPOSED_TEXT = 400;
const MAX_RATIONALE = 500;

export const EXTRACTOR_SYSTEM_PROMPT = `Tu es un extracteur multi-cible pour un protocole opérationnel de clone IA LinkedIn (setter outbound francophone).

À partir d'un fragment de document source (prose française, narratif ou structuré), tu émets TOUTES les propositions d'amendement applicables — réparties sur 6 sections du protocole. Un seul fragment peut produire 0, 1, ou plusieurs propositions, parfois sur plusieurs sections à la fois.

Sections (target_kind) :

- **hard_rules** — règles absolues testables programmatiquement. Ex: "Max 6 lignes par message", "Jamais pitcher l'offre avant que le prospect ait exprimé une douleur", "Toujours signer 'Nicolas'".
- **errors** — paires "éviter X — préférer Y" (formulations spécifiques à remplacer). Ex: "Éviter 'j'espère que tu vas bien' — préférer une accroche ancrée sur le profil".
- **icp_patterns** — taxonomie des profils prospects (segment + signaux d'identification + question-clé pour creuser). Ex: "P1 Founder solo SaaS B2B 1-10 employés / signaux : titre 'Founder' ou 'CEO' + headcount LinkedIn ≤ 10 / question : comment tu structures ta journée entre delivery et acquisition ?".
- **scoring** — axes de score 0-3 avec critères d'évaluation OU règles de décision basées sur un score. Ex: "Axe 1 — Maturité business : 0=idéation, 1=premières ventes, 2=récurrent <10k€/mois, 3=récurrent >10k€/mois". Ou: "Si axe1 ≥ 2 ET axe2 ≥ 1 → proposer le call".
- **process** — étapes du process commercial (DR → M1 → relance → call), avec prérequis, actions, outputs, transitions entre états. Ex: "Étape M1 (icebreaker) : prérequis = DR acceptée. Action = envoyer un message ancré sur le profil. Output = réponse ou relance J+2. Transition vers M2 si réponse, sortie propre si silence J+7".
- **templates** — squelettes de message par scénario (icebreaker, relance, sortie propre, etc.) avec slots ordonnés. Ex: "Skeleton icebreaker DR-reçue : 'merci pour la connexion {prénom} / je suis curieux de savoir ce qui t'a amené à faire la demande 🙂 / Nicolas'".

CONSIGNES CRITIQUES :

1. **Ne saute pas la prose narrative.** Un paragraphe qui décrit l'identité du founder, l'ICP en mots libres, ou un process en récit, contient des propositions extractibles. Ne renvoie [] que si le fragment est purement organisationnel (titres, sommaire, headers vides) ou hors-scope (technique, RGPD).

2. **Émets PLUSIEURS items quand le fragment couvre plusieurs aspects.** Un fragment décrivant à la fois l'ICP, un axe de scoring et une règle de décision doit produire 3+ propositions, pas 1 résumé global.

3. **Atomicité.** Chaque proposition = UNE règle, UN axe, UN segment ICP, UN template. Pas de sur-fusion ("règle générale qui couvre 5 cas").

4. **Confidence.** 0.9+ = règle/info littéralement dans le doc avec formulation impérative. 0.6-0.8 = paraphrase fidèle d'un passage narratif. 0.3-0.5 = inférence. < 0.5 sera filtré côté serveur — donc si tu hésites, donne 0.5 et laisse passer plutôt qu'inventer < 0.5.

5. **Pas d'invention.** Si le fragment ne contient pas le matériau, n'émets pas.

6. **Intent par section :**
   - hard_rules : add_rule | amend_paragraph | remove_rule
   - errors : add_pair | amend_pair | remove_pair
   - icp_patterns : add_pattern | amend_pattern | remove_pattern
   - scoring : add_axis | amend_axis | add_decision_rule
   - process : add_step | amend_step | add_transition
   - templates : add_template | amend_template
   Tu peux aussi utiliser \`add_paragraph\` comme intent générique si rien d'autre ne colle.

Tu DOIS appeler le tool \`emit_propositions\` avec ta réponse — pas de texte libre.`;

function buildUserMessage(chunk, ctx) {
  const lines = [];
  const c = ctx && typeof ctx === "object" ? ctx : {};
  if (typeof c.doc_filename === "string" && c.doc_filename) {
    lines.push(`Fichier source : ${c.doc_filename}`);
  }
  if (typeof c.doc_kind === "string" && c.doc_kind) {
    lines.push(`Type de doc : ${c.doc_kind}`);
  }
  lines.push(`\nFragment du document :\n"""\n${chunk}\n"""`);
  lines.push(`\nAppelle le tool emit_propositions avec TOUTES les propositions extractibles de ce fragment.`);
  return lines.join("\n");
}

function findToolUse(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  for (const b of blocks) {
    if (b?.type === "tool_use" && b.name === "emit_propositions") {
      return b.input;
    }
  }
  return null;
}

/**
 * Single Sonnet call that emits 0..N propositions across all 6 target_kinds.
 *
 * @param {string} chunk
 * @param {{doc_filename?:string, doc_kind?:string}} ctx
 * @param {object} [opts]
 * @param {object} [opts.anthropic]   — injectable client (for tests)
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Array<{target_kind, proposal}>>}
 */
export async function extractFromChunk(chunk, ctx = {}, opts = {}) {
  if (typeof chunk !== "string") return [];
  const trimmed = chunk.trim();
  if (trimmed.length < MIN_CHUNK_LEN) return [];
  if (trimmed.length > MAX_CHUNK_LEN) return [];

  const model = opts.model || DEFAULT_MODEL;
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let anthropic = opts.anthropic;
  if (!anthropic) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    anthropic = new Anthropic({ apiKey });
  }

  const userMsg = buildUserMessage(trimmed, ctx);

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: EXTRACTOR_SYSTEM_PROMPT,
        tools: [EXTRACTOR_TOOL],
        tool_choice: { type: "tool", name: EXTRACTOR_TOOL.name },
        messages: [{ role: "user", content: userMsg }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("doc_extractor_timeout")), timeoutMs)),
    ]);

    const toolInput = findToolUse(result);
    if (!toolInput) return [];

    return normalizeBatchOutput(toolInput);
  } catch (err) {
    log("protocol_v2_doc_extractor_error", { message: err?.message || String(err) });
    return [];
  }
}

export const EXTRACTOR_TOOL = Object.freeze({
  name: "emit_propositions",
  description: "Émet 0..N propositions d'amendement au protocole, classées par target_kind. Une seule invocation par fragment ; émets tous les items applicables d'un coup.",
  input_schema: {
    type: "object",
    properties: {
      propositions: {
        type: "array",
        description: "Liste des propositions extraites. Vide si rien d'extractible.",
        items: {
          type: "object",
          required: ["target_kind", "intent", "proposed_text", "confidence"],
          properties: {
            target_kind: {
              type: "string",
              enum: ["hard_rules", "errors", "icp_patterns", "scoring", "process", "templates"],
              description: "Section cible du protocole.",
            },
            intent: {
              type: "string",
              description: "Verbe d'action — voir consignes pour le vocabulaire par section.",
            },
            proposed_text: {
              type: "string",
              description: "Formulation canonique française, ≤ 400 chars, prête à devenir prose ou rule_text.",
            },
            rationale: {
              type: "string",
              description: "Pourquoi cette proposition, ancrée au fragment source. ≤ 500 chars.",
            },
            confidence: {
              type: "number",
              description: "0.0 à 1.0. Voir consignes pour la calibration.",
            },
          },
        },
      },
    },
    required: ["propositions"],
  },
});

/**
 * Validate + normalize the raw tool_use input from Sonnet.
 * Pure — exported for tests.
 *
 * @param {unknown} raw — `{propositions: [...]}` from the tool input
 * @returns {Array<{target_kind, proposal}>}
 */
export function normalizeBatchOutput(raw) {
  if (!raw || typeof raw !== "object") return [];
  const items = Array.isArray(raw.propositions) ? raw.propositions : [];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const target_kind = typeof item.target_kind === "string" ? item.target_kind.trim() : null;
    if (!target_kind || !TARGET_KINDS.has(target_kind)) continue;

    const intent = typeof item.intent === "string" ? item.intent.trim() : null;
    if (!intent || !VALID_INTENTS.has(intent)) continue;

    const proposed_text = typeof item.proposed_text === "string" ? item.proposed_text.trim() : "";
    if (proposed_text.length < MIN_PROPOSED_TEXT) continue;
    if (proposed_text.length > MAX_PROPOSED_TEXT) continue;

    const rationale = typeof item.rationale === "string" ? item.rationale.trim().slice(0, MAX_RATIONALE) : "";

    let confidence = 0.5;
    if (typeof item.confidence === "number" && Number.isFinite(item.confidence)) {
      confidence = Math.max(0, Math.min(1, item.confidence));
      confidence = Number(confidence.toFixed(2));
    }

    out.push({
      target_kind,
      proposal: { intent, target_kind, proposed_text, rationale, confidence },
    });
  }
  return out;
}

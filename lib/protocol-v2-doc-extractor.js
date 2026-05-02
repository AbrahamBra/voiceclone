// Single-call Sonnet tool_use extractor for protocol v2 doc-import.
//
// Replaces the Haiku-router + per-target-Sonnet pipeline.
//
// Two operating modes :
//   - All-kinds (default) : enum target_kind covers the 6 sections. Used by
//     operational_playbook + generic doc_kinds (PR #222).
//   - Restricted : caller passes opts.allowedTargets ⊂ {6 kinds}. The tool
//     enum + prompt instruct Sonnet to ONLY emit those kinds. Used by
//     icp_audience + positioning doc_kinds (which previously routed to
//     runExtractors with explicit target list and produced 0 candidates).
//
// API :
//   await extractFromChunk(chunk, ctx, opts)
//     → Array<{target_kind, proposal}>
//
//   normalizeBatchOutput(raw, allowedTargets?) — pure validator, exported for tests.
//   buildExtractorTool(allowedTargets?) — returns the tool with restricted enum.
//   buildSystemPrompt(allowedTargets?) — returns the prompt mentioning only allowed sections.

import Anthropic from "@anthropic-ai/sdk";
import { log } from "./log.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
// 60s observed on Nicolas process-setter.md chunks (3 of 4 timed out at 30s with
// 6+ propositions each); raising headroom while still guarding tail latency.
const DEFAULT_TIMEOUT_MS = 60000;
const MIN_CHUNK_LEN = 40;
const MAX_CHUNK_LEN = 4000;

const ALL_TARGET_KINDS = ["hard_rules", "errors", "icp_patterns", "scoring", "process", "templates"];
const TARGET_KINDS_SET = new Set(ALL_TARGET_KINDS);

// MUST stay aligned with the DB CHECK constraint on proposition.intent
// (supabase/038_protocol_v2_core.sql:141-143). Items with non-allowed intents
// would fail the INSERT side and be silently lost.
const VALID_INTENTS = new Set([
  "add_paragraph",
  "amend_paragraph",
  "add_rule",
  "refine_pattern",
  "remove_rule",
]);

const MIN_PROPOSED_TEXT = 4;
const MAX_PROPOSED_TEXT = 400;
const MAX_RATIONALE = 500;

// Per-section descriptions used in the system prompt. Keys are target_kinds.
const SECTION_DESCRIPTIONS = {
  hard_rules: `- **hard_rules** — règles absolues testables programmatiquement. Ex: "Max 6 lignes par message", "Jamais pitcher l'offre avant que le prospect ait exprimé une douleur", "Toujours signer 'Nicolas'".`,
  errors: `- **errors** — paires "éviter X — préférer Y" (formulations spécifiques à remplacer). Ex: "Éviter 'j'espère que tu vas bien' — préférer une accroche ancrée sur le profil".`,
  icp_patterns: `- **icp_patterns** — taxonomie des profils prospects (segment + signaux d'identification + question-clé pour creuser). Ex: "P1 Founder solo SaaS B2B 1-10 employés / signaux : titre 'Founder' ou 'CEO' + headcount LinkedIn ≤ 10 / question : comment tu structures ta journée entre delivery et acquisition ?".`,
  scoring: `- **scoring** — axes de score 0-3 avec critères d'évaluation OU règles de décision basées sur un score. Ex: "Axe 1 — Maturité business : 0=idéation, 1=premières ventes, 2=récurrent <10k€/mois, 3=récurrent >10k€/mois". Ou: "Si axe1 ≥ 2 ET axe2 ≥ 1 → proposer le call".`,
  process: `- **process** — étapes du process commercial (DR → M1 → relance → call), avec prérequis, actions, outputs, transitions entre états. Ex: "Étape M1 (icebreaker) : prérequis = DR acceptée. Action = envoyer un message ancré sur le profil. Output = réponse ou relance J+2. Transition vers M2 si réponse, sortie propre si silence J+7".`,
  templates: `- **templates** — squelettes de message par scénario (icebreaker, relance, sortie propre, etc.) avec slots ordonnés. Ex: "Skeleton icebreaker DR-reçue : 'merci pour la connexion {prénom} / je suis curieux de savoir ce qui t'a amené à faire la demande 🙂 / Nicolas'".`,
};

// Per-section intent vocabulary used in the system prompt.
// Aligned with the DB CHECK constraint and the legacy per-target extractors
// (lib/protocol-v2-extractors/*.js). hard_rules has its own add_rule/remove_rule
// vocabulary ; the other 5 sections share the generic add/amend_paragraph
// (with refine_pattern as a finer ICP-only option).
const INTENT_VOCAB_BY_SECTION = {
  hard_rules: "add_rule | amend_paragraph | remove_rule",
  errors: "add_paragraph | amend_paragraph",
  icp_patterns: "add_paragraph | amend_paragraph | refine_pattern",
  scoring: "add_paragraph | amend_paragraph",
  process: "add_paragraph | amend_paragraph",
  templates: "add_paragraph | amend_paragraph",
};

/**
 * Normalize the allowedTargets input to a deduped array of valid target kinds.
 * If null/undefined/empty, returns ALL_TARGET_KINDS. Pure — exported for tests.
 *
 * @param {unknown} allowedTargets
 * @returns {string[]}
 */
export function resolveAllowedTargets(allowedTargets) {
  if (!Array.isArray(allowedTargets) || allowedTargets.length === 0) {
    return [...ALL_TARGET_KINDS];
  }
  const seen = new Set();
  const out = [];
  for (const t of allowedTargets) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!TARGET_KINDS_SET.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out : [...ALL_TARGET_KINDS];
}

/**
 * Build the system prompt for a given allowedTargets restriction.
 * If allowedTargets is null/undefined, mentions all 6 sections (back-compat).
 *
 * @param {string[]} [allowedTargets]
 * @returns {string}
 */
export function buildSystemPrompt(allowedTargets) {
  const allowed = resolveAllowedTargets(allowedTargets);
  const isRestricted = allowed.length < ALL_TARGET_KINDS.length;

  const sectionList = allowed.map((k) => SECTION_DESCRIPTIONS[k]).join("\n");
  const intentList = allowed.map((k) => `   - ${k} : ${INTENT_VOCAB_BY_SECTION[k]}`).join("\n");

  const intro = isRestricted
    ? `Tu es un extracteur ciblé pour un protocole opérationnel de clone IA LinkedIn (setter outbound francophone).

À partir d'un fragment de document source (prose française, narratif ou structuré), tu émets TOUTES les propositions d'amendement applicables — limitées à ${allowed.length} sections du protocole : ${allowed.join(", ")}. Un seul fragment peut produire 0, 1, ou plusieurs propositions sur ces sections.

⚠ Tu DOIS limiter target_kind à : ${allowed.map((k) => `"${k}"`).join(", ")}. Ignore tout autre type de matériau (règles d'écriture, templates, etc.) qui n'appartient pas à ces sections.`
    : `Tu es un extracteur multi-cible pour un protocole opérationnel de clone IA LinkedIn (setter outbound francophone).

À partir d'un fragment de document source (prose française, narratif ou structuré), tu émets TOUTES les propositions d'amendement applicables — réparties sur 6 sections du protocole. Un seul fragment peut produire 0, 1, ou plusieurs propositions, parfois sur plusieurs sections à la fois.`;

  return `${intro}

Sections (target_kind) :

${sectionList}

CONSIGNES CRITIQUES :

1. **Ne saute pas la prose narrative.** Un paragraphe qui décrit l'identité du founder, l'ICP en mots libres, ou un process en récit, contient des propositions extractibles. Ne renvoie [] que si le fragment est purement organisationnel (titres, sommaire, headers vides) ou hors-scope (technique, RGPD).

2. **Émets PLUSIEURS items quand le fragment couvre plusieurs aspects.** Un fragment décrivant à la fois ${allowed.length >= 2 ? "plusieurs aspects parmi les sections autorisées" : "plusieurs aspects de la section autorisée"} doit produire ${allowed.length}+ propositions, pas 1 résumé global.

3. **Atomicité.** Chaque proposition = UN élément unique (UNE règle, UN axe, UN segment ICP, UN template, UNE étape, UNE paire). Pas de sur-fusion ("règle générale qui couvre 5 cas").

4. **Confidence.** 0.9+ = info littéralement dans le doc avec formulation impérative. 0.6-0.8 = paraphrase fidèle d'un passage narratif. 0.3-0.5 = inférence. < 0.5 sera filtré côté serveur — donc si tu hésites, donne 0.5 et laisse passer plutôt qu'inventer < 0.5.

5. **Pas d'invention.** Si le fragment ne contient pas le matériau, n'émets pas.

6. **Intent par section :**
${intentList}
   Tu peux aussi utiliser \`add_paragraph\` comme intent générique si rien d'autre ne colle.

Tu DOIS appeler le tool \`emit_propositions\` avec ta réponse — pas de texte libre.`;
}

/**
 * Build the tool schema for a given allowedTargets restriction.
 * The enum on target_kind is restricted to the allowed list.
 *
 * @param {string[]} [allowedTargets]
 * @returns {object} frozen tool definition
 */
export function buildExtractorTool(allowedTargets) {
  const allowed = resolveAllowedTargets(allowedTargets);
  return Object.freeze({
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
                enum: [...allowed],
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
}

// All-kinds defaults — back-compat with PR #222 callers + tests.
export const EXTRACTOR_SYSTEM_PROMPT = buildSystemPrompt();
export const EXTRACTOR_TOOL = buildExtractorTool();

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
 * Single Sonnet call that emits 0..N propositions across the allowed target_kinds.
 *
 * @param {string} chunk
 * @param {{doc_filename?:string, doc_kind?:string}} ctx
 * @param {object} [opts]
 * @param {string[]} [opts.allowedTargets]   — restrict to subset of TARGET_KINDS. Default = all 6.
 * @param {object} [opts.anthropic]          — injectable client (for tests)
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
  const allowedTargets = resolveAllowedTargets(opts.allowedTargets);

  let anthropic = opts.anthropic;
  if (!anthropic) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    anthropic = new Anthropic({ apiKey });
  }

  const userMsg = buildUserMessage(trimmed, ctx);
  const systemPrompt = buildSystemPrompt(allowedTargets);
  const tool = buildExtractorTool(allowedTargets);

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: userMsg }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("doc_extractor_timeout")), timeoutMs)),
    ]);

    const toolInput = findToolUse(result);
    if (!toolInput) return [];

    return normalizeBatchOutput(toolInput, allowedTargets);
  } catch (err) {
    log("protocol_v2_doc_extractor_error", { message: err?.message || String(err) });
    return [];
  }
}

/**
 * Validate + normalize the raw tool_use input from Sonnet.
 * Pure — exported for tests.
 *
 * @param {unknown} raw — `{propositions: [...]}` from the tool input
 * @param {string[]} [allowedTargets] — if provided, drops items with target_kind ∉ allowedTargets
 * @returns {Array<{target_kind, proposal}>}
 */
export function normalizeBatchOutput(raw, allowedTargets) {
  if (!raw || typeof raw !== "object") return [];
  const items = Array.isArray(raw.propositions) ? raw.propositions : [];
  const allowed = resolveAllowedTargets(allowedTargets);
  const allowedSet = new Set(allowed);
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const target_kind = typeof item.target_kind === "string" ? item.target_kind.trim() : null;
    if (!target_kind || !TARGET_KINDS_SET.has(target_kind)) continue;
    if (!allowedSet.has(target_kind)) continue;

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

// ============================================================
// Operating protocol parser — extracts hard rules from an
// uploaded playbook document and upserts them into
// protocol_hard_rules.
//
// Runs async from api/cron-consolidate.js phase 3. Upload marks
// the protocol row as pending; the cron picks it up, calls Haiku
// tool-use, inserts rules with is_active=false on the parent
// operating_protocols row.
//
// Mirrors lib/graph-extraction-file.js pattern (Haiku + tool-use).
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";

const PARSER_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_CONTENT_SLICE = 30000;

const CHECK_KINDS = ["regex", "counter", "max_length", "structural"];
const COUNTER_WHAT = ["lines", "questions", "bullets"];
const STRUCTURAL_DENY = ["markdown_list", "offer_mention", "signature_complete"];
const SEVERITIES = ["hard", "strong", "light"];

const PARSER_PROMPT = `Tu es un extracteur de protocole opérationnel pour un agent LinkedIn setter.

Lis le document ci-dessous. Identifie UNIQUEMENT les RÈGLES ABSOLUES — énoncés impératifs ("jamais X", "toujours Y", "max N", "interdit de Z") qui doivent déclencher un blocage/réécriture avant envoi d'un message.

N'extrais PAS :
- Les conseils de tonalité ou de style général ("sois naturel", "écris en prose")
- Les descriptions d'étapes du process
- Les exemples de messages
- Les règles qui ne se testent pas programmatiquement (ex: "le message doit sembler spontané")

Pour chaque règle absolue détectée, remplis :
- rule_id : slug stable snake_case (ex: "never_two_questions", "max_eight_lines")
- description : formulation courte pour l'UI opérateur (≤ 80 chars)
- check_kind : l'un de {regex, counter, max_length, structural}
- check_params : paramètres machine (voir schéma de l'outil)
- source_quote : citation exacte du document (pour audit/debug)
- applies_to_scenarios : tableau de scénarios ['DM_1st'] si la règle ne s'applique qu'au premier message, sinon null

Exemples de mapping :
- "Jamais deux questions dans le même message" → counter {what:'questions', max:1}
- "Jamais plus de 8 lignes au total" → counter {what:'lines', max:8}
- "Jamais de liste à puces" → structural {deny:'markdown_list'}
- "Jamais de mention de l'offre, du prix, ou du mot 'accompagnement'" → regex {pattern:'\\\\b(offre|prix|accompagnement|euros?|€|tarif)\\\\b', flags:'i', max_matches:0}

Sois strict. Mieux vaut extraire 4 règles solides que 10 approximatives. Si aucune règle absolue testable, retourne has_rules:false.`;

const PARSER_TOOL = {
  name: "parse_operating_protocol",
  description: "Extract absolute blocking rules from an operating protocol document.",
  input_schema: {
    type: "object",
    properties: {
      has_rules: {
        type: "boolean",
        description: "false if the document contains no testable absolute rules.",
      },
      hard_rules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rule_id: { type: "string" },
            description: { type: "string" },
            check_kind: { type: "string", enum: CHECK_KINDS },
            check_params: {
              type: "object",
              description: "Shape depends on check_kind: regex={pattern,flags,max_matches}, counter={what,max}, max_length={chars}, structural={deny}",
            },
            source_quote: { type: "string" },
            applies_to_scenarios: {
              anyOf: [
                { type: "array", items: { type: "string" } },
                { type: "null" },
              ],
            },
            severity: { type: "string", enum: SEVERITIES, default: "hard" },
          },
          required: ["rule_id", "description", "check_kind", "check_params", "source_quote"],
        },
      },
      overall_confidence: {
        type: "number",
        description: "0-1, parser's self-assessment of extraction quality.",
      },
    },
    required: ["has_rules"],
  },
};

/**
 * Validate check_params shape matches check_kind. Returns null if invalid.
 * We're strict here because bad params will cause protocolChecks.js to throw
 * at runtime and we want to catch that at parse time.
 */
function validateCheckParams(kind, params) {
  if (!params || typeof params !== "object") return null;
  switch (kind) {
    case "regex": {
      if (typeof params.pattern !== "string" || !params.pattern) return null;
      const flags = typeof params.flags === "string" ? params.flags : "";
      const max_matches = Number.isInteger(params.max_matches) ? params.max_matches : 0;
      try { new RegExp(params.pattern, flags); } catch { return null; }
      return { pattern: params.pattern, flags, max_matches };
    }
    case "counter": {
      if (!COUNTER_WHAT.includes(params.what)) return null;
      if (!Number.isInteger(params.max) || params.max < 0) return null;
      return { what: params.what, max: params.max };
    }
    case "max_length": {
      if (!Number.isInteger(params.chars) || params.chars <= 0) return null;
      return { chars: params.chars };
    }
    case "structural": {
      if (!STRUCTURAL_DENY.includes(params.deny)) return null;
      return { deny: params.deny };
    }
    default:
      return null;
  }
}

/**
 * Normalize + filter the tool-use output before insertion.
 */
export function normalizeRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  const seen = new Set();
  const out = [];
  for (const r of rawRules) {
    if (!r || typeof r !== "object") continue;
    const rule_id = typeof r.rule_id === "string" ? r.rule_id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") : "";
    if (!rule_id || seen.has(rule_id)) continue;
    if (!CHECK_KINDS.includes(r.check_kind)) continue;
    const check_params = validateCheckParams(r.check_kind, r.check_params);
    if (!check_params) continue;
    const description = typeof r.description === "string" ? r.description.trim().slice(0, 200) : "";
    if (!description) continue;
    const source_quote = typeof r.source_quote === "string" ? r.source_quote.trim().slice(0, 500) : null;
    const applies_to_scenarios = Array.isArray(r.applies_to_scenarios) && r.applies_to_scenarios.length > 0
      ? r.applies_to_scenarios.filter(s => typeof s === "string")
      : null;
    const severity = SEVERITIES.includes(r.severity) ? r.severity : "hard";
    seen.add(rule_id);
    out.push({ rule_id, description, check_kind: r.check_kind, check_params, source_quote, applies_to_scenarios, severity });
  }
  return out;
}

/**
 * Parse an operating protocol document. Upserts hard rules on the
 * protocol row and marks status='parsed'. Activation is a separate
 * step (operator must click "Activate" in the UI).
 *
 * @param {string} protocolId - row id in operating_protocols
 * @param {string} content - raw document text
 * @param {object|null} client - client row for API key. Null = platform key.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.contentSlice]
 * @returns {Promise<{ count: number, debug: string }>}
 */
export async function parseOperatingProtocol(protocolId, content, client, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const contentSlice = opts.contentSlice ?? DEFAULT_CONTENT_SLICE;

  const apiKey = getApiKey(client);
  if (!apiKey) return { count: 0, debug: "no_api_key" };
  if (!content || content.length < 50) return { count: 0, debug: "content_too_short" };

  const anthropic = new Anthropic({ apiKey });
  const startMs = Date.now();

  const callPromise = anthropic.messages.create({
    model: PARSER_MODEL,
    max_tokens: 4096,
    system: PARSER_PROMPT,
    tools: [PARSER_TOOL],
    tool_choice: { type: "tool", name: "parse_operating_protocol" },
    messages: [{ role: "user", content: `Document :\n${content.slice(0, contentSlice)}` }],
  });
  const result = await Promise.race([
    callPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);

  const toolUse = result.content.find(b => b.type === "tool_use" && b.name === "parse_operating_protocol");
  console.log(JSON.stringify({
    event: "protocol_parse_raw",
    protocol: protocolId,
    stop_reason: result.stop_reason,
    ms: Date.now() - startMs,
    has_tool_use: !!toolUse,
  }));
  if (!toolUse) return { count: 0, debug: `no_tool_use: stop_reason=${result.stop_reason}` };

  const parsed = toolUse.input;
  const normalized = normalizeRules(parsed.hard_rules);

  // Always persist the raw parsed_json for audit even if normalization drops everything.
  await supabase
    .from("operating_protocols")
    .update({
      status: "parsed",
      parsed_json: parsed,
      parser_model: PARSER_MODEL,
      parser_confidence: typeof parsed.overall_confidence === "number" ? parsed.overall_confidence : null,
      parse_error: null,
      parse_attempted_at: new Date().toISOString(),
    })
    .eq("id", protocolId);

  if (!parsed.has_rules || normalized.length === 0) {
    return { count: 0, debug: "no_rules_extracted" };
  }

  // Upsert rules. Unique on (protocol_id, rule_id) — re-parse overwrites.
  const rows = normalized.map(r => ({
    protocol_id: protocolId,
    rule_id: r.rule_id,
    description: r.description,
    check_kind: r.check_kind,
    check_params: r.check_params,
    applies_to_scenarios: r.applies_to_scenarios,
    severity: r.severity,
    source_quote: r.source_quote,
  }));

  const { error: upsertError } = await supabase
    .from("protocol_hard_rules")
    .upsert(rows, { onConflict: "protocol_id,rule_id" });

  if (upsertError) {
    return { count: 0, debug: `upsert_error: ${upsertError.message}` };
  }

  return { count: rows.length, debug: `ok: ${rows.length} rules` };
}

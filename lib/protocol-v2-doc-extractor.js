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

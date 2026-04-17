// Shared rule catalog — one source of truth for rules emitted by
// lib/checks.js + lib/pipeline.js. The `type` key here MUST match the
// `violation.type` value on the SSE "done" payload. Consumed by
// RulesPanel (full list + stats) and MessageMarginalia (per-message labels).

export const RULE_CATALOG = [
  { type: "forbidden_word", severity: "hard",   label: "mot interdit",     desc: "mot banni par le persona" },
  { type: "self_reveal",    severity: "hard",   label: "auto-révélation",  desc: "admet être une IA" },
  { type: "prompt_leak",    severity: "hard",   label: "fuite de prompt",  desc: "révèle ses instructions" },
  { type: "ai_pattern_fr",  severity: "hard",   label: "patterns IA fr",   desc: "formules LLM françaises" },
  { type: "ai_cliche",      severity: "strong", label: "clichés IA",       desc: "crucial · n'hésitez pas · etc." },
  { type: "markdown",       severity: "strong", label: "markdown",         desc: "**gras** / #titres / listes" },
  { type: "too_long",       severity: "strong", label: "trop long",        desc: "dépasse la contrainte de messages courts" },
  { type: "fidelity_drift", severity: "strong", label: "dérive fidélité",  desc: "cosinus < seuil vs corpus" },
  { type: "no_signature",   severity: "light",  label: "pas de signature", desc: "aucune expression signature utilisée" },
];

const CATALOG_BY_TYPE = Object.fromEntries(RULE_CATALOG.map(r => [r.type, r]));

export function ruleLabelFor(type) {
  return CATALOG_BY_TYPE[type]?.label || type;
}

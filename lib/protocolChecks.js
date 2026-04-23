// ============================================================
// Protocol hard-rule runtime checks.
//
// Dispatches each active rule to a handler matching its check_kind.
// Returns the same {violations, shouldRewrite} shape as lib/checks.js
// so lib/pipeline.js can merge both without special-casing.
//
// Counters that look trivial (questions, lines, bullets) are still
// centralized here to keep one source of truth for the text-shape
// primitives — protocol rules reference them by name.
// ============================================================

const MARKDOWN_LIST_RE = /^\s*[-*•]\s|^\s*\d+[.)]\s/m;
// Signature "complete" = firstName LASTNAME on its own line, or multi-line
// signoff with fn/title/phone. Rough heuristic — protocol says "pas de
// signature complète", i.e. just first name is fine.
const SIGNATURE_COMPLETE_RE = /\n[A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ]{2,}|\n\s*(Cordialement|Bien à vous|Sincèrement)[\s\S]{0,200}$/i;

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

function countLines(text) {
  if (!text) return 0;
  // Count non-empty lines (wraps in messaging UIs render empty lines as gaps).
  return text.split(/\r?\n/).filter(l => l.trim().length > 0).length;
}

function countBullets(text) {
  return (text.match(/^\s*[-*•]\s|^\s*\d+[.)]\s/gm) || []).length;
}

function checkRegex(text, { pattern, flags, max_matches }) {
  let re;
  try { re = new RegExp(pattern, flags || "g"); } catch { return null; }
  // Force global flag so .match returns all hits.
  if (!re.flags.includes("g")) re = new RegExp(pattern, (flags || "") + "g");
  const matches = text.match(re) || [];
  if (matches.length > (max_matches ?? 0)) {
    return { exceeded: true, detail: matches.slice(0, 3).join(", ") };
  }
  return null;
}

function checkCounter(text, { what, max }) {
  let actual;
  switch (what) {
    case "questions": actual = countQuestions(text); break;
    case "lines":     actual = countLines(text); break;
    case "bullets":   actual = countBullets(text); break;
    default: return null;
  }
  if (actual > max) {
    return { exceeded: true, detail: `${what}=${actual} (max ${max})` };
  }
  return null;
}

function checkMaxLength(text, { chars }) {
  if (text.length > chars) {
    return { exceeded: true, detail: `${text.length} chars (max ${chars})` };
  }
  return null;
}

function checkStructural(text, { deny }) {
  switch (deny) {
    case "markdown_list":
      return MARKDOWN_LIST_RE.test(text) ? { exceeded: true, detail: "liste markdown détectée" } : null;
    case "signature_complete":
      return SIGNATURE_COMPLETE_RE.test(text) ? { exceeded: true, detail: "signature complète détectée" } : null;
    case "offer_mention":
      // offer_mention is semantically better handled via regex rules extracted
      // by the parser; this structural variant is a fallback catching common
      // tokens if the parser didn't emit a regex for the same rule.
      return /\b(offre|tarif|prix|euros?|€|accompagnement)\b/i.test(text)
        ? { exceeded: true, detail: "mention offre/prix détectée" } : null;
    default:
      return null;
  }
}

function scopeApplies(rule, scenario) {
  if (!rule.applies_to_scenarios || rule.applies_to_scenarios.length === 0) return true;
  if (!scenario) return false;
  return rule.applies_to_scenarios.includes(scenario);
}

/**
 * Run all active protocol hard rules against a generated response.
 * @param {string} text - Generated response text
 * @param {Array} rules - Active protocol_hard_rules rows
 * @param {object} [ctx] - { scenario?: string }
 * @returns {{ violations: Array, shouldRewrite: boolean }}
 */
export function checkProtocolRules(text, rules, ctx = {}) {
  const violations = [];
  if (!text || !Array.isArray(rules) || rules.length === 0) {
    return { violations, shouldRewrite: false };
  }

  for (const rule of rules) {
    if (!scopeApplies(rule, ctx.scenario)) continue;

    let result = null;
    switch (rule.check_kind) {
      case "regex":      result = checkRegex(text, rule.check_params); break;
      case "counter":    result = checkCounter(text, rule.check_params); break;
      case "max_length": result = checkMaxLength(text, rule.check_params); break;
      case "structural": result = checkStructural(text, rule.check_params); break;
    }
    if (!result) continue;

    const severity = rule.severity || "hard";
    violations.push({
      type: `protocol:${rule.rule_id}`,
      severity,
      detail: `${rule.description} — ${result.detail}`,
      rule_id: rule.rule_id,
      source_quote: rule.source_quote || null,
    });
  }

  const shouldRewrite = violations.some(v => v.severity === "hard");
  return { violations, shouldRewrite };
}

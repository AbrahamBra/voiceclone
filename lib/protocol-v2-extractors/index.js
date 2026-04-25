// Barrel module for protocol v2 extractors.
//
// Re-exports each per-target_kind extractor and exposes a unified
// EXTRACTORS map keyed by `target_kind` (matches protocol_section.kind).
//
// Used by lib/protocol-v2-extractor-router.js to dispatch a routed signal
// to the right extractor without import boilerplate.

import { extractHardRule, HARD_RULES_SYSTEM_PROMPT } from "./hard_rules.js";
import { extractError, ERRORS_SYSTEM_PROMPT } from "./errors.js";
import { extractPattern, PATTERNS_SYSTEM_PROMPT } from "./patterns.js";
import { extractScoring, SCORING_SYSTEM_PROMPT } from "./scoring.js";
import { extractProcess, PROCESS_SYSTEM_PROMPT } from "./process.js";
import { extractTemplate, TEMPLATES_SYSTEM_PROMPT } from "./templates.js";

export {
  extractHardRule,
  extractError,
  extractPattern,
  extractScoring,
  extractProcess,
  extractTemplate,
  HARD_RULES_SYSTEM_PROMPT,
  ERRORS_SYSTEM_PROMPT,
  PATTERNS_SYSTEM_PROMPT,
  SCORING_SYSTEM_PROMPT,
  PROCESS_SYSTEM_PROMPT,
  TEMPLATES_SYSTEM_PROMPT,
};

/**
 * Map from `target_kind` (protocol_section.kind enum) to its extractor function.
 * Note `icp_patterns` (the schema kind) maps to `extractPattern`.
 */
export const EXTRACTORS = Object.freeze({
  hard_rules: extractHardRule,
  errors: extractError,
  icp_patterns: extractPattern,
  scoring: extractScoring,
  process: extractProcess,
  templates: extractTemplate,
});

/**
 * Allowed target_kind values for proposition.target_kind / routing.
 * Note `identity` and `custom` are NOT extracted: identity is prose-only,
 * custom is free-form and must be authored manually.
 */
export const TARGET_KINDS = Object.freeze([
  "hard_rules",
  "errors",
  "icp_patterns",
  "scoring",
  "process",
  "templates",
]);

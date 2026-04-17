// ============================================================
// SANITIZE — neutralize user-controlled text before LLM prompt injection
// ============================================================

/**
 * Sanitize user-controlled text before it goes into an LLM prompt.
 * Defensive, not exhaustive — caps length, strips control chars, neutralizes
 * role/tag markers. Always surround the result with quotes + an untrusted-input
 * notice in the prompt.
 */
export function sanitizeUserText(str, maxLen = 1000) {
  if (typeof str !== "string") return "";
  let s = str;
  // Strip control chars except \n and \t
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  // Strip lone surrogates
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  // Neutralize XML/HTML role tags
  s = s.replace(/<\/?(system|user|assistant|human)[^>]*>/gi, "[tag]");
  // Neutralize "system:" / "user:" / "assistant:" role markers at line starts
  s = s.replace(/^\s*(system|user|assistant|human)\s*:/gim, "[$1 marker]:");
  // Collapse excessive whitespace
  s = s.replace(/\s{5,}/g, "    ").replace(/\n{4,}/g, "\n\n\n");
  if (s.length > maxLen) s = s.slice(0, maxLen) + "…";
  return s.trim();
}

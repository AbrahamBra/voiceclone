// Classifies a user follow-up message in a chat thread as "accept" or "correct"
// relative to the prior bot draft. Powers the symmetric implicit-correct signal
// that complements api/chat.js emitImplicitAccept (chantier 3 fuite #4 — chat
// libre où l'user dit "non" sans cliquer ↻ ni ouvrir le FeedbackPanel).
//
// Returns:
//   "correct" — first clause contains a strong negation marker (high
//               confidence the user is rejecting / amending the prior draft)
//   "accept"  — no negation marker (treat as implicit acceptance, same as today)
//   null      — empty/non-string input (no signal to emit)
//
// Bias : false positives over false negatives. Audit principle: capture more
// signal even at the cost of some noise, since the canal was leaking 75%+
// pre-fix. The drain pipeline dedups via embeddings (threshold 0.85) and
// confidence floors before any proposition becomes actionable, so noise here
// is absorbed downstream.

// Patterns that flip the verdict to "correct". All anchored at the start of
// the first clause to avoid mid-sentence false positives ("super. mais non" =
// accept). Each pattern has a comment explaining why it survived the
// false-positive vs false-negative trade-off.
const CORRECT_PATTERNS = [
  // "non" as opening word (common rejection : "non c'est pas ma voix")
  /^non\b/,
  // Negative collocations starting with "pas" / "c'est pas" / "ce n'est pas".
  // Exclude the positive expressions "pas mal" / "pas de souci" / "pas de pb".
  /^(c'est |ça )?(n'est |n')?pas (ma |mon |ce |cette |comme |du tout|le |la )/,
  /^ce n'est pas\b/,
  // Strong stop signals
  /^arrête\b/,
  /^stop\b/,
  /^refais\b/,
  // First-person owning the failure → user is correcting
  /^j'ai (dérapé|déraillé|merdé|raté)/,
];

export function classifyUserFollowup(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length < 2) return null;

  // First clause = up to first sentence terminator or 200 chars (whichever first).
  const firstClause = trimmed.split(/[.!?\n]/)[0].slice(0, 200);

  for (const re of CORRECT_PATTERNS) {
    if (re.test(firstClause)) return "correct";
  }
  return "accept";
}

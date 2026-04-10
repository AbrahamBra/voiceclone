// ============================================================
// INPUT VALIDATION — Request body validation for /api/chat
// ============================================================

export function validateInput(body) {
  const { scenario, messages, profileText } = body || {};

  if (!["free", "analyze"].includes(scenario)) {
    return "Invalid scenario: must be 'free' or 'analyze'";
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return "messages must be an array of 1-20 items";
  }

  for (const msg of messages) {
    if (!msg.role || !["user", "assistant"].includes(msg.role)) {
      return "Each message must have role 'user' or 'assistant'";
    }
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
      return "Each message content must be a non-empty string under 10000 chars";
    }
  }

  if (profileText !== undefined && (typeof profileText !== "string" || profileText.length > 20000)) {
    return "profileText must be a string under 20000 chars";
  }

  return null;
}

export function validateInput(body) {
  const { message, history, scenario, conversation_id } = body || {};

  if (typeof message !== "string" || message.length === 0 || message.length > 50000) {
    return "message must be a non-empty string under 50000 chars";
  }

  if (typeof scenario !== "string" || scenario.length === 0) {
    return "scenario is required";
  }

  // conversation_id present: skip history validation (server loads from DB)
  if (conversation_id) {
    if (typeof conversation_id !== "string" || conversation_id.length === 0) {
      return "conversation_id must be a non-empty string";
    }
    return null;
  }

  // No conversation_id: history is optional (new conversation with empty history)
  if (history !== undefined) {
    if (!Array.isArray(history)) {
      return "history must be an array";
    }
    if (history.length > 20) {
      return "history must contain at most 20 messages";
    }
    for (const msg of history) {
      if (!msg.role || !["user", "assistant"].includes(msg.role)) {
        return "Each history message must have role 'user' or 'assistant'";
      }
      if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 50000) {
        return "Each history message content must be a non-empty string under 50000 chars";
      }
    }
  }

  return null;
}

export function validateInput(body) {
  const { message, history, scenario } = body || {};

  if (typeof message !== "string" || message.length === 0 || message.length > 10000) {
    return "message must be a non-empty string under 10000 chars";
  }

  if (typeof scenario !== "string" || scenario.length === 0) {
    return "scenario is required";
  }

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
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
      return "Each history message content must be a non-empty string under 10000 chars";
    }
  }

  return null;
}

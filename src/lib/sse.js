import { authHeaders } from "./api.js";

const MAX_RETRIES = 5;
const MAX_BACKOFF = 15000;

export async function streamChat(params, callbacks, retryCount = 0) {
  const { message, scenario, scenarioType, personaId, conversationId } = params;
  const { onDelta, onThinking, onRewriting, onClear, onDone, onConversation, onError, onHeat } = callbacks;

  let resp;
  try {
    resp = await fetch("/api/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message,
        scenario,
        // Sprint 0.b dual-write : canonical enum value (may be undefined).
        // Backend writes it to conversations.scenario_type on new-conv create.
        scenario_type: scenarioType || undefined,
        persona: personaId,
        conversation_id: conversationId || undefined,
      }),
    });
  } catch {
    return handleNetworkError(params, callbacks, retryCount);
  }

  if (resp.status === 429) {
    onError?.("rate_limit");
    return;
  }
  if (resp.status === 402) {
    onError?.("budget");
    return;
  }
  if (resp.status >= 400 && resp.status < 500) {
    // Client errors (400, 403, 404) — don't retry, show error
    try {
      const body = await resp.json();
      callbacks.onError?.("failed", body.error || "Erreur");
    } catch {
      callbacks.onError?.("failed");
    }
    return;
  }
  if (!resp.ok) {
    return handleNetworkError(params, callbacks, retryCount);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedData = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "delta") receivedData = true;
          switch (evt.type) {
            case "delta": onDelta?.(evt.text); break;
            case "thinking": onThinking?.(); break;
            case "rewriting": onRewriting?.(evt.attempt || 1); break;
            case "clear": onClear?.(); break;
            case "done": onDone?.(evt); break;
            case "conversation": onConversation?.(evt.id); break;
            case "heat": onHeat?.(evt); break;
            case "error": onError?.("server", evt.message); break;
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } catch {
    // Only retry if we haven't received any data yet — retrying after
    // partial data would re-send the message and create duplicates
    if (!receivedData) {
      return handleNetworkError(params, callbacks, retryCount);
    }
    onError?.("disconnected");
  }
}

function handleNetworkError(params, callbacks, retryCount) {
  if (retryCount >= MAX_RETRIES) {
    callbacks.onError?.("failed");
    return;
  }
  callbacks.onError?.("reconnecting", retryCount);
  const delay = Math.min(1000 * Math.pow(2, retryCount), MAX_BACKOFF);
  return new Promise((resolve) => {
    setTimeout(() => resolve(streamChat(params, callbacks, retryCount + 1)), delay);
  });
}

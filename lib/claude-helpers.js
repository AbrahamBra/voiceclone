import Anthropic from "@anthropic-ai/sdk";
import { getApiKey } from "./supabase.js";

/**
 * Race a Claude messages.create call against a timeout.
 * Returns the full message, or throws the underlying error / "timeout".
 *
 * Factored out of feedback-detect.js where the same Promise.race pattern
 * was duplicated across 4 detectors. Keep the signature close to the SDK's.
 */
export async function callClaudeWithTimeout({
  client,
  model = "claude-haiku-4-5-20251001",
  max_tokens,
  system,
  messages,
  timeoutMs = 10000,
  timeoutLabel = "timeout",
}) {
  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  return Promise.race([
    anthropic.messages.create({ model, max_tokens, system, messages }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs),
    ),
  ]);
}

/**
 * Extract the first JSON object from Claude's text output.
 * Returns null if no object found or parse fails.
 */
export function parseJsonFromText(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

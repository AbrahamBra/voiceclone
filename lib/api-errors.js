// ============================================================
// API ERROR HELPER — sanitise 500 responses, log server-side
// Prevents err.message (SQL / Supabase internals) leaking to clients.
// Usage:
//   import { respondServerError } from "../lib/api-errors.js";
//   catch (err) { respondServerError(res, "chat_error", err, "Erreur de generation"); }
// ============================================================

import { log } from "./log.js";
import { captureError } from "./sentry.js";

/**
 * Log the full error server-side, return a generic message to the client.
 * @param {object} res - Node/Vercel response
 * @param {string} context - short event name used for logs/alerts (e.g. "chat_error")
 * @param {Error|unknown} err - the caught error
 * @param {string} publicMessage - generic message returned to the client
 * @param {object} bodyExtra - optional extra fields to merge into the response body (e.g. durationMs)
 */
export function respondServerError(res, context, err, publicMessage = "Erreur serveur", bodyExtra = {}) {
  const errorMessage = err?.message || (typeof err === "string" ? err : "unknown");
  log("api_error", {
    context,
    errorMessage,
    stack: err?.stack || null,
  });
  captureError(err, { context });
  if (res?.headersSent) return;
  res.status(500).json({ error: publicMessage, ...bodyExtra });
}

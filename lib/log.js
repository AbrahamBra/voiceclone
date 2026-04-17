/**
 * Structured JSON logger. Single sink for telemetry events so we can
 * centralise filtering, sampling, or redirection to a backend later.
 *
 * Usage:
 *   import { log } from "./log.js";
 *   log("chat_complete", { persona, totalMs });
 */

const SILENT = process.env.LOG_SILENT === "1";

export function log(event, data = {}) {
  if (SILENT) return;
  try {
    console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...data }));
  } catch {
    console.log(JSON.stringify({ event, ts: new Date().toISOString(), error: "log_serialize_failed" }));
  }
}

/**
 * Learning events writer — chronological trace of what the clone learned.
 *
 * Non-critical: failures are logged but never throw. The main pipeline must
 * never be blocked by analytics writes.
 */

import { supabase } from "./supabase.js";
import { log } from "./log.js";

/**
 * Log a learning event. Best-effort — swallows errors.
 * @param {string} personaId    user-facing persona id (not intellId)
 * @param {string} eventType    see supabase/017_learning_events.sql for taxonomy
 * @param {object} payload      event-specific data (jsonb)
 * @param {object} [snapshots]  optional fidelity/collapse snapshots
 * @param {number} [snapshots.fidelity_before]
 * @param {number} [snapshots.fidelity_after]
 * @param {number} [snapshots.collapse_before]
 * @param {number} [snapshots.collapse_after]
 */
export async function logLearningEvent(personaId, eventType, payload = {}, snapshots = {}) {
  if (!supabase || !personaId || !eventType) return;
  try {
    await supabase.from("learning_events").insert({
      persona_id: personaId,
      event_type: eventType,
      payload,
      fidelity_before: snapshots.fidelity_before ?? null,
      fidelity_after: snapshots.fidelity_after ?? null,
      collapse_before: snapshots.collapse_before ?? null,
      collapse_after: snapshots.collapse_after ?? null,
    });
  } catch (err) {
    log("learning_event_write_error", {
      persona: personaId,
      type: eventType,
      error: err.message || "unknown",
    });
  }
}

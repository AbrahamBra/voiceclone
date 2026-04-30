/**
 * Decay rule for protocol_v2 artifacts. Mirrors the philosophy of
 * lib/correction-decay.js but adapted to artifacts:
 *
 * Why decay artifacts at all?
 * Without decay, a doctrine grows monotonically — every learning that
 * was ever extracted stays active forever, even if it never fires again
 * (irrelevant) or was a noisy one-shot (wrong). Over months that pollutes
 * the prompt token budget and dilutes the signal of the real recurring
 * patterns. The corrections table already has decay (migration 016 +
 * lib/correction-decay.js, 120-day window); artifacts had none.
 *
 * Decay rule (an artifact is "stale" iff ALL of these hold) :
 *   - is_manual_override = false (operator-set rules never decay — explicit
 *     intent overrides activity heuristics)
 *   - severity != "hard" (hard checks encode safety; never decay behind
 *     the operator's back)
 *   - created_at older than STALE_AFTER_DAYS
 *   - stats.last_fired_at is null OR older than STALE_AFTER_DAYS
 *
 * Rationale on the AND between created_at AND last_fired_at: a brand-new
 * artifact has not had time to fire yet — we only decay things that had
 * a chance to prove themselves and didn't.
 */

export const STALE_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

function olderThanDays(timestamp, days, now) {
  if (!timestamp) return null; // caller decides how to handle null
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return null;
  return now - t > days * DAY_MS;
}

/**
 * @param {object} artifact must include: created_at, stats, severity,
 *   is_manual_override.
 * @param {{ now?: number, staleAfterDays?: number }} [opts]
 * @returns {boolean}
 */
export function isStaleArtifact(artifact, opts = {}) {
  if (!artifact) return false;
  const { now = Date.now(), staleAfterDays = STALE_AFTER_DAYS } = opts;

  if (artifact.is_manual_override) return false;
  if (artifact.severity === "hard") return false;

  const createdOld = olderThanDays(artifact.created_at, staleAfterDays, now);
  if (!createdOld) return false;

  const lastFired = artifact?.stats?.last_fired_at;
  if (!lastFired) return true; // never fired AND old enough → stale
  const lastFiredOld = olderThanDays(lastFired, staleAfterDays, now);
  return lastFiredOld === true;
}

/**
 * @param {Array<object>} artifacts
 * @param {{ now?: number, staleAfterDays?: number }} [opts]
 * @returns {{ active: Array<object>, decayed: Array<object> }}
 */
export function partitionByDecay(artifacts, opts = {}) {
  const active = [];
  const decayed = [];
  for (const a of artifacts || []) {
    if (isStaleArtifact(a, opts)) decayed.push(a);
    else active.push(a);
  }
  return { active, decayed };
}

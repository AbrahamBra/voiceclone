// Feature flag for the Chunk 3 new Protocol UI rollout.
//
// Controlled by the env var NEW_PROTOCOL_UI_PERSONAS — a comma-separated
// list of persona UUIDs allowed to see the new Doctrine + Registre UI.
// Special value "*" enables it for everyone (use only in preview / staging).
//
// Empty / unset → disabled for everyone (production-safe default).
//
// Used by:
//   - api/v2/protocol/* endpoints (server-side gate)
//   - ProtocolPanel.svelte shim (Task 3.7) to choose old vs new UI

const ENV_VAR = "NEW_PROTOCOL_UI_PERSONAS";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseList(raw) {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Is the new Protocol UI enabled for this persona?
 *
 * @param {string} personaId - The persona UUID to check.
 * @param {object} [opts]
 * @param {string} [opts.envValue] - Override env (tests). Defaults to process.env.NEW_PROTOCOL_UI_PERSONAS.
 * @returns {boolean}
 */
export function isNewProtocolUiEnabled(personaId, opts = {}) {
  const raw = opts.envValue !== undefined ? opts.envValue : process.env[ENV_VAR];
  const list = parseList(raw);

  if (list.length === 0) return false;
  if (list.includes("*")) return true;
  if (typeof personaId !== "string" || !UUID_RE.test(personaId)) return false;
  return list.includes(personaId);
}

/**
 * Returns the raw whitelist (parsed) for telemetry / debug surfaces.
 *
 * @param {object} [opts]
 * @param {string} [opts.envValue]
 * @returns {{ wildcard: boolean, personaIds: string[] }}
 */
export function getNewProtocolUiWhitelist(opts = {}) {
  const raw = opts.envValue !== undefined ? opts.envValue : process.env[ENV_VAR];
  const list = parseList(raw);
  return {
    wildcard: list.includes("*"),
    personaIds: list.filter((s) => s !== "*" && UUID_RE.test(s)),
  };
}

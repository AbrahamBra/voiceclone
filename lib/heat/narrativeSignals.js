/**
 * Narrative signal extraction for the Heat Thermometer.
 *
 * Pure function. No IO. Reads existing prospect_heat rows + the conversation's
 * message history, emits human-readable signal objects (label + quote + delta)
 * that explain why the heat moved.
 *
 * See: docs/superpowers/specs/2026-04-18-thermometre-rail-design.md
 *
 * @typedef {"pos"|"neg"} Polarity
 *
 * @typedef {object} NarrativeSignal
 * @property {string} kind                     Rule key — see rule table in spec
 * @property {string} label                    Short FR string displayed as <strong>
 * @property {string} quote                    Citation snippet (max 120 chars, word-bounded)
 * @property {Polarity} polarity
 * @property {number} delta                    Absolute value used for display
 * @property {string} when                     ISO timestamp of the triggering message
 * @property {string|null} message_id          Triggering message id (null for ghost/relance spans)
 *
 * @param {object} input
 * @param {Array<{id: string, role: "bot"|"user", content: string, created_at: string|Date}>} input.messages
 *   Ordered by created_at ASC.
 * @param {Array<{message_id: string, heat: number, delta: number|null, signals: object, created_at: string|Date}>} input.heatRows
 *   All prospect_heat rows for this conversation, ordered by created_at ASC.
 * @param {Date} [input.now=new Date()]
 * @param {number} [input.limit=8]
 * @returns {{signals: NarrativeSignal[], total: number}}
 */

/**
 * Derive the zone label + direction from a heat value and its delta.
 * @param {number|null} heat
 * @param {number|null} delta
 * @returns {{state: string|null, direction: string|null}}
 */
export function deriveState(heat, delta) {
  if (heat == null) return { state: null, direction: null };

  let state;
  if (heat < 0.25) state = "glacé";
  else if (heat < 0.45) state = "froid";
  else if (heat < 0.65) state = "tiède";
  else if (heat < 0.85) state = "chaud";
  else state = "brûlant";

  let direction;
  if (delta == null) direction = "stable";
  else if (delta > 0.03) direction = "montant";
  else if (delta < -0.03) direction = "descendant";
  else direction = "stable";

  return { state, direction };
}

// Lexical patterns — shared intent with prospectHeat.js (negative engagement).
const LEX_NEG = /\b(pas le temps|peut-?être|plus tard|pas intéressé|pas interesse|pas pour moi|je passe|non merci|stop|pas besoin|déjà|deja|on verra|je regarderai)\b/i;

const QUOTE_MAX = 120;

function truncateQuote(text, max = QUOTE_MAX) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 40 ? slice.slice(0, lastSpace) : slice) + "…";
}

/**
 * Extract a cold_lexical signal from a single prospect message, if its text
 * contains a negative-engagement phrase.
 * @returns {NarrativeSignal|null}
 */
function detectColdLexical(msg, heatRow) {
  if (msg.role !== "user") return null;
  const m = msg.content.match(LEX_NEG);
  if (!m) return null;
  const delta = heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.10;
  return {
    kind: "cold_lexical",
    label: "Verbalise refus/report",
    quote: truncateQuote(msg.content),
    polarity: "neg",
    delta,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

export function extract({ messages = [], heatRows = [], now = new Date(), limit = 8 } = {}) {
  if (messages.length === 0) {
    return { signals: [], total: 0 };
  }

  const heatByMsg = new Map(heatRows.map(r => [r.message_id, r]));
  const raw = [];

  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const heatRow = heatByMsg.get(msg.id);
    const cold = detectColdLexical(msg, heatRow);
    if (cold) raw.push(cold);
  }

  const sorted = raw.sort((a, b) => new Date(b.when) - new Date(a.when));
  return { signals: sorted.slice(0, limit), total: raw.length };
}

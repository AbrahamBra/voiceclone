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

// ── Lexical + pattern fragments ──────────────────────────────────────────
const RE_CALL_KEYWORD = /\b(call|visio|appel|rdv|discuter)\b/i;
const RE_ACCEPT = /\b(oui|carrément|carrement|yes|ok|d'accord|d accord|avec plaisir|pas de soucis|pas de souci|why not)\b/i;
const RE_PROPOSE_CALL = /\b(de vive voix|bloque.* (?:visio|agenda|créneau|creneau|rdv|call)|on peut (?:en )?(?:discuter|échanger|echanger) (?:de vive voix|autour d'un call)?|je suis disponible|on se cale un? (?:call|visio|rdv)|bloquer? dans les agendas|prendre.* créneau|je te propose un (?:call|rdv))\b/i;
const RE_EMAIL = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i;
const RE_BOOKS_SLOT = /\b(?:j'ai booké|c'est booké|c'est tout bon|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}(?:\b|[h:])|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)[^.?!]*\b(?:à|a)\s?\d{1,2}[h:]\d{0,2}|le \d{1,2}[^.?!]*\d{1,2}[h:])/i;

function detectAcceptCall(msg, prevBotContent, heatRow) {
  if (msg.role !== "user") return null;
  if (!RE_ACCEPT.test(msg.content)) return null;
  if (!prevBotContent || !RE_CALL_KEYWORD.test(prevBotContent)) return null;
  return {
    kind: "accept_call",
    label: "Accepte le call",
    quote: truncateQuote(msg.content.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.20,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectProposeCall(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (!RE_PROPOSE_CALL.test(msg.content)) return null;
  const m = msg.content.match(RE_PROPOSE_CALL);
  return {
    kind: "propose_call",
    label: "Propose le call elle-même",
    quote: truncateQuote(m ? msg.content.slice(Math.max(0, m.index - 10)) : msg.content),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.25,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectGivesEmail(msg, heatRow) {
  if (msg.role !== "user") return null;
  const m = msg.content.match(RE_EMAIL);
  if (!m) return null;
  const email = m[1];
  const masked = email.replace(/^(.{2}).*(@.*)$/, "$1…$2");
  return {
    kind: "gives_email",
    label: "Donne son email",
    quote: masked,
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.15,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

const LEX_POS = /\b(intéressant|interessant|super|parfait|curieux|ok|top|nice|carrément|carrement|avec plaisir|en effet)\b/i;
const BUSINESS_TERMS = /\b(client|équipe|equipe|biz|marché|marche|portfolio|boîte|boite|saas|startup|produit|chiffre|CA|revenu|mission|prestation|presta|secteur|vertical|cible)\b/i;
const CURIOSITY = /\b(comment|pourquoi|qu'est-ce que|tu peux m'en dire plus|dis-m'en plus|raconte|tu penses que)\b/i;

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function firstSentence(text, max = QUOTE_MAX) {
  const stop = text.search(/[.!?]/);
  const s = (stop === -1 ? text : text.slice(0, stop + 1)).trim();
  return truncateQuote(s, max);
}

function detectBusinessContext(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (wordCount(msg.content) < 30) return null;
  if (!BUSINESS_TERMS.test(msg.content)) return null;
  return {
    kind: "business_context",
    label: "Détaille son contexte",
    quote: firstSentence(msg.content),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.15,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectPositiveInterest(msg, heatRow, alreadyMatched) {
  if (msg.role !== "user") return null;
  if (alreadyMatched) return null;
  const m = msg.content.match(LEX_POS);
  if (!m) return null;
  const heatSignals = heatRow?.signals || {};
  if (heatSignals.lexical != null && heatSignals.lexical < 0.75) return null;
  const sentences = msg.content.split(/(?<=[.!?])\s+/);
  const matched = sentences.find(s => LEX_POS.test(s)) || m[0];
  return {
    kind: "positive_interest",
    label: "Verbalise intérêt",
    quote: truncateQuote(matched.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.10,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectQuestionBack(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (!msg.content.trim().endsWith("?")) return null;
  if (!CURIOSITY.test(msg.content)) return null;
  const sentences = msg.content.split(/(?<=[.!?])\s+/);
  const lastQ = [...sentences].reverse().find(s => s.trim().endsWith("?")) || msg.content;
  return {
    kind: "question_back",
    label: "Pose une question en retour",
    quote: truncateQuote(lastQ.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.10,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectBooksSlot(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (!RE_BOOKS_SLOT.test(msg.content)) return null;
  return {
    kind: "books_slot",
    label: "Confirme un créneau",
    quote: truncateQuote(msg.content.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.20,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

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
  if (messages.length === 0) return { signals: [], total: 0 };

  const heatByMsg = new Map(heatRows.map(r => [r.message_id, r]));
  const raw = [];

  let prevBotContent = "";
  for (const msg of messages) {
    if (msg.role === "bot") {
      prevBotContent = msg.content;
      continue;
    }
    const heatRow = heatByMsg.get(msg.id);

    const candidates = [];
    const push = (s) => { if (s) candidates.push(s); };
    push(detectBooksSlot(msg, heatRow));
    push(detectAcceptCall(msg, prevBotContent, heatRow));
    push(detectProposeCall(msg, heatRow));
    push(detectGivesEmail(msg, heatRow));
    push(detectQuestionBack(msg, heatRow));
    push(detectBusinessContext(msg, heatRow));
    push(detectColdLexical(msg, heatRow));
    push(detectPositiveInterest(msg, heatRow, candidates.length > 0));

    for (const c of candidates) raw.push(c);
  }

  const sorted = raw.sort((a, b) => new Date(b.when) - new Date(a.when));
  return { signals: sorted.slice(0, limit), total: raw.length };
}

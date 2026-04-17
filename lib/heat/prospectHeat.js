/**
 * Prospect heat — signal business implicite.
 * Calculé à chaque message prospect entrant (role='user' en DB).
 * heat ∈ [0, 1]. 0 = froid/absent, 1 = chaud, engagé, prêt à convertir.
 *
 * Combine :
 *   - longueur réponse (norm, saturée à 50 mots)
 *   - ratio questions/affirmations (curiosité active)
 *   - recency (délai de réponse vs message précédent du clone)
 *   - lexique engagement positif vs froid
 *   - trend (accélération vs message prospect précédent)
 */

import { createSupabaseAdmin } from "../supabase.js";

const ENGAGEMENT_POS = /\b(intéressant|interessant|ok|d'accord|oui|super|parfait|quand|combien|comment|pourquoi|rdv|appel|dispo|disponible|créneau|creneau|en effet|carrément|carrement|ca marche|ça marche|allons-?y|clair|j'écoute|j'ecoute|je veux|envoie|envoyer|dis-moi|dis moi)\b/gi;
const ENGAGEMENT_NEG = /\b(pas le temps|peut-être|peut etre|plus tard|pas intéressé|pas interesse|pas pour moi|je passe|non merci|stop|pas besoin|déjà|deja|on verra|je regarderai|à bientôt|a bientot)\b/gi;
const QUESTION_RE = /\?/g;

const MAX_WORDS = 50;          // sat point for length normalization
const FAST_REPLY_MS = 2 * 3600 * 1000;     // < 2h = hot
const SLOW_REPLY_MS = 24 * 3600 * 1000;    // > 24h = cold

function normLength(text) {
  const count = (text.match(/\S+/g) || []).length;
  return Math.min(count, MAX_WORDS) / MAX_WORDS;
}

function questionRatio(text) {
  const q = (text.match(QUESTION_RE) || []).length;
  const sentences = (text.match(/[.!?…]+|\n/g) || []).length + 1;
  if (sentences === 0) return 0;
  return Math.min(q / sentences, 1);
}

function recencyScore(msgCreatedAt, prevAssistantCreatedAt) {
  if (!prevAssistantCreatedAt) return 0.5; // neutral if no prior
  const deltaMs = new Date(msgCreatedAt) - new Date(prevAssistantCreatedAt);
  if (deltaMs <= 0) return 0.5;
  if (deltaMs <= FAST_REPLY_MS) return 1.0;
  if (deltaMs >= SLOW_REPLY_MS) return 0.0;
  // log-linear between 2h and 24h
  const t = (Math.log(deltaMs) - Math.log(FAST_REPLY_MS)) / (Math.log(SLOW_REPLY_MS) - Math.log(FAST_REPLY_MS));
  return Math.max(0, Math.min(1, 1 - t));
}

function lexicalScore(text) {
  const pos = (text.match(ENGAGEMENT_POS) || []).length;
  const neg = (text.match(ENGAGEMENT_NEG) || []).length;
  if (pos === 0 && neg === 0) return 0.5;
  const raw = (pos - neg) / (pos + neg);  // [-1, 1]
  return (raw + 1) / 2;                    // [0, 1]
}

/**
 * Pure computation. No IO.
 * @param {string} text - prospect message content
 * @param {object} ctx - { prevAssistantCreatedAt, createdAt, prevHeat }
 * @returns {{ heat: number, signals: object, delta: number|null }}
 */
export function computeHeat(text, ctx = {}) {
  const lenN = normLength(text);
  const qR = questionRatio(text);
  const rec = recencyScore(ctx.createdAt || new Date(), ctx.prevAssistantCreatedAt);
  const lex = lexicalScore(text);

  let trend = 0.5;
  if (typeof ctx.prevHeat === "number") {
    trend = ctx.prevHeat < 0.5 ? 0.7 : 0.5; // bonus if coming from cold
  }

  const heat = 0.3 * lenN + 0.2 * qR + 0.2 * rec + 0.2 * lex + 0.1 * trend;
  const clamped = Math.max(0, Math.min(1, heat));

  const delta = typeof ctx.prevHeat === "number" ? +(clamped - ctx.prevHeat).toFixed(3) : null;

  return {
    heat: +clamped.toFixed(3),
    signals: { len_norm: +lenN.toFixed(3), question_ratio: +qR.toFixed(3), recency: +rec.toFixed(3), lexical: +lex.toFixed(3), trend },
    delta,
  };
}

/**
 * Compute heat for a newly-received prospect message and persist it.
 * Called from the chat handler when a message with role='user' is saved.
 *
 * @param {object} params - { messageId, conversationId, content, createdAt }
 */
export async function logProspectHeat({ messageId, conversationId, content, createdAt }) {
  if (!messageId || !conversationId || !content) return null;
  const sb = createSupabaseAdmin();

  // Fetch prior context: previous assistant message timestamp + previous heat record
  const { data: priorMsg } = await sb
    .from("messages")
    .select("created_at, role")
    .eq("conversation_id", conversationId)
    .lt("created_at", createdAt)
    .order("created_at", { ascending: false })
    .limit(5);

  const prevAssistant = priorMsg?.find(m => m.role === "assistant");

  const { data: priorHeat } = await sb
    .from("prospect_heat")
    .select("heat")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { heat, signals, delta } = computeHeat(content, {
    createdAt,
    prevAssistantCreatedAt: prevAssistant?.created_at,
    prevHeat: priorHeat?.heat,
  });

  const { error } = await sb.from("prospect_heat").insert({
    conversation_id: conversationId,
    message_id: messageId,
    heat,
    signals,
    delta,
  });

  if (error) {
    console.error("[prospectHeat] insert failed", error.message);
    return null;
  }
  return { heat, signals, delta };
}

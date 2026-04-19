import { supabase } from "./supabase.js";
import { extractGraphKnowledge } from "./graph-extraction.js";
import { clearIntelligenceCache } from "./knowledge-db.js";
import { callClaudeWithTimeout, parseJsonFromText } from "./claude-helpers.js";
import { log } from "./log.js";

/**
 * Validation signals — user is satisfied with the coaching result.
 * Kept broad intentionally; Haiku does the fine classification.
 */
const VALIDATION_PATTERN = /\b(ok(?:\s+top)?|top|parfait|nickel|c'est bon|c'est ça|envoie|on part (là-dessus|sur ça)|valid[eé]|go|oui|génial|impec|super|exact|ça me va|ça va|bien joué)\b/i;

/** Max chars for a validation message — longer messages are likely new instructions */
const MAX_VALIDATION_LENGTH = 200;

/**
 * Direct instruction signals — user is giving a rule/correction directly.
 * e.g. "ne jamais alterner vouvoiement/tutoiement", "ajoute une règle", "intègre ça"
 */
// Boundaries use (?<!\w)...(?!\w) instead of \b so that accented alternatives like
// "à partir de maintenant" match — JS's ASCII \b does not treat "à" as a word char.
const INSTRUCTION_PATTERN = /(?<!\w)(ajoute[sr]?\s+((une|la|cette|ma|les|des|l')\s+)?(r[èe]gle|correction|instruction)|ne\s+jamais|toujours\s+\w+|int[èe]gre[sr]?\s+(ça|ca|cette|ce|la)|r[èe]gle\s*:|retiens?\s+(ça|ca|cette|que)|note\s+(ça|ca|que|cette)|dor[ée]navant|d[ée]sormais|[àa]\s+partir\s+de\s+maintenant|important\s*:|rappelle[- ]toi)(?!\w)/i;

/** Max chars for an instruction message */
const MAX_INSTRUCTION_LENGTH = 2000;

/**
 * Coaching correction signals — user is correcting the bot's style/tone.
 * e.g. "trop long", "plus court", "c'est trop formel", "pas assez direct"
 */
const CORRECTION_PATTERN = /\b(trop\s+\w+|pas\s+assez\s+\w+|plus\s+(court|long|direct|simple|naturel|concis|percutant|punchy)|moins\s+(formel|long|verbeux|commercial|agressif|robotique)|(?:c'?est|ca\s+fait|ça\s+fait)\s+(trop|pas|un\s+peu)\s+\w+|enlève|enl[eè]ve|supprime|retire|évite|arr[eê]te|stop\s|on\s+dit\s+pas|dis\s+pas|fais\s+pas|mets?\s+pas)\b/i;

const MAX_CORRECTION_LENGTH = 150;

/**
 * Negative feedback signals — user wants to undo/weaken a rule.
 * e.g. "oublie cette regle", "c'etait mieux avant", "annule", "reviens en arriere"
 */
const NEGATIVE_PATTERN = /\b(oublie[sr]?\s+(cette|la|ma|les|des)\s+(r[èe]gle|correction|instruction)|annule[sr]?\s+(la\s+derni[èe]re|cette|les)|c'[ée]tait\s+mieux\s+avant|reviens?\s+en\s+arri[èe]re|supprime[sr]?\s+(cette|la|les)\s+(r[èe]gle|correction)|retire[sr]?\s+(cette|la|les)\s+(r[èe]gle|correction)|non\s+c'est\s+pas\s+[çc]a|c'est\s+pas\s+ce\s+que\s+j|enleve[sr]?\s+(cette|la|les)\s+(r[èe]gle|correction))\b/i;

const MAX_NEGATIVE_LENGTH = 200;

export function looksLikeNegativeFeedback(msg) {
  if (!msg || msg.length > MAX_NEGATIVE_LENGTH) return false;
  return NEGATIVE_PATTERN.test(msg);
}

/**
 * Haiku classifier — classify a message intent in ~200ms / ~$0.00003.
 * Returns one of: INSTRUCTION | CORRECTION | VALIDATION | NEGATIVE | CHAT
 *
 * Fast-path: if regex matches AND message is very short (<40 chars), skip classifier.
 * Classifier runs for ambiguous cases (regex matches but longer message, or gray zone).
 */
const CLASSIFY_SYSTEM = `Classifie le message d'un utilisateur de chatbot IA.
Reponds par UN seul mot parmi : INSTRUCTION CORRECTION VALIDATION NEGATIVE CHAT

INSTRUCTION = l'utilisateur donne une regle/directive a retenir ("ne jamais", "ajoute une regle", "desormais")
CORRECTION = l'utilisateur corrige le style/ton de la derniere reponse ("trop long", "plus direct", "c'est trop formel")
VALIDATION = l'utilisateur valide/approuve ("ok top", "parfait", "c'est bon", "envoie")
NEGATIVE = l'utilisateur veut annuler/affaiblir une regle ("oublie cette regle", "c'etait mieux avant")
CHAT = conversation normale, question, demande de travail`;

export async function classifyMessage(msg, lastBotMsg, client) {
  if (!msg || msg.length > 2000) return "CHAT";

  // Fast-path: very short + specific regex → trust the regex
  // VALIDATION excluded: "oui", "super", "top" are too ambiguous in short messages
  if (msg.length < 40) {
    if (NEGATIVE_PATTERN.test(msg)) return "NEGATIVE";
    if (CORRECTION_PATTERN.test(msg)) return "CORRECTION";
    if (INSTRUCTION_PATTERN.test(msg)) return "INSTRUCTION";
  }

  // No regex match and short → definitely chat
  const anyRegex = INSTRUCTION_PATTERN.test(msg) || CORRECTION_PATTERN.test(msg) ||
    VALIDATION_PATTERN.test(msg) || NEGATIVE_PATTERN.test(msg);
  if (!anyRegex && msg.length < 80) return "CHAT";

  // Ambiguous → classifier
  try {
    const context = lastBotMsg ? `\nDerniere reponse bot : "${(lastBotMsg || "").slice(0, 150)}"` : "";
    const result = await callClaudeWithTimeout({
      client,
      max_tokens: 5,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: "user", content: `Message : "${msg.slice(0, 300)}"${context}` }],
      timeoutMs: 3000,
      timeoutLabel: "classify_timeout",
    });

    const label = result.content[0].text.trim().toUpperCase();
    const valid = new Set(["INSTRUCTION", "CORRECTION", "VALIDATION", "NEGATIVE", "CHAT"]);
    return valid.has(label) ? label : "CHAT";
  } catch {
    // Fallback to regex on timeout/error
    if (NEGATIVE_PATTERN.test(msg)) return "NEGATIVE";
    if (INSTRUCTION_PATTERN.test(msg)) return "INSTRUCTION";
    if (CORRECTION_PATTERN.test(msg)) return "CORRECTION";
    if (VALIDATION_PATTERN.test(msg)) return "VALIDATION";
    return "CHAT";
  }
}

/**
 * Process negative feedback: identify which correction/entity to demote.
 * Uses Haiku to match the user's message against recent corrections.
 * Returns { demoted: number, corrections: string[] } or null.
 */
export async function detectNegativeFeedback(intellId, userMsg, conversationMessages, client) {
  if (!userMsg || userMsg.length > MAX_NEGATIVE_LENGTH) return null;
  if (!NEGATIVE_PATTERN.test(userMsg)) return null;
  if (!conversationMessages || conversationMessages.length < 2) return null;

  try {
    // Load recent corrections for this persona
    const { data: corrections } = await supabase
      .from("corrections")
      .select("id, correction, confidence, created_at")
      .eq("persona_id", intellId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!corrections || corrections.length === 0) return null;

    const corrList = corrections.map((c, i) => `[${i}] ${c.correction}`).join("\n");
    const recentMessages = conversationMessages.slice(-6)
      .map(m => `${m.role === "user" ? "USER" : "BOT"}: ${(m.content || "").slice(0, 200)}`)
      .join("\n\n");

    const result = await callClaudeWithTimeout({
      client,
      max_tokens: 256,
      system: `L'utilisateur veut annuler ou affaiblir une regle de son clone IA.
Voici les corrections actives :
${corrList}

Identifie quelle(s) correction(s) l'utilisateur veut annuler/affaiblir.
Reponds en JSON : {"indices": [0, 2], "reason": "explication courte"}
Si aucune ne correspond, reponds {"indices": [], "reason": "aucune correspondance"}`,
      messages: [{
        role: "user",
        content: `Conversation :\n${recentMessages}\n\nDernier message : "${userMsg}"`,
      }],
    });

    const data = parseJsonFromText(result.content[0].text.trim());
    if (!data?.indices?.length) return null;

    const demoted = [];
    for (const idx of data.indices) {
      if (idx < 0 || idx >= corrections.length) continue;
      const c = corrections[idx];
      const newConf = Math.max(0.0, (c.confidence || 0.8) - 0.2);
      const newStatus = newConf <= 0.1 ? "archived" : "active";

      const { error: corrErr } = await supabase.from("corrections")
        .update({ confidence: newConf, status: newStatus })
        .eq("id", c.id);
      if (corrErr) log("correction_demote_error", { id: c.id, error: corrErr.message });

      // Also demote matching entities
      const { data: entities } = await supabase
        .from("knowledge_entities")
        .select("id, name, confidence")
        .eq("persona_id", intellId);

      if (entities?.length) {
        const corrLower = c.correction.toLowerCase();
        const matched = entities.filter(e => corrLower.includes(e.name.toLowerCase()));
        for (const e of matched) {
          const entConf = Math.max(0.0, (e.confidence || 0.8) - 0.15);
          const { error: entErr } = await supabase.from("knowledge_entities")
            .update({ confidence: entConf })
            .eq("id", e.id);
          if (entErr) log("entity_demote_error", { id: e.id, error: entErr.message });
        }
      }

      demoted.push(c.correction);
    }

    if (demoted.length > 0) clearIntelligenceCache(intellId);

    log("negative_feedback_detected", {
      persona: intellId,
      demoted_count: demoted.length,
      trigger: userMsg.slice(0, 50),
    });

    return { demoted: demoted.length, corrections: demoted };
  } catch (e) {
    log("negative_feedback_error", { persona: intellId, error: e.message });
    return null;
  }
}

/**
 * Quick sync check — does the message look like a direct instruction?
 * No API call, just regex. Used by chat.js to short-circuit before calling Claude.
 */
export function looksLikeDirectInstruction(msg) {
  if (!msg || msg.length > MAX_INSTRUCTION_LENGTH) return false;
  return INSTRUCTION_PATTERN.test(msg);
}

const FEEDBACK_EXTRACTION_PROMPT = `Tu analyses une conversation de coaching entre un utilisateur et son clone vocal IA.
L'utilisateur vient de VALIDER le resultat final. Analyse l'echange complet et extrais les corrections de style/ton/contenu que l'utilisateur a donnees pendant le coaching.

Reponds en JSON :
{
  "has_feedback": true/false,
  "corrections": [
    { "rule": "description concise de la regle apprise", "context": "le message user qui l'a declenchee" }
  ]
}

Exemples :
- User dit "trop requin" → { "rule": "Eviter le ton commercial agressif dans les DMs", "context": "trop requin" }
- User dit "ça sonne creux" → { "rule": "Eviter les compliments generiques sans substance", "context": "ça sonne creux" }
- User dit "option 1 j'aime, option 3 trop robotique" → deux corrections : preference pour l'approche de l'option 1, et eviter le ton robotique
- User dit "il ecrit par pave pas ligne par ligne" → { "rule": "Ecrire en blocs/paves, pas en messages ligne par ligne", "context": "..." }

IMPORTANT :
- Extrais UNIQUEMENT les corrections de style/ton/contenu, pas les instructions de travail
- Si l'echange ne contient aucun coaching (juste des instructions normales), reponds {"has_feedback": false}
- Sois concis et actionnable dans les regles`;

const INSTRUCTION_EXTRACTION_PROMPT = `Tu analyses un message d'un utilisateur qui donne une INSTRUCTION ou REGLE directe a son clone vocal IA.
Extrais la regle de maniere concise et actionnable.

Reponds en JSON :
{
  "has_rule": true/false,
  "corrections": [
    { "rule": "description concise de la regle", "context": "le message original de l'utilisateur" }
  ]
}

Exemples :
- "ajoute une regle : ne jamais alterner vouvoiement et tutoiement" → { "rule": "Ne jamais alterner vouvoiement/tutoiement - toujours s'aligner sur le registre du client", "context": "..." }
- "desormais, utilise toujours des emojis" → { "rule": "Utiliser des emojis dans les messages", "context": "..." }
- "retiens que je prefere le tutoiement" → { "rule": "Tutoiement obligatoire dans tous les messages", "context": "..." }
- "integre ca dans intelligence" → Regarde le contexte de la conversation pour trouver la regle a integrer

IMPORTANT :
- Si le message est une instruction claire, extrais-la meme sans mot-cle explicite
- Si le message reference une regle discutee precedemment dans la conversation, utilise le contexte pour la retrouver
- Si ce n'est pas une instruction/regle, reponds {"has_rule": false}
- Sois concis et actionnable`;

/**
 * Detect if the current user message is a direct instruction/rule.
 * If yes, extract and save as correction.
 *
 * Called from chat.js after the bot response is streamed.
 * Returns { count, rules } where rules is the array of synthesized rule texts.
 */
export async function detectDirectInstruction(intellId, userMsg, conversationMessages, client) {
  if (!userMsg || userMsg.length > MAX_INSTRUCTION_LENGTH) return { count: 0, rules: [] };
  if (!INSTRUCTION_PATTERN.test(userMsg)) return { count: 0, rules: [] };

  // Need at least 1 message pair for context
  if (!conversationMessages || conversationMessages.length < 1) return { count: 0, rules: [] };

  const recentMessages = conversationMessages.slice(-10);
  const exchange = recentMessages
    .map(m => `${m.role === "user" ? "USER" : "BOT"}: ${(m.content || "").slice(0, 300)}`)
    .join("\n\n");

  try {
    const result = await callClaudeWithTimeout({
      client,
      max_tokens: 1024,
      system: INSTRUCTION_EXTRACTION_PROMPT,
      messages: [{
        role: "user",
        content: `Conversation recente :\n\n${exchange}\n\nLe dernier message USER contient une instruction/regle a integrer. Extrais-la.`,
      }],
    });

    const data = parseJsonFromText(result.content[0].text.trim());
    if (!data?.has_rule || !data.corrections?.length) return { count: 0, rules: [] };

    const savedRules = [];
    for (const c of data.corrections) {
      if (!c.rule || c.rule.length < 5) continue;

      await supabase.from("corrections").insert({
        persona_id: intellId,
        correction: c.rule,
        user_message: (c.context || userMsg).slice(0, 200),
        bot_message: "[direct-instruction]",
      });

      await extractGraphKnowledge(intellId, c.rule, null, userMsg, client);
      savedRules.push(c.rule);
    }

    if (savedRules.length > 0) clearIntelligenceCache(intellId);

    log("direct_instruction_detected", {
      persona: intellId,
      corrections_saved: savedRules.length,
      trigger: userMsg.slice(0, 50),
    });

    return { count: savedRules.length, rules: savedRules };
  } catch (e) {
    log("direct_instruction_detect_error", { persona: intellId, error: e.message });
    return { count: 0, rules: [] };
  }
}

/**
 * Detect if the current user message is a short coaching correction (e.g. "trop long").
 * If yes, extract the implicit rule and save it.
 */
export async function detectCoachingCorrection(intellId, userMsg, conversationMessages, client) {
  if (!userMsg || userMsg.length > MAX_CORRECTION_LENGTH) return 0;
  if (!CORRECTION_PATTERN.test(userMsg)) return 0;
  if (!conversationMessages || conversationMessages.length < 2) return 0;

  // Get the bot message that was corrected (last bot message before user's correction)
  const lastBotMsg = [...conversationMessages].reverse().find(m => m.role === "assistant" || m.role === "bot");
  if (!lastBotMsg) return 0;

  try {
    const result = await callClaudeWithTimeout({
      client,
      max_tokens: 256,
      system: `L'utilisateur a corrige une reponse de son clone IA. Extrais la regle implicite.
Reponds en JSON : {"rule": "description concise et actionnable"}
Exemples :
- "trop long" → {"rule": "Messages plus courts, max 2-3 lignes"}
- "c'est trop formel" → {"rule": "Ton informel et decontracte, eviter le vouvoiement"}
- "plus direct" → {"rule": "Aller droit au but, pas de formules d'introduction"}
- "enleve les emojis" → {"rule": "Ne pas utiliser d'emojis dans les messages"}`,
      messages: [{
        role: "user",
        content: `Message bot : "${(lastBotMsg.content || "").slice(0, 300)}"\n\nCorrection user : "${userMsg}"`,
      }],
    });

    const data = parseJsonFromText(result.content[0].text.trim());
    if (!data?.rule || data.rule.length < 5) return 0;

    await supabase.from("corrections").insert({
      persona_id: intellId,
      correction: data.rule,
      user_message: userMsg.slice(0, 200),
      bot_message: (lastBotMsg.content || "").slice(0, 300),
    });

    await extractGraphKnowledge(intellId, data.rule, lastBotMsg.content, userMsg, client);
    clearIntelligenceCache(intellId);

    log("coaching_correction_detected", {
      persona: intellId,
      rule: data.rule,
      trigger: userMsg.slice(0, 50),
    });

    return 1;
  } catch (e) {
    log("coaching_correction_detect_error", { persona: intellId, error: e.message });
    return 0;
  }
}

/**
 * Detect if the current user message is a validation signal.
 * If yes, analyze the recent conversation history to extract coaching feedback,
 * save as corrections, and trigger graph extraction.
 *
 * Called from chat.js after the bot response is streamed.
 * Returns number of corrections saved, or 0 if not a validation.
 */
export async function detectChatFeedback(intellId, userMsg, conversationMessages, client) {
  // Pre-filter: short message + matches validation pattern
  if (!userMsg || userMsg.length > MAX_VALIDATION_LENGTH) return 0;
  if (!VALIDATION_PATTERN.test(userMsg)) return 0;

  // Need at least 3 messages (bot → user coaching → bot → user validation)
  if (!conversationMessages || conversationMessages.length < 3) return 0;

  // Build the recent exchange (last ~10 messages for context)
  const recentMessages = conversationMessages.slice(-10);
  const exchange = recentMessages
    .map(m => `${m.role === "user" ? "USER" : "BOT"}: ${(m.content || "").slice(0, 300)}`)
    .join("\n\n");

  try {
    const result = await callClaudeWithTimeout({
      client,
      max_tokens: 1024,
      system: FEEDBACK_EXTRACTION_PROMPT,
      messages: [{
        role: "user",
        content: `Conversation de coaching :\n\n${exchange}\n\nLe dernier message USER est une validation. Extrais les corrections de la boucle de coaching.`,
      }],
    });

    const data = parseJsonFromText(result.content[0].text.trim());
    if (!data?.has_feedback || !data.corrections?.length) return 0;

    // Save each correction + extract graph knowledge
    let savedCount = 0;
    for (const c of data.corrections) {
      if (!c.rule || c.rule.length < 5) continue;

      await supabase.from("corrections").insert({
        persona_id: intellId,
        correction: c.rule,
        user_message: (c.context || "").slice(0, 200),
        bot_message: "[auto-detected from chat coaching]",
      });

      await extractGraphKnowledge(intellId, c.rule, null, c.context, client);
      savedCount++;
    }

    if (savedCount > 0) clearIntelligenceCache(intellId);

    log("chat_feedback_detected", {
      persona: intellId,
      corrections_saved: savedCount,
      trigger: userMsg.slice(0, 50),
    });

    return savedCount;
  } catch (e) {
    log("chat_feedback_detect_error", { persona: intellId, error: e.message });
    return 0;
  }
}

/**
 * Metacognitive insight extraction for LONG messages (> 200 chars)
 * that don't match any existing detection pattern.
 *
 * Detects: methodology, values/philosophy, sector insights, anecdotes, factual corrections.
 * Saves to corrections table with [TYPE] prefix for prompt injection.
 */
const MIN_METACOGNITIVE_LENGTH = 200;

const METACOGNITIVE_PROMPT = `Tu analyses un message d'un client qui utilise son clone vocal IA.
Extrais TOUS les enseignements implicites que le clone devrait retenir pour mieux servir ce client.

Types d'enseignements :
- correction : le client corrige une erreur factuelle ou methodologique du bot
- valeur : le client exprime une conviction ou philosophie profonde sur son metier/approche
- methodologie : le client decrit un processus, une facon de faire, une methode de travail
- insight_sectoriel : observation sur le marche, tendance, fait sectoriel
- anecdote : histoire personnelle ou de clients, utilisable dans du contenu futur

Reponds en JSON :
{
  "has_insights": true/false,
  "insights": [
    { "type": "methodologie", "rule": "description concise et actionnable", "context": "extrait court du message" }
  ]
}

IMPORTANT :
- Extrais UNIQUEMENT ce qui enrichit la connaissance du clone sur le client
- Les insights doivent etre actionnables (utilisables dans de futures generations)
- Si le message est juste une instruction de travail banale, reponds {"has_insights": false}
- Prefere la qualite : 1-2 insights forts > 5 insights vagues
- Si le bot a DEJA mentionne un insight dans sa reponse, ne le re-extrais pas`;

const TYPE_PREFIXES = {
  correction: "[CORRECTION]",
  valeur: "[VALEUR]",
  methodologie: "[METHODOLOGIE]",
  insight_sectoriel: "[INSIGHT]",
  anecdote: "[ANECDOTE]",
};

/**
 * Detect metacognitive insights in long user messages.
 * Called post-response in chat.js alongside other detectors.
 * Returns number of insights saved, or 0.
 */
export async function detectMetacognitiveInsights(intellId, userMsg, conversationMessages, botResponse, client, msgIntent) {
  if (!userMsg || userMsg.length <= MIN_METACOGNITIVE_LENGTH) return 0;

  // Skip if classifier already routed to a specialized detector
  if (msgIntent && msgIntent !== "CHAT") return 0;

  if (!conversationMessages || conversationMessages.length < 2) return 0;

  try {
    // Structured input: context + target message + bot response for dedup
    const contextMessages = conversationMessages.slice(-8, -1)
      .map(m => `${m.role === "user" ? "USER" : "BOT"}: ${(m.content || "").slice(0, 300)}`)
      .join("\n\n");

    const input = `CONTEXTE (messages precedents) :\n${contextMessages}\n\n---\n\nMESSAGE A ANALYSER :\n"${userMsg.slice(0, 1500)}"\n\n---\n\nREPONSE DU BOT (pour eviter les doublons) :\n"${(botResponse || "").slice(0, 300)}"`;

    const result = await callClaudeWithTimeout({
      client,
      max_tokens: 1024,
      system: METACOGNITIVE_PROMPT,
      messages: [{ role: "user", content: input }],
    });

    const data = parseJsonFromText(result.content[0].text.trim());
    if (!data?.has_insights || !data.insights?.length) return 0;

    let savedCount = 0;
    for (const insight of data.insights) {
      if (!insight.rule || insight.rule.length < 10) continue;

      const prefix = TYPE_PREFIXES[insight.type] || "[INSIGHT]";
      const correction = `${prefix} ${insight.rule}`;

      await supabase.from("corrections").insert({
        persona_id: intellId,
        correction,
        user_message: (insight.context || userMsg.slice(0, 200)).slice(0, 200),
        bot_message: "[metacognitive-extraction]",
      });

      await extractGraphKnowledge(intellId, correction, botResponse, userMsg, client);
      savedCount++;
    }

    if (savedCount > 0) clearIntelligenceCache(intellId);

    log("metacognitive_insights_detected", {
      persona: intellId,
      insights_saved: savedCount,
      types: data.insights.map(i => i.type),
      trigger_length: userMsg.length,
    });

    return savedCount;
  } catch (e) {
    log("metacognitive_insights_error", { persona: intellId, error: e.message });
    return 0;
  }
}

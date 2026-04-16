import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { extractGraphKnowledge } from "./graph-extraction.js";
import { clearCache } from "./knowledge-db.js";

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
const INSTRUCTION_PATTERN = /\b(ajoute[sr]?\s+(une\s+)?(r[èe]gle|correction|instruction)|ne\s+jamais|toujours\s+\w|int[èe]gre[sr]?\s+(ça|cette|ce|la)|r[èe]gle\s*:|retiens?\s+(ça|cette|que)|note\s+(ça|que|cette)|dor[ée]navant|d[ée]sormais|[àa]\s+partir\s+de\s+maintenant|important\s*:|rappelle[- ]toi)\b/i;

/** Max chars for an instruction message */
const MAX_INSTRUCTION_LENGTH = 500;

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
 * Returns number of corrections saved, or 0.
 */
export async function detectDirectInstruction(personaId, userMsg, conversationMessages, client) {
  if (!userMsg || userMsg.length > MAX_INSTRUCTION_LENGTH) return 0;
  if (!INSTRUCTION_PATTERN.test(userMsg)) return 0;

  // Need at least 1 message pair for context
  if (!conversationMessages || conversationMessages.length < 1) return 0;

  const recentMessages = conversationMessages.slice(-10);
  const exchange = recentMessages
    .map(m => `${m.role === "user" ? "USER" : "BOT"}: ${(m.content || "").slice(0, 300)}`)
    .join("\n\n");

  try {
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: INSTRUCTION_EXTRACTION_PROMPT,
        messages: [{
          role: "user",
          content: `Conversation recente :\n\n${exchange}\n\nLe dernier message USER contient une instruction/regle a integrer. Extrais-la.`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 0;

    let data;
    try { data = JSON.parse(jsonMatch[0]); } catch { return 0; }
    if (!data.has_rule || !data.corrections?.length) return 0;

    let savedCount = 0;
    for (const c of data.corrections) {
      if (!c.rule || c.rule.length < 5) continue;

      await supabase.from("corrections").insert({
        persona_id: personaId,
        correction: c.rule,
        user_message: (c.context || userMsg).slice(0, 200),
        bot_message: "[direct-instruction]",
      });

      await extractGraphKnowledge(personaId, c.rule, null, userMsg, client);
      savedCount++;
    }

    if (savedCount > 0) clearCache(personaId);

    console.log(JSON.stringify({
      event: "direct_instruction_detected",
      ts: new Date().toISOString(),
      persona: personaId,
      corrections_saved: savedCount,
      trigger: userMsg.slice(0, 50),
    }));

    return savedCount;
  } catch (e) {
    console.log(JSON.stringify({
      event: "direct_instruction_detect_error",
      ts: new Date().toISOString(),
      persona: personaId,
      error: e.message,
    }));
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
export async function detectChatFeedback(personaId, userMsg, conversationMessages, client) {
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
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: FEEDBACK_EXTRACTION_PROMPT,
        messages: [{
          role: "user",
          content: `Conversation de coaching :\n\n${exchange}\n\nLe dernier message USER est une validation. Extrais les corrections de la boucle de coaching.`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 0;

    let data;
    try { data = JSON.parse(jsonMatch[0]); } catch { return 0; }
    if (!data.has_feedback || !data.corrections?.length) return 0;

    // Save each correction + extract graph knowledge
    let savedCount = 0;
    for (const c of data.corrections) {
      if (!c.rule || c.rule.length < 5) continue;

      await supabase.from("corrections").insert({
        persona_id: personaId,
        correction: c.rule,
        user_message: (c.context || "").slice(0, 200),
        bot_message: "[auto-detected from chat coaching]",
      });

      await extractGraphKnowledge(personaId, c.rule, null, c.context, client);
      savedCount++;
    }

    if (savedCount > 0) clearCache(personaId);

    console.log(JSON.stringify({
      event: "chat_feedback_detected",
      ts: new Date().toISOString(),
      persona: personaId,
      corrections_saved: savedCount,
      trigger: userMsg.slice(0, 50),
    }));

    return savedCount;
  } catch (e) {
    console.log(JSON.stringify({
      event: "chat_feedback_detect_error",
      ts: new Date().toISOString(),
      persona: personaId,
      error: e.message,
    }));
    return 0;
  }
}

import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";
import { authenticateRequest, checkBudget, getApiKey, logUsage, setCors, supabase } from "../lib/supabase.js";
import { getPersonaFromDb, findRelevantKnowledgeFromDb, loadScenarioFromDb, getCorrectionsFromDb, findRelevantEntities } from "../lib/knowledge-db.js";
import { detectChatFeedback, detectDirectInstruction, detectCoachingCorrection, looksLikeDirectInstruction, looksLikeNegativeFeedback, detectNegativeFeedback } from "../lib/feedback-detect.js";

/** Extract a smart conversation title from the first message */
function extractConvTitle(message, scenario) {
  // LinkedIn scrape: [Contexte lead — NOM PRENOM]
  const leadMatch = message.match(/\[Contexte lead\s*[—–-]\s*([^\]]+)\]/i);
  if (leadMatch) return leadMatch[1].trim();

  // Qualification scenario with pasted profile: first line often has the name
  if (scenario === "qualification") {
    // Look for "Prénom Nom" pattern at start or after common prefixes
    const firstLine = message.split("\n")[0].slice(0, 80);
    if (firstLine && !firstLine.startsWith("http")) return firstLine.replace(/\s+\S*$/, "").slice(0, 50);
  }

  // Default: first 50 chars
  return message.slice(0, 50).replace(/\s+\S*$/, "");
}

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  // Rate limiting
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const rl = rateLimit(ip);
  if (!rl.allowed) { res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter }); return; }

  let client;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // Budget check
  const budget = checkBudget(client);
  if (!budget.allowed) {
    res.status(402).json({ error: "Budget depasse", action: "add_api_key", remaining_cents: 0 });
    return;
  }

  // Validation
  const validationError = validateInput(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const { message, history: bodyHistory, scenario, persona: personaId, conversation_id } = req.body;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Load persona data from DB
  const persona = await getPersonaFromDb(personaId);
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  // Resolve conversation
  let convId = conversation_id || null;
  let messages;

  if (convId) {
    // Load existing conversation
    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, client_id, scenario")
      .eq("id", convId).single();

    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Ownership check
    if (client && conv.client_id !== client.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Load last 19 messages from DB
    const { data: dbMessages } = await supabase
      .from("messages").select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(19);

    const history = (dbMessages || []).reverse();
    messages = [...history, { role: "user", content: message }];
  } else {
    // Create new conversation for any authenticated user (including admin)
    const clientId = client?.id || null;
    const history = Array.isArray(bodyHistory) ? bodyHistory.slice(-19) : [];

    if (supabase) {
      const insertData = { persona_id: personaId, scenario: scenario || "default" };
      if (clientId) insertData.client_id = clientId;
      const { data: newConv } = await supabase
        .from("conversations").insert(insertData).select("id").single();
      convId = newConv?.id || null;
    }

    messages = [...history, { role: "user", content: message }];
  }

  // Resolve scenario
  const scenarioConfig = persona.scenarios[scenario] || persona.scenarios.default || Object.values(persona.scenarios)[0];
  const scenarioSlug = scenarioConfig?.slug || scenario || "default";
  const scenarioContent = await loadScenarioFromDb(personaId, scenarioSlug);

  // Entities first (provides boostTerms for knowledge retrieval)
  const ontology = await findRelevantEntities(personaId, messages);

  // Knowledge + corrections in parallel (knowledge uses boost terms from graph)
  const [knowledgeMatches, corrections] = await Promise.all([
    findRelevantKnowledgeFromDb(personaId, messages, ontology.boostTerms),
    getCorrectionsFromDb(personaId),
  ]);

  // Enrich ontology with entity names for prompt display
  if (ontology.relations) {
    const entityMap = {};
    for (const e of ontology.entities) entityMap[e.id] = e.name;
    for (const r of ontology.relations) {
      r.from_name = entityMap[r.from_entity_id] || "?";
      r.to_name = entityMap[r.to_entity_id] || "?";
    }
  }

  // Build system prompt (pure function)
  const { prompt: systemPrompt } = buildSystemPrompt({
    persona,
    knowledgeMatches,
    scenarioContent,
    corrections,
    ontology,
  });

  const sse = initSSE(res);
  const apiKey = getApiKey(client);

  // Short-circuit: negative feedback — user wants to undo/weaken a rule
  if (looksLikeNegativeFeedback(message)) {
    try {
      const result = await detectNegativeFeedback(personaId, message, messages, client);
      if (result && result.demoted > 0) {
        const confirm = result.demoted === 1
          ? `Règle affaiblie : "${result.corrections[0].slice(0, 60)}". Elle aura moins d'influence.`
          : `${result.demoted} règles affaiblies. Elles auront moins d'influence.`;
        sse("delta", { text: confirm });
        sse("done", {});

        if (convId && supabase) {
          Promise.all([
            supabase.from("messages").insert([
              { conversation_id: convId, role: "user", content: message },
              { conversation_id: convId, role: "assistant", content: confirm },
            ]),
            supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
            supabase.from("conversations")
              .update({ title: extractConvTitle(message, scenario) })
              .eq("id", convId).is("title", null),
          ]).catch(() => {});
        }

        if (convId) sse("conversation", { id: convId });
        res.end();
        return;
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "negative_feedback_shortcircuit_error", ts: new Date().toISOString(), error: e.message }));
    }
  }

  // Short-circuit: if the message is a direct instruction, save it and confirm
  // without calling Claude (avoids the "I can't modify my settings" response)
  if (looksLikeDirectInstruction(message)) {
    try {
      const saved = await detectDirectInstruction(personaId, message, messages, client);
      if (saved > 0) {
        const confirm = saved === 1
          ? "Règle ajoutée. Elle sera active dès ton prochain message."
          : `${saved} règles ajoutées. Elles seront actives dès ton prochain message.`;
        sse("delta", { text: confirm });
        sse("done", {});

        // Persist user message + confirmation
        if (convId && supabase) {
          Promise.all([
            supabase.from("messages").insert([
              { conversation_id: convId, role: "user", content: message },
              { conversation_id: convId, role: "assistant", content: confirm },
            ]),
            supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
            supabase.from("conversations")
              .update({ title: extractConvTitle(message, scenario) })
              .eq("id", convId).is("title", null),
          ]).catch(() => {});
        }

        if (convId) sse("conversation", { id: convId });
        res.end();
        return;
      }
    } catch (e) {
      // Extraction failed — fall through to normal chat
      console.log(JSON.stringify({ event: "direct_instruction_shortcircuit_error", ts: new Date().toISOString(), error: e.message }));
    }
  }

  try {
    const result = await runPipeline({
      systemPrompt,
      messages,
      sse,
      res,
      voiceRules: persona.voice,
      corrections,
      apiKey,
    });
    // Persist messages + update conversation (async, non-blocking)
    if (convId && supabase) {
      const botText = result.text || "";
      Promise.all([
        supabase.from("messages").insert([
          { conversation_id: convId, role: "user", content: message },
          { conversation_id: convId, role: "assistant", content: botText },
        ]),
        supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
        supabase.from("conversations")
          .update({ title: extractConvTitle(message, scenario) })
          .eq("id", convId).is("title", null),
      ]).catch((err) => {
        console.log(JSON.stringify({
          event: "persist_error", ts: new Date().toISOString(),
          conversation_id: convId, error: err.message || "Unknown",
        }));
      });
    }

    // Detect feedback from user message (runs in background, doesn't block response):
    // 1. Coaching corrections: "trop long", "plus direct", etc.
    // 2. Validation signals: "ok top", "parfait" → extracts corrections from coaching history
    // Note: direct instructions are handled above (short-circuit path)
    Promise.all([
      detectCoachingCorrection(personaId, message, messages, client),
      detectChatFeedback(personaId, message, messages, client),
    ]).catch(err => console.log(JSON.stringify({
        event: "feedback_detect_bg_error", ts: new Date().toISOString(), error: err.message,
      })));

    if (convId) sse("conversation", { id: convId });
    res.end();

    // Log usage (async, don't block response)
    if (client && result.usage) {
      logUsage(client.id, personaId, result.usage.input_tokens, result.usage.output_tokens).catch(() => {});
    }
  } catch (err) {
    console.log(JSON.stringify({
      event: "chat_error", ts: new Date().toISOString(),
      scenario, persona: personaId, error: err.message || "Unknown error",
    }));
    if (res.headersSent) {
      sse("error", { text: "Erreur de generation" });
      res.end();
    } else {
      res.status(500).json({ error: "Erreur serveur : " + err.message });
    }
  }
}

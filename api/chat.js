import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";
import { authenticateRequest, checkBudget, getApiKey, logUsage, hasPersonaAccess, setCors, supabase } from "../lib/supabase.js";
import { getPersonaFromDb, findRelevantKnowledgeFromDb, loadScenarioFromDb, getCorrectionsFromDb, findRelevantEntities, getIntelligenceId } from "../lib/knowledge-db.js";
import { detectChatFeedback, detectDirectInstruction, detectCoachingCorrection, detectMetacognitiveInsights, looksLikeDirectInstruction, looksLikeNegativeFeedback, detectNegativeFeedback, classifyMessage } from "../lib/feedback-detect.js";
import { selectModel } from "../lib/model-router.js";
import { consolidateCorrections } from "../lib/correction-consolidation.js";
import { logLearningEvent } from "../lib/learning-events.js";
import { isScenarioId } from "../src/lib/scenarios.js";

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

  // Rate limiting — rateLimit() became async in migration 017 (Supabase RPC
  // source of truth). Missing `await` here meant `rl` was a Promise and
  // `rl.allowed === undefined`, so the guard always tripped → every POST
  // /api/chat returned 429 since 2026-04-17.
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const rl = await rateLimit(ip);
  if (!rl.allowed) { res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter }); return; }

  let client, isAdmin;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
    isAdmin = auth.isAdmin;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // Budget check (admins bypass)
  if (!isAdmin) {
    const budget = checkBudget(client);
    if (!budget.allowed) {
      res.status(402).json({ error: "Budget depasse", action: "add_api_key", remaining_cents: 0 });
      return;
    }
  }

  // Validation
  const validationError = validateInput(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const { message, history: bodyHistory, scenario, scenario_type: rawScenarioType, persona: personaId, conversation_id } = req.body;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Sprint 0.b dual-write : only accept a well-formed canonical id. Unknown
  // strings are dropped silently (legacy `scenario` text still wins for
  // compatibility). The DB column is a Postgres enum, so a bad value would
  // fail the insert otherwise.
  const scenarioType = isScenarioId(rawScenarioType) ? rawScenarioType : null;

  // Load persona data from DB
  const persona = await getPersonaFromDb(personaId);
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }
  const intellId = getIntelligenceId(persona);

  // Persona access check (owner or shared) — admins bypass
  if (client && !isAdmin && persona.client_id !== client.id) {
    const hasAccess = await hasPersonaAccess(client.id, personaId);
    if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }
  }

  // Resolve conversation
  let convId = conversation_id || null;
  let messages;

  if (convId) {
    // Load existing conversation
    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, client_id, scenario")
      .eq("id", convId).single();

    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Ownership check — admins bypass
    if (client && !isAdmin && conv.client_id !== client.id) {
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
      // Sprint 0.b : persist canonical scenario_type alongside the legacy
      // scenario text. Nullable — omitted when no valid canonical was sent.
      if (scenarioType) insertData.scenario_type = scenarioType;
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

  // Entities + corrections in parallel (corrections don't depend on ontology)
  const [ontology, corrections] = await Promise.all([
    findRelevantEntities(personaId, messages),
    getCorrectionsFromDb(personaId),
  ]);

  // Knowledge uses boost terms from graph — must wait for ontology
  const knowledgeMatches = await findRelevantKnowledgeFromDb(personaId, messages, ontology.boostTerms);

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
  const {
    prompt: systemPrompt,
    detectedPages,
    injectedEntities,
    injectedCorrectionsCount,
  } = buildSystemPrompt({
    persona,
    knowledgeMatches,
    scenarioContent,
    corrections,
    ontology,
  });

  // Audit trail: what actually shaped THIS response — sent to the UI so the
  // user can see "why did the clone say that?" instead of a black box.
  const sources = {
    knowledgePages: detectedPages || [],
    entities: injectedEntities || [],
    correctionsCount: injectedCorrectionsCount || 0,
  };

  const sse = initSSE(res);
  const apiKey = getApiKey(client);

  // Unified classifier: regex fast-path + Haiku fallback for ambiguous messages
  const lastBotMsg = [...messages].reverse().find(m => m.role === "assistant")?.content;
  const msgIntent = await classifyMessage(message, lastBotMsg, client);
  console.log(JSON.stringify({ event: "msg_classified", ts: new Date().toISOString(), intent: msgIntent, msg: message.slice(0, 50) }));

  // Short-circuit: negative feedback — user wants to undo/weaken a rule
  if (msgIntent === "NEGATIVE") {
    try {
      const result = await detectNegativeFeedback(intellId, message, messages, client);
      if (result && result.demoted > 0) {
        const confirm = result.demoted === 1
          ? `Règle affaiblie : "${result.corrections[0].slice(0, 60)}". Elle aura moins d'influence.`
          : `${result.demoted} règles affaiblies. Elles auront moins d'influence.`;
        sse("delta", { text: confirm });
        sse("done", {});
        logLearningEvent(personaId, "rule_weakened", {
          corrections: result.corrections || [],
          demoted: result.demoted,
        });

        if (convId && supabase) {
          try {
            await Promise.all([
              // message_type='meta': the operator→clone instruction and its
              // confirmation must not appear in the DM-simulation thread view.
              supabase.from("messages").insert([
                { conversation_id: convId, role: "user", content: message, message_type: "meta" },
                { conversation_id: convId, role: "assistant", content: confirm, message_type: "meta" },
              ]),
              supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
              supabase.from("conversations")
                .update({ title: extractConvTitle(message, scenario) })
                .eq("id", convId).is("title", null),
            ]);
          } catch (err) {
            console.log(JSON.stringify({ event: "persist_error", ts: new Date().toISOString(), conversation_id: convId, error: err.message }));
          }
        }

        if (convId) sse("conversation", { id: convId });
        res.end();
        return;
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "negative_feedback_shortcircuit_error", ts: new Date().toISOString(), error: e.message }));
    }
  }

  // Short-circuit: direct instruction — save rule and confirm without calling Claude
  if (msgIntent === "INSTRUCTION") {
    try {
      const saved = await detectDirectInstruction(intellId, message, messages, client);
      if (saved > 0) {
        const confirm = saved === 1
          ? "Règle ajoutée. Elle sera active dès ton prochain message."
          : `${saved} règles ajoutées. Elles seront actives dès ton prochain message.`;
        sse("delta", { text: confirm });
        sse("done", {});
        logLearningEvent(personaId, "rule_added", {
          count: saved,
          source_message: message.slice(0, 200),
        });

        if (convId && supabase) {
          try {
            await Promise.all([
              // message_type='meta': the operator→clone instruction and its
              // confirmation must not appear in the DM-simulation thread view.
              supabase.from("messages").insert([
                { conversation_id: convId, role: "user", content: message, message_type: "meta" },
                { conversation_id: convId, role: "assistant", content: confirm, message_type: "meta" },
              ]),
              supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
              supabase.from("conversations")
                .update({ title: extractConvTitle(message, scenario) })
                .eq("id", convId).is("title", null),
            ]);
          } catch (err) {
            console.log(JSON.stringify({ event: "persist_error", ts: new Date().toISOString(), conversation_id: convId, error: err.message }));
          }
        }

        if (convId) sse("conversation", { id: convId });
        res.end();
        return;
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "direct_instruction_shortcircuit_error", ts: new Date().toISOString(), error: e.message }));
    }
  }

  // Multi-model routing: Haiku for simple, Sonnet for complex
  const routing = selectModel({ message, knowledgeMatches, ontology, corrections, scenario });
  console.log(JSON.stringify({ event: "model_routed", ts: new Date().toISOString(), model: routing.model, score: routing.score, reason: routing.reason }));

  try {
    const result = await runPipeline({
      systemPrompt,
      messages,
      sse,
      res,
      voiceRules: persona.voice,
      corrections,
      apiKey,
      model: routing.model,
      personaId: persona.id,
      conversationId: convId || null,
      sources,
      rhythmCtx: {
        isFirstContact: !convId || (Array.isArray(messages) && messages.length <= 1),
        personaOverrides: Array.isArray(persona.voice?.setter_overrides) ? persona.voice.setter_overrides : [],
        personaVoice: persona.voice || null,
      },
    });
    // Persist messages + update conversation (await to avoid Vercel killing the function)
    if (convId && supabase) {
      const botText = result.text || "";
      try {
        const [inserted] = await Promise.all([
          supabase.from("messages").insert([
            { conversation_id: convId, role: "user", content: message },
            { conversation_id: convId, role: "assistant", content: botText },
          ]).select("id, role, created_at"),
          supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
          supabase.from("conversations")
            .update({ title: extractConvTitle(message, scenario) })
            .eq("id", convId).is("title", null),
        ]);
        // Shadow: log prospect heat for the user/prospect message.
        // Non-blocking. Noise from test-prompts filtered later via business_outcomes join.
        const userMsg = inserted?.data?.find(m => m.role === "user");
        if (userMsg) {
          try {
            const { logProspectHeat } = await import("../lib/heat/prospectHeat.js");
            const heatResult = await logProspectHeat({
              messageId: userMsg.id,
              conversationId: convId,
              content: message,
              createdAt: userMsg.created_at,
            });
            if (heatResult) {
              const { extract, deriveState } = await import("../lib/heat/narrativeSignals.js");
              const { data: allHeat } = await supabase
                .from("prospect_heat")
                .select("message_id, heat, delta, signals, created_at")
                .eq("conversation_id", convId)
                .order("created_at", { ascending: true });
              const { data: allMsgs } = await supabase
                .from("messages")
                .select("id, role, content, created_at")
                .eq("conversation_id", convId)
                .order("created_at", { ascending: true })
                .limit(200);
              const normalized = (allMsgs || []).map(m => ({
                ...m,
                role: m.role === "assistant" ? "bot" : m.role,
              }));
              const { signals, total } = extract({
                messages: normalized,
                heatRows: allHeat || [],
                now: new Date(),
              });
              const newSignal = signals.find(s => s.message_id === userMsg.id) || null;
              const { state, direction } = deriveState(heatResult.heat, heatResult.delta);
              sse("heat", {
                current: { heat: heatResult.heat, delta: heatResult.delta, state, direction },
                new_signal: newSignal,
                total_signals: total,
              });
            }
          } catch (err) {
            console.log(JSON.stringify({
              event: "heat_emit_error",
              ts: new Date().toISOString(),
              conversation_id: convId,
              error: err?.message || "Unknown",
            }));
          }
        }
      } catch (err) {
        console.log(JSON.stringify({
          event: "persist_error", ts: new Date().toISOString(),
          conversation_id: convId, error: err.message || "Unknown",
        }));
      }
    }

    // Feedback detection + usage logging BEFORE res.end() to avoid Vercel killing the function
    try {
      const postTasks = [
        detectMetacognitiveInsights(intellId, message, messages, result.text, client, msgIntent),
        (client && result.usage) ? logUsage(client.id, personaId, result.usage.input_tokens, result.usage.output_tokens, { model: routing.model, cacheRead: result.usage.cache_read || 0 }) : null,
      ];
      // Only run coaching/validation detection when classifier says it's relevant
      if (msgIntent === "CORRECTION") postTasks.push(detectCoachingCorrection(intellId, message, messages, client));
      if (msgIntent === "VALIDATION") postTasks.push(detectChatFeedback(intellId, message, messages, client));
      // For CHAT, still try both — the classifier may miss subtle feedback
      if (msgIntent === "CHAT") {
        postTasks.push(detectCoachingCorrection(intellId, message, messages, client));
        postTasks.push(detectChatFeedback(intellId, message, messages, client));
      }
      const postResults = await Promise.all(postTasks);

      // Auto-consolidation: check if new corrections were saved, trigger every 10th
      const totalSaved = postResults.reduce((sum, r) => sum + (typeof r === "number" && r > 0 ? r : 0), 0);
      const feedbackSaved = totalSaved > 0;
      if (feedbackSaved) {
        logLearningEvent(personaId, "correction_saved", {
          source: msgIntent === "CORRECTION" ? "coaching" : (msgIntent === "VALIDATION" ? "validation" : "chat"),
          count: totalSaved,
          text: message.slice(0, 200),
        });
        // Inline consolidation is ONLY for DEMO_MODE (live "wow moment" during demos).
        // In production, /api/cron-consolidate runs every 10 min sequentially — safer, no races.
        if (process.env.DEMO_MODE === "true") {
          try {
            const { count } = await supabase.from("corrections")
              .select("id", { count: "exact", head: true })
              .eq("persona_id", intellId).eq("status", "active");
            if (count && count % 3 === 0 && count >= 3) {
              consolidateCorrections(personaId, { client }).catch(err =>
                console.log(JSON.stringify({ event: "auto_consolidation_error", ts: new Date().toISOString(), error: err.message }))
              );
            }
          } catch { /* non-critical */ }
        }
      }
    } catch (err) {
      console.log(JSON.stringify({ event: "post_response_error", ts: new Date().toISOString(), error: err.message }));
    }

    if (convId) sse("conversation", { id: convId });
    res.end();
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

import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";
import { authenticateRequest, checkBudget, getApiKey, logUsage, hasPersonaAccess, setCors, supabase } from "../lib/supabase.js";
import { recomputeStage } from "../lib/stage.js";
import { getPersonaFromDb, findRelevantKnowledgeFromDb, loadScenarioFromDb, getCorrectionsFromDb, findRelevantEntities, getIntelligenceId } from "../lib/knowledge-db.js";
import { getActiveHardRules } from "../lib/protocol-db.js";
import { getActiveArtifactsForPersona } from "../lib/protocol-v2-db.js";
import { recordFiring, resolveFirings } from "../lib/protocol-v2-rule-counters.js";

/**
 * Chantier 3.1 — emit an implicit_accept feedback_event on a prior bot message
 * when the user sends a follow-up without explicit feedback, and resolve the
 * corresponding rule_firings to outcome='helpful'. Skips if the message
 * already has any feedback_event (avoids overwriting explicit signal).
 *
 * Fire-and-forget — never awaited so chat latency is unchanged. Errors logged.
 */
function emitImplicitAccept(supabase, messageId, conversationId, personaId) {
  (async () => {
    try {
      // Skip if any feedback_event already exists for this message — explicit
      // signal wins over implicit, and we don't want duplicate inserts when a
      // user re-opens the same conversation.
      const { data: existing } = await supabase
        .from("feedback_events")
        .select("id")
        .eq("message_id", messageId)
        .limit(1);
      if (existing && existing.length > 0) return;

      const lePayload = {
        source: "chat_followup_implicit",
        fb_event_type: "implicit_accept",
        message_id: messageId,
        conversation_id: conversationId,
        intensity: "implicit",
      };
      const { data: leData } = await supabase
        .from("learning_events")
        .insert({ persona_id: personaId, event_type: "positive_reinforcement", payload: lePayload })
        .select("id").single();

      await supabase.from("feedback_events").insert({
        conversation_id: conversationId,
        message_id: messageId,
        persona_id: personaId,
        event_type: "implicit_accept",
        rules_fired: [],
        learning_event_id: leData?.id || null,
      });

      await resolveFirings({ supabase, messageId, outcome: "helpful" });
    } catch (err) {
      console.log(JSON.stringify({
        event: "implicit_accept_error",
        ts: new Date().toISOString(),
        message_id: messageId,
        error: err?.message || "Unknown",
      }));
    }
  })();
}
import { detectChatFeedback, detectDirectInstruction, detectCoachingCorrection, detectMetacognitiveInsights, looksLikeDirectInstruction, looksLikeNegativeFeedback, detectNegativeFeedback, classifyMessage, looksLikeHorsCible } from "../lib/feedback-detect.js";
import { selectModel } from "../lib/model-router.js";
import { consolidateCorrections } from "../lib/correction-consolidation.js";
import { logLearningEvent } from "../lib/learning-events.js";
import { isScenarioId } from "../src/lib/scenarios.js";

/** Extract a smart conversation title from the first message */
function extractConvTitle(message, scenario) {
  // LinkedIn scrape: [Contexte lead — NOM PRENOM]
  const leadMatch = message.match(/\[Contexte lead\s*[—–-]\s*([^\]]+)\]/i);
  if (leadMatch) {
    const name = leadMatch[1].trim();
    if (name) return name.slice(0, 50);
  }

  // Raw LinkedIn URL as first message (user bypassed the Analyser prospect
  // banner and hit Cmd+Enter directly) → extract the slug so the sidebar
  // shows "John Doe" instead of the full URL.
  const urlMatch = message.trim().match(/^https?:\/\/(?:www\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
  if (urlMatch) {
    const slug = urlMatch[1].replace(/[-_]+/g, " ").trim();
    if (slug) return slug.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 50);
  }

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

  // Outer guard: surface the real error instead of Vercel's opaque
  // FUNCTION_INVOCATION_FAILED when any pre-pipeline await throws
  // (getPersonaFromDb, loadScenarioFromDb, classifyMessage, etc.).
  try {
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

  const { message, history: bodyHistory, scenario, scenario_type: rawScenarioType, source_core: rawSourceCore, persona: personaId, conversation_id } = req.body;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Sprint 0.b dual-write : only accept a well-formed canonical id. Unknown
  // strings are dropped silently (legacy `scenario` text still wins for
  // compatibility). The DB column is a Postgres enum, so a bad value would
  // fail the insert otherwise.
  const scenarioType = isScenarioId(rawScenarioType) ? rawScenarioType : null;

  // Migration 055 : source_core (lead origin) is orthogonal to scenario_type.
  // Only accept the 6 core values; bad values are silently dropped (the CHECK
  // constraint would also reject them at insert time). Source-specific playbook
  // assembly happens at line ~285 below if a value resolves on the conv.
  const SOURCE_CORE_VALUES = new Set([
    "visite_profil", "dr_recue", "interaction_contenu",
    "premier_degre", "spyer", "sales_nav",
  ]);
  const sourceCoreFromBody = SOURCE_CORE_VALUES.has(rawSourceCore) ? rawSourceCore : null;

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

  // Source-core resolved on this conversation (loaded from DB or set on insert).
  // Used downstream by getActiveArtifactsForPersona to merge in the source-specific
  // playbook (cf migration 055).
  let convSourceCore = null;

  if (convId) {
    // Load existing conversation
    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, client_id, scenario, scenario_type, source_core")
      .eq("id", convId).single();

    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Ownership check — admins bypass
    if (client && !isAdmin && conv.client_id !== client.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Persist scenario_type on the conv si l'user a flipé un sous-mode DM
    // depuis le dernier draft (DM_1st → DM_relance, etc.). Sinon l'auto-stage
    // (Bloc 2) n'aurait qu'une valeur figée à la création — jamais "follow_up"
    // ni "closing".
    if (scenarioType && conv.scenario_type !== scenarioType) {
      await supabase
        .from("conversations")
        .update({ scenario_type: scenarioType })
        .eq("id", convId);
    }

    // Persist source_core if the operator just set it (e.g. tagging an existing
    // conv as visite_profil after the fact). Body value wins over the persisted
    // one when it differs ; null is never a valid override (you can't UN-tag a
    // source via this path, by design — keep it explicit).
    if (sourceCoreFromBody && conv.source_core !== sourceCoreFromBody) {
      await supabase
        .from("conversations")
        .update({ source_core: sourceCoreFromBody })
        .eq("id", convId);
      convSourceCore = sourceCoreFromBody;
    } else {
      convSourceCore = conv.source_core || null;
    }

    // Load last 40 chat messages from DB. Filter out `message_type='meta'`
    // (rule-added/weakened confirmations inserted by short-circuits) — they
    // pollute the DM thread and confuse the LLM into restarting the context.
    // Limit bumped from 19 → 40 so long prospect threads keep the full arc
    // in-context.
    const { data: dbMessages } = await supabase
      .from("messages").select("id, role, content")
      .eq("conversation_id", convId)
      .eq("message_type", "chat")
      .order("created_at", { ascending: false })
      .limit(40);

    const history = (dbMessages || []).reverse();
    // Chantier 3.1 — implicit_accept on the prior bot message. The user just
    // sent a follow-up without correcting → strongest signal we have that the
    // previous output was acceptable. Best-effort, fire-and-forget so chat
    // latency is unchanged. Skips if the message already has any feedback row.
    const lastBotInHistory = [...history].reverse().find((m) => m.role === "assistant");
    if (lastBotInHistory?.id) {
      emitImplicitAccept(supabase, lastBotInHistory.id, convId, personaId);
    }
    messages = [...history.map(({ role, content }) => ({ role, content })), { role: "user", content: message }];
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
      // Migration 055 : persist source_core (lead origin) so the source-specific
      // playbook can be assembled on subsequent turns of the same conv.
      if (sourceCoreFromBody) {
        insertData.source_core = sourceCoreFromBody;
        convSourceCore = sourceCoreFromBody;
      }
      const { data: newConv, error: convInsErr } = await supabase
        .from("conversations").insert(insertData).select("id").single();
      if (convInsErr) {
        console.log(JSON.stringify({
          event: "persist_error", ts: new Date().toISOString(),
          stage: "conversation_insert",
          error: convInsErr.message, code: convInsErr.code,
          details: convInsErr.details, hint: convInsErr.hint,
        }));
      }
      convId = newConv?.id || null;
      // Pipeline stage auto (Bloc 2) : conv créée = 'to_contact' par défaut.
      // Best-effort, non-bloquant si la recompute échoue.
      if (convId) {
        recomputeStage(supabase, convId).catch(() => {});
      }
    }

    messages = [...history, { role: "user", content: message }];
  }

  // Resolve scenario
  const scenarioConfig = persona.scenarios[scenario] || persona.scenarios.default || Object.values(persona.scenarios)[0];
  const scenarioSlug = scenarioConfig?.slug || scenario || "default";
  const baseScenarioContent = await loadScenarioFromDb(personaId, scenarioSlug);

  // Canonical scenario overrides — injected on top of the stored scenario file
  // to give sub-type-specific instructions without rewriting per-persona DB files.
  const SCENARIO_OVERRIDES = {
    DM_1st: `## MODE : DM 1er message (cold outreach)
Génère directement UN premier message d'approche — pas d'accueil, pas de "colle-moi un profil". Le thread contient déjà le [Contexte lead] du prospect ; sers-t'en.
Accroche OBLIGATOIREMENT sur un élément concret du contexte lead : un post récent du prospect, son titre, un sujet du moment. Pas d'opener générique type "j'ai vu ton profil".
Longueur : 150-280 caractères, 2-4 lignes courtes. UNE question max.`,

    DM_relance: `## MODE : DM Relance (follow-up après silence)
Le prospect n'a pas répondu au dernier DM. Génère UN follow-up pour réouvrir, sans insister.
Accroche OBLIGATOIREMENT via un des éléments du [Contexte lead] déjà en thread : un post récent du prospect, sa fréquence de publi, son titre, son activité. Pas de "je me permets de te relancer" générique. Pas de répétition du 1er DM.
Si rien d'exploitable dans le contexte lead, dis-le honnêtement à l'opérateur — ne force pas une relance creuse.
Longueur : 150-280 caractères, 2-3 lignes courtes. Pas de question lourde — un hook léger pour rouvrir.`,

    DM_reply: `## MODE : DM Réponse (prospect a répondu)
Le prospect vient de répondre. Réponds à ce qu'il a dit réellement — ne pivote pas vers ton offre trop vite.
Reprends un mot/idée clé de sa réponse. Si sa réponse ouvre une question business, pose UNE question de découverte pour avancer dans l'entonnoir. Si sa réponse est neutre/évasive, relance légèrement sur le sujet initial.
Longueur : 150-280 caractères, 2-4 lignes. UNE question max, alignée sur l'état de l'entonnoir.`,

    DM_closing: `## MODE : DM Closing (proposition de RDV)
Le prospect est suffisamment chaud pour booker. Propose UN call / RDV explicitement.
Structure : rappelle l'enjeu identifié (1 ligne) → propose un call + lien calendrier. Pas de re-pitch massif, pas de "on en reparle un jour".
Longueur : 150-280 caractères, 2-3 lignes. CTA clair avec lien calendrier (placeholder si l'URL n'est pas dans la persona).`,
  };

  const override = scenarioType ? SCENARIO_OVERRIDES[scenarioType] : null;
  const scenarioContent = override
    ? (override + "\n\n" + (baseScenarioContent || ""))
    : baseScenarioContent;

  // Entities + corrections + protocol rules + protocol_v2 artifacts in parallel.
  // ALL pre-stream loaders must fail silently: an upstream blip (Voyage 5xx,
  // Supabase timeout) must never bubble up and 500 the request — that path
  // returns 5xx to the client before initSSE, the SSE client retries 5×, and
  // the user sees "Connexion perdue. Reessayez." Graceful degradation = chat
  // without RAG/entities/corrections this turn, instead of no chat at all.
  // Migration 055 : when convSourceCore is set, the artifact loader merges in
  // the persona's source-specific playbook (visite_profil, etc.) on top of the
  // global doc. NULL preserves pre-055 behavior (global doc only).
  const [ontology, corrections, protocolRules, protocolArtifacts] = await Promise.all([
    findRelevantEntities(personaId, messages).catch((err) => {
      console.log(JSON.stringify({ event: "entities_load_error", ts: new Date().toISOString(), persona: personaId, error: err?.message || "Unknown" }));
      return { entities: [], relations: [], boostTerms: [] };
    }),
    getCorrectionsFromDb(personaId).catch((err) => {
      console.log(JSON.stringify({ event: "corrections_load_error", ts: new Date().toISOString(), persona: personaId, error: err?.message || "Unknown" }));
      return [];
    }),
    getActiveHardRules(personaId, scenario).catch(() => []),
    getActiveArtifactsForPersona(supabase, personaId, { sourceCore: convSourceCore }).catch(() => []),
  ]);

  // Knowledge uses boost terms from graph — must wait for ontology
  const knowledgeMatches = await findRelevantKnowledgeFromDb(personaId, messages, ontology.boostTerms).catch((err) => {
    console.log(JSON.stringify({ event: "knowledge_load_error", ts: new Date().toISOString(), persona: personaId, error: err?.message || "Unknown" }));
    return [];
  });

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
    injectedArtifactIds,
  } = buildSystemPrompt({
    persona,
    knowledgeMatches,
    scenarioContent,
    corrections,
    ontology,
    protocolRules,
    protocolArtifacts,
    scenarioSlug: scenario,
  });

  // Audit trail: what actually shaped THIS response — sent to the UI so the
  // user can see "why did the clone say that?" instead of a black box.
  const sources = {
    knowledgePages: detectedPages || [],
    entities: injectedEntities || [],
    correctionsCount: injectedCorrectionsCount || 0,
  };

  const sse = initSSE(res, req);
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
                { conversation_id: convId, role: "user", content: message, message_type: "meta", turn_kind: "meta" },
                { conversation_id: convId, role: "assistant", content: confirm, message_type: "meta", turn_kind: "meta" },
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
      const { count: saved, rules: savedRules } = await detectDirectInstruction(intellId, message, messages, client);
      if (saved > 0) {
        const confirm = saved === 1
          ? "Règle ajoutée. Elle sera active dès ton prochain message."
          : `${saved} règles ajoutées. Elles seront actives dès ton prochain message.`;
        sse("delta", { text: confirm });
        sse("done", {});
        // Direct instruction writes straight into writingRules — functionally
        // equivalent to a consolidated rule, so we emit the same event type
        // rather than a separate rule_added step.
        logLearningEvent(personaId, "consolidation_run", {
          promoted: saved,
          rules: savedRules,
          source_message: message.slice(0, 200),
        });

        if (convId && supabase) {
          try {
            await Promise.all([
              // message_type='meta': the operator→clone instruction and its
              // confirmation must not appear in the DM-simulation thread view.
              supabase.from("messages").insert([
                { conversation_id: convId, role: "user", content: message, message_type: "meta", turn_kind: "meta" },
                { conversation_id: convId, role: "assistant", content: confirm, message_type: "meta", turn_kind: "meta" },
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

  // Short-circuit: STOP — prospect hors-cible, ne pas générer de message
  if (msgIntent === "STOP") {
    const confirm = "Compris — prospect hors-cible. Je ne propose plus de messages pour ce contact.";
    sse("delta", { text: confirm });
    sse("done", {});
    logLearningEvent(personaId, "prospect_out_of_target", {
      source_message: message.slice(0, 200),
    });

    if (convId && supabase) {
      try {
        await Promise.all([
          supabase.from("messages").insert([
            { conversation_id: convId, role: "user", content: message, message_type: "meta", turn_kind: "meta" },
            { conversation_id: convId, role: "assistant", content: confirm, message_type: "meta", turn_kind: "meta" },
          ]),
          supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
        ]);
      } catch (persistErr) {
        console.log(JSON.stringify({
          event: "chat_negative_persist_error",
          ts: new Date().toISOString(),
          conversation: convId,
          error: persistErr?.message || "Unknown",
        }));
      }
    }

    if (convId) sse("conversation", { id: convId });
    res.end();
    return;
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
        // Dernier message du prospect — sert aux règles miroir (B5 vouvoiement par défaut).
        priorLeadMessage: (() => {
          const last = Array.isArray(messages) ? [...messages].reverse().find(m => m.role === "user") : null;
          return typeof last?.content === "string" ? last.content : "";
        })(),
        // Flags de préférences documentées per-persona, lus par les règles setter.
        persona: { tutoiement_default: !!persona.voice?.tutoiement_default },
        scenario,
      },
    });
    // Persist messages + update conversation (await to avoid Vercel killing the function)
    if (convId && supabase) {
      const botText = result.text || "";
      try {
        const [inserted, updLast, updTitle] = await Promise.all([
          supabase.from("messages").insert([
            // turn_kind explicit on BOTH rows — PostgREST normalizes columns
            // across a batch insert, so if row 2 has turn_kind, row 1 gets
            // turn_kind=null (not the DEFAULT) → NOT NULL violation → both
            // rows lost. Regression introduced by eb923bd (2026-04-20).
            { conversation_id: convId, role: "user", content: message, turn_kind: "prospect" },
            { conversation_id: convId, role: "assistant", content: botText, turn_kind: "clone_draft" },
          ]).select("id, role, created_at"),
          supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
          supabase.from("conversations")
            .update({ title: extractConvTitle(message, scenario) })
            .eq("id", convId).is("title", null),
        ]);
        if (inserted?.error) {
          console.log(JSON.stringify({
            event: "persist_error", ts: new Date().toISOString(),
            conversation_id: convId, stage: "messages_insert",
            error: inserted.error.message, code: inserted.error.code,
            details: inserted.error.details, hint: inserted.error.hint,
          }));
          sse("persist_error", { stage: "messages_insert", message: inserted.error.message || "Unknown" });
        }
        if (updLast?.error) {
          console.log(JSON.stringify({
            event: "persist_error", ts: new Date().toISOString(),
            conversation_id: convId, stage: "conv_last_message_update",
            error: updLast.error.message, code: updLast.error.code,
          }));
        }
        if (updTitle?.error) {
          console.log(JSON.stringify({
            event: "persist_error", ts: new Date().toISOString(),
            conversation_id: convId, stage: "conv_title_update",
            error: updTitle.error.message, code: updTitle.error.code,
          }));
        }
        // Bug #1 — emit the real DB message IDs so the front can rebind its
        // temporary client-generated UUIDs. Without this, PATCH /api/messages
        // and POST /api/feedback-events (FK on message_id) 404/500 silently
        // and the FeedbackRail stays empty after "c'est ça".
        if (inserted?.data && !inserted?.error) {
          const dbUser = inserted.data.find((m) => m.role === "user");
          const dbBot = inserted.data.find((m) => m.role === "assistant");
          if (dbUser || dbBot) {
            sse("ids", {
              user_message_id: dbUser?.id || null,
              bot_message_id: dbBot?.id || null,
            });
          }
          // Link rhythm_shadow row to the assistant message id (post-fix for
          // critic-prod-coverage bug : shadow rows used to land with message_id=null
          // because the pipeline persisted them before the message existed).
          if (dbBot?.id && result.shadowRowIdPromise) {
            try {
              const shadowId = await result.shadowRowIdPromise;
              if (shadowId) {
                await supabase.from("rhythm_shadow").update({ message_id: dbBot.id }).eq("id", shadowId);
              }
            } catch { /* best-effort linking — never fail the chat for this */ }
          }
          // Chantier 2bis — log a rule_firing row per artifact that made it
          // into the system prompt. Outcome='pending' until the user resolves
          // the message (helpful/harmful), which Chantier 3 will wire.
          if (dbBot?.id && Array.isArray(injectedArtifactIds) && injectedArtifactIds.length > 0) {
            recordFiring({
              supabase,
              artifactIds: injectedArtifactIds,
              messageId: dbBot.id,
              conversationId: convId,
              personaId,
            }).catch(() => { /* best-effort telemetry — never fail the chat */ });
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
  } catch (err) {
    console.log(JSON.stringify({
      event: "chat_handler_crash", ts: new Date().toISOString(),
      error: err?.message || "Unknown",
      stack: err?.stack?.slice(0, 1500),
    }));
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur serveur (pre-pipeline): " + (err?.message || "Unknown") });
    } else {
      try {
        res.end();
      } catch (endErr) {
        console.log(JSON.stringify({
          event: "chat_res_end_failed",
          ts: new Date().toISOString(),
          error: endErr?.message || "Unknown",
        }));
      }
    }
  }
}

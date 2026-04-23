import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { persistShadow } from "../lib/critic/rhythmCritic.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";
import { authenticateRequest, checkBudget, getApiKey, logUsage, hasPersonaAccess, setCors, supabase } from "../lib/supabase.js";
import { recomputeStage } from "../lib/stage.js";
import { getPersonaFromDb, findRelevantKnowledgeFromDb, loadScenarioFromDb, getCorrectionsFromDb, findRelevantEntities, getIntelligenceId } from "../lib/knowledge-db.js";
import { getActiveHardRules } from "../lib/protocol-db.js";
import { detectChatFeedback, detectDirectInstruction, detectCoachingCorrection, detectMetacognitiveInsights, looksLikeDirectInstruction, looksLikeNegativeFeedback, detectNegativeFeedback, classifyMessage, looksLikeHorsCible } from "../lib/feedback-detect.js";
import { selectModel } from "../lib/model-router.js";
import { consolidateCorrections } from "../lib/correction-consolidation.js";
import { logLearningEvent } from "../lib/learning-events.js";
import { isScenarioId, CANONICAL_SCENARIOS } from "../src/lib/scenarios.js";

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
      .from("conversations").select("id, client_id, scenario, scenario_type")
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

    // Load last 40 chat messages from DB. Filter out `message_type='meta'`
    // (rule-added/weakened confirmations inserted by short-circuits) — they
    // pollute the DM thread and confuse the LLM into restarting the context.
    // Limit bumped from 19 → 40 so long prospect threads keep the full arc
    // in-context.
    const { data: dbMessages } = await supabase
      .from("messages").select("role, content")
      .eq("conversation_id", convId)
      .eq("message_type", "chat")
      .order("created_at", { ascending: false })
      .limit(40);

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
    post_lead_magnet: `## MODE : Post Lead Magnet
Génère directement un post complet. Ne pose pas de questions sauf si le sujet est totalement absent.
Structure obligatoire : accroche forte → valeur concrète → CTA explicite vers le lead magnet.
Le CTA doit nommer le lead magnet et expliquer comment l'obtenir (commenter, DM, lien bio, etc.).
Longueur : 800–1 500 caractères. Pas de question générique en fin de post.`,

    post_actu: `## MODE : Post Actualité Croisée
Génère directement un post. Si aucune actu n'est fournie, demande-la en UNE question.
Structure : accroche sur l'actu → angle personnel → leçon/opinion → CTA léger.`,

    post_prise_position: `## MODE : Post Prise de Position
Génère directement un post avec une opinion tranchée. Ne cherche pas à nuancer.
Structure : affirmation forte en accroche → argument principal → contre-argument bref → conclusion assumée.`,

    post_framework: `## MODE : Post Framework
Génère directement un post. Si aucun framework n'est fourni, demande le sujet en UNE question.
Structure : accroche → framework en étapes numérotées ou liste → insight final.`,

    post_coulisse: `## MODE : Post Coulisse
Génère directement un post en mode storytelling interne/transparence.
Structure : situation concrète → ce que j'ai appris/découvert → leçon universelle.`,

    post_cas_client: `## MODE : Post Cas Client
Génère directement un post centré sur un résultat client concret. Si le starter chip a été utilisé, les infos clés (client/secteur, situation de départ, résultat, durée, levier) sont dans le message de l'opérateur — reprends-les sans les inventer.
Structure : accroche sur le résultat chiffré ou l'avant/après → contexte court (situation de départ) → ce qui a été fait → résultat détaillé → leçon transférable (pas un CTA clickbait).
Si des infos manquent pour un cas crédible (chiffre, durée, levier), demande-les en UNE question avant d'écrire. Pas d'invention de chiffres.
Longueur : 1000-2000 caractères.`,

    post_autonome: `## MODE : Post Autonome
Génère directement un post standalone sans CTA fort. Si le sujet manque, pose UNE question.`,

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

  // Kind drives the FORMAT DE REPONSE (post = single block, dm = WhatsApp thread).
  // Canonical id is authoritative. Without one, only scenario==="post" is a
  // reliable post signal — everything else (qualification, default, empty)
  // stays on DM defaults for back-compat.
  const scenarioKind = scenarioType
    ? CANONICAL_SCENARIOS[scenarioType].kind
    : scenario === "post" ? "post" : "dm";

  // Entities + corrections + protocol rules in parallel.
  // Protocol rules fail silently: an opt-in layer must never block the chat.
  const [ontology, corrections, protocolRules] = await Promise.all([
    findRelevantEntities(personaId, messages),
    getCorrectionsFromDb(personaId),
    getActiveHardRules(personaId, scenario).catch(() => []),
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
    scenarioKind,
    protocolRules,
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
      } catch {}
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
          // Persist rhythm critic shadow ici (post-insert) pour obtenir un
          // vrai message_id. Avant ce fix, persistShadow était appelé depuis
          // pipeline.js avant insert → toutes les rows avaient message_id=NULL.
          if (dbBot?.id && result.criticResult && result.criticDraft) {
            persistShadow({
              personaId: persona.id,
              conversationId: convId,
              messageId: dbBot.id,
              draft: result.criticDraft,
              result: result.criticResult,
            }).then((r) => {
              if (r?.error) {
                console.log(JSON.stringify({
                  event: "persist_error", ts: new Date().toISOString(),
                  conversation_id: convId, stage: "rhythm_shadow_insert",
                  error: r.error.message, code: r.error.code, details: r.error.details,
                }));
              }
            }).catch((err) => {
              console.log(JSON.stringify({
                event: "persist_error", ts: new Date().toISOString(),
                conversation_id: convId, stage: "rhythm_shadow_throw",
                error: err?.message || String(err),
              }));
            });
          }
        }
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

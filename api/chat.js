import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";
import { authenticateRequest, checkBudget, getApiKey, logUsage, setCors } from "../lib/supabase.js";
import { getPersonaFromDb, findRelevantKnowledgeFromDb, loadScenarioFromDb, getCorrectionsFromDb, findRelevantEntities } from "../lib/knowledge-db.js";

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

  const { message, history, scenario, persona: personaId } = req.body;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Load persona data from DB
  const persona = await getPersonaFromDb(personaId);
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const messages = [...history.slice(-19), { role: "user", content: message }];

  // Resolve scenario
  const scenarioConfig = persona.scenarios[scenario] || persona.scenarios.default || Object.values(persona.scenarios)[0];
  const scenarioSlug = scenarioConfig?.slug || scenario || "default";
  const scenarioContent = await loadScenarioFromDb(personaId, scenarioSlug);

  // Resolve knowledge + corrections + ontology
  const knowledgeMatches = await findRelevantKnowledgeFromDb(personaId, messages);
  const corrections = await getCorrectionsFromDb(personaId);
  const ontology = await findRelevantEntities(personaId, messages);

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

  // Prepare knowledge context summary for the scorer
  const knowledgeContext = knowledgeMatches.map(m => m.content).join("\n").slice(0, 1000);

  const sse = initSSE(res);
  const apiKey = getApiKey(client);

  try {
    const result = await runPipeline({
      systemPrompt,
      messages,
      sse,
      res,
      voiceRules: persona.voice,
      corrections,
      apiKey,
      knowledgeContext,
    });
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

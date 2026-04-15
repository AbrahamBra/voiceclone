import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, setCors } from "../lib/supabase.js";
import { clearCache, loadPersonaData } from "../lib/knowledge-db.js";

const GRAPH_EXTRACTION_PROMPT = `Tu es un expert en extraction de connaissances pour un clone de voix IA.
Un utilisateur vient de corriger une reponse de son clone. Analyse sa correction et extrais TOUT ce qui peut ameliorer le clone :

1. Regles de style (ton, longueur, formulation, mots interdits, expressions preferees)
2. Concepts metier (frameworks, methodologies, croyances, outils)
3. Preferences relationnelles (tutoiement, niveau de formalite, emoticons)
4. Connaissances domaine (faits, metriques, personnes, entreprises)

Types d'entites : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

IMPORTANT : Les corrections de STYLE sont aussi importantes que les corrections de fond.
"Trop formel" → entite style_rule "tutoiement obligatoire"
"Trop long" → entite style_rule "messages courts (5-15 mots)"
"Pas assez direct" → entite style_rule "aller droit au but"

Reponds en JSON :
{
  "has_graph_update": true/false,
  "new_entities": [{ "name": "...", "type": "...", "description": "..." }],
  "new_relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }],
  "updated_entities": [{ "name": "...", "description": "nouvelle description" }]
}

Reponds {"has_graph_update": false} UNIQUEMENT si la correction est vide ou incomprehensible.`;

export default async function handler(req, res) {
  setCors(res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // ── GET: Intelligence data ──
  if (req.method === "GET") {
    const personaId = req.query?.persona;
    if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

    if (!isAdmin) {
      const { data: persona } = await supabase
        .from("personas").select("client_id").eq("id", personaId).single();
      if (!persona || persona.client_id !== client?.id) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    const data = await loadPersonaData(personaId);
    if (!data) { res.status(404).json({ error: "Persona not found" }); return; }

    const entityMap = {};
    for (const e of data.entities) entityMap[e.id] = e.name;

    const entities = data.entities.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
      confidence: e.confidence,
      last_matched_at: e.last_matched_at,
      relations: data.relations
        .filter(r => r.from_entity_id === e.id)
        .map(r => ({
          type: r.relation_type,
          target: entityMap[r.to_entity_id] || "?",
          confidence: r.confidence,
        })),
    }));

    const confidences = entities.map(e => e.confidence || 1.0);
    const confidenceAvg = confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : 0;

    const corrections = [...data.corrections]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);

    res.json({
      stats: {
        corrections_total: data.corrections.length,
        entities_total: entities.length,
        relations_total: data.relations.length,
        confidence_avg: confidenceAvg,
      },
      corrections,
      entities,
    });
    return;
  }

  // ── DELETE: Remove a correction ──
  if (req.method === "DELETE") {
    const personaId = req.query?.persona;
    const correctionId = req.query?.correction;
    if (!personaId || !correctionId) {
      res.status(400).json({ error: "persona and correction are required" }); return;
    }

    if (!isAdmin) {
      const { data: persona } = await supabase
        .from("personas").select("client_id").eq("id", personaId).single();
      if (!persona || persona.client_id !== client?.id) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", correctionId)
      .eq("persona_id", personaId);

    if (error) { res.status(500).json({ error: "Failed to delete" }); return; }

    clearCache(personaId);
    res.json({ ok: true });
    return;
  }

  // ── POST: Submit correction ──
  const { correction, botMessage, userMessage, persona: personaId, type, original, modified, accepted } = req.body || {};

  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Ownership check
  if (!isAdmin && supabase) {
    const { data: persona } = await supabase.from("personas").select("client_id").eq("id", personaId).single();
    if (!persona || persona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  // ── Type "regenerate": generate 2 alternatives based on correction ──
  if (type === "regenerate") {
    if (!correction || !botMessage) {
      res.status(400).json({ error: "correction and botMessage required for regenerate" });
      return;
    }
    try {
      const apiKey = getApiKey(client);
      const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

      // Load persona for voice context
      const { getPersonaFromDb } = await import("../lib/knowledge-db.js");
      const persona = await getPersonaFromDb(personaId);
      const voiceContext = persona
        ? `Ton: ${persona.voice.tone.join(", ")}. Regles: ${persona.voice.writingRules.join("; ")}. Mots interdits: ${persona.voice.forbiddenWords.join(", ")}.`
        : "";

      const result = await anthropic.messages.create({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `Tu es un assistant qui reecrit des messages. ${voiceContext}`,
        messages: [{
          role: "user",
          content: `Message original du bot :\n"${botMessage.slice(0, 500)}"\n\nCorrection demandee par l'utilisateur :\n"${correction}"\n\nGenere exactement 2 alternatives qui corrigent le probleme. Reponds en JSON :\n{"alternatives": ["alternative 1", "alternative 2"]}`,
        }],
      });

      const raw = result.content[0].text.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        res.json({ ok: true, alternatives: data.alternatives || [] });
      } else {
        res.json({ ok: true, alternatives: [] });
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to generate alternatives: " + e.message });
    }
    return;
  }

  // ── Type "accept": user picked an alternative — save correction + knowledge ──
  if (type === "accept" && accepted) {
    const finalCorrection = correction || `L'utilisateur a prefere cette version : "${accepted.slice(0, 200)}"`;

    // Save correction
    await supabase.from("corrections").insert({
      persona_id: personaId,
      correction: finalCorrection,
      user_message: userMessage?.slice(0, 200) || null,
      bot_message: botMessage?.slice(0, 300) || null,
    });

    // Extract graph knowledge (same as existing flow below)
    // Fire-and-forget for speed
    extractGraphKnowledge(personaId, finalCorrection, botMessage, userMessage, client).catch(() => {});

    clearCache(personaId);
    res.json({ ok: true, message: "Correction enregistree et clone ameliore", accepted });
    return;
  }

  // Handle implicit feedback (diff between original and modified message)
  let finalCorrection = correction;
  if (type === "implicit") {
    if (!original || !modified || original === modified) {
      res.status(400).json({ error: "original and modified are required for implicit feedback" });
      return;
    }
    // Generate a correction description from the diff
    try {
      const apiKey = getApiKey(client);
      const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
      const diffResult = await anthropic.messages.create({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: "Compare ces deux versions d'un message. Decris en 1-2 phrases les modifications de style effectuees par l'utilisateur. Sois concis et actionnable.",
        messages: [{ role: "user", content: `ORIGINAL :\n${original.slice(0, 500)}\n\nMODIFIE :\n${modified.slice(0, 500)}` }],
      });
      finalCorrection = diffResult.content[0].text.trim();
    } catch (e) {
      // Fallback: simple description
      finalCorrection = `L'utilisateur a modifie le message avant de l'envoyer.`;
    }
  }

  if (!finalCorrection || typeof finalCorrection !== "string" || finalCorrection.length < 3 || finalCorrection.length > 500) {
    res.status(400).json({ error: "correction must be a string of 3-500 chars" });
    return;
  }

  // 1. Save the correction (always)
  const { error } = await supabase.from("corrections").insert({
    persona_id: personaId,
    correction: finalCorrection,
    user_message: type === "implicit" ? "[diff implicite]" : userMessage?.slice(0, 200) || null,
    bot_message: type === "implicit" ? original?.slice(0, 300) : botMessage?.slice(0, 300) || null,
  });

  if (error) {
    res.status(500).json({ error: "Failed to save correction" });
    return;
  }

  // 2. Extract graph knowledge (fire-and-forget for speed)
  extractGraphKnowledge(personaId, finalCorrection, botMessage || original, userMessage, client).catch(() => {});

  clearCache(personaId);

  res.json({
    ok: true,
    message: "Correction enregistree",
  });
}

/**
 * Extract entities/relations from a correction and upsert into knowledge graph.
 * Runs async — caller doesn't wait for this to complete.
 */
async function extractGraphKnowledge(personaId, correctionText, botMsg, userMsg, client) {
  try {
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    const { data: existingEntities } = await supabase
      .from("knowledge_entities")
      .select("name, type, description")
      .eq("persona_id", personaId);

    const entityContext = existingEntities?.length > 0
      ? `\n\nEntites existantes dans le graphe :\n${existingEntities.map(e => `- ${e.name} (${e.type}): ${e.description}`).join("\n")}`
      : "";

    const result = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: GRAPH_EXTRACTION_PROMPT + entityContext,
      messages: [{
        role: "user",
        content: `Correction du client : "${correctionText}"\n\nContexte — message bot : "${(botMsg || "").slice(0, 200)}"\nMessage user : "${(userMsg || "").slice(0, 200)}"`,
      }],
    });

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const graphData = JSON.parse(jsonMatch[0]);
    if (!graphData.has_graph_update) return;

    if (graphData.new_entities?.length > 0) {
      const entityRows = graphData.new_entities.map(e => ({
        persona_id: personaId,
        name: e.name,
        type: e.type || "concept",
        description: e.description || "",
        confidence: 0.8,
      }));

      const { data: inserted } = await supabase
        .from("knowledge_entities")
        .upsert(entityRows, { onConflict: "persona_id,name" })
        .select("id, name");

      if (inserted?.length > 0 && graphData.new_relations?.length > 0) {
        const { data: allEntities } = await supabase
          .from("knowledge_entities").select("id, name").eq("persona_id", personaId);
        const entityMap = {};
        for (const e of (allEntities || [])) entityMap[e.name] = e.id;

        const relationRows = graphData.new_relations
          .filter(r => entityMap[r.from] && entityMap[r.to])
          .map(r => ({
            persona_id: personaId,
            from_entity_id: entityMap[r.from],
            to_entity_id: entityMap[r.to],
            relation_type: r.type || "uses",
            description: r.description || "",
            confidence: 0.8,
          }));
        if (relationRows.length > 0) {
          await supabase.from("knowledge_relations").insert(relationRows);
        }
      }
    }

    if (graphData.updated_entities?.length > 0) {
      for (const upd of graphData.updated_entities) {
        await supabase.from("knowledge_entities")
          .update({ description: upd.description })
          .eq("persona_id", personaId).eq("name", upd.name);
      }
    }
  } catch (e) {
    console.log(JSON.stringify({ event: "graph_extraction_error", persona: personaId, error: e.message }));
  }
}

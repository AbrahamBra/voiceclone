import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, setCors } from "../lib/supabase.js";
import { clearCache } from "../lib/knowledge-db.js";

const GRAPH_EXTRACTION_PROMPT = `Tu es un expert en extraction de connaissances.
Un utilisateur vient de corriger une reponse de son clone IA. Analyse sa correction et determine :

1. Y a-t-il de NOUVELLES entites (concepts, frameworks, croyances, outils) a ajouter au graphe de connaissances ?
2. Y a-t-il des RELATIONS existantes a modifier ou de nouvelles relations a creer ?
3. Y a-t-il des entites existantes dont la description doit etre mise a jour ?

Types d'entites : concept, framework, person, company, metric, belief, tool
Types de relations : equals, includes, contradicts, causes, uses, prerequisite

Reponds en JSON :
{
  "has_graph_update": true/false,
  "new_entities": [{ "name": "...", "type": "...", "description": "..." }],
  "new_relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }],
  "updated_entities": [{ "name": "...", "description": "nouvelle description" }]
}

Si la correction est juste stylistique (ton, longueur, formulation), reponds {"has_graph_update": false}. N'ajoute au graphe que des CONCEPTS substantiels.`;

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { correction, botMessage, userMessage, persona: personaId, type, original, modified } = req.body || {};

  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

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

  // 2. Extract graph updates from the correction (async, non-blocking for the response)
  let graphUpdated = false;
  try {
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    // Load existing entities for context
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
        content: `Correction du client : "${correction}"\n\nContexte — message bot : "${(botMessage || "").slice(0, 200)}"\nMessage user : "${(userMessage || "").slice(0, 200)}"`,
      }],
    });

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const graphData = JSON.parse(jsonMatch[0]);

      if (graphData.has_graph_update) {
        // Insert new entities
        if (graphData.new_entities?.length > 0) {
          const entityRows = graphData.new_entities.map(e => ({
            persona_id: personaId,
            name: e.name,
            type: e.type || "concept",
            description: e.description || "",
            confidence: 0.8, // slightly lower confidence for feedback-derived entities
          }));

          const { data: inserted } = await supabase
            .from("knowledge_entities")
            .upsert(entityRows, { onConflict: "persona_id,name" })
            .select("id, name");

          if (inserted?.length > 0) {
            graphUpdated = true;

            // Insert new relations
            if (graphData.new_relations?.length > 0) {
              // Need to get all entity IDs (existing + new)
              const { data: allEntities } = await supabase
                .from("knowledge_entities")
                .select("id, name")
                .eq("persona_id", personaId);

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
        }

        // Update existing entities descriptions
        if (graphData.updated_entities?.length > 0) {
          for (const upd of graphData.updated_entities) {
            await supabase
              .from("knowledge_entities")
              .update({ description: upd.description })
              .eq("persona_id", personaId)
              .eq("name", upd.name);
          }
          graphUpdated = true;
        }
      }
    }
  } catch (e) {
    console.log(JSON.stringify({ event: "graph_extraction_error", persona: personaId, error: e.message }));
    // Non-blocking — correction is already saved
  }

  // Clear cache
  clearCache(personaId);

  res.json({
    ok: true,
    message: graphUpdated
      ? "Correction enregistree + graphe de connaissances enrichi"
      : "Correction enregistree",
    graphUpdated,
  });
}

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";

export const GRAPH_EXTRACTION_PROMPT = `Tu es un expert en extraction de connaissances pour un clone de voix IA.
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

const VALID_ENTITY_TYPES = new Set(["concept", "framework", "person", "company", "metric", "belief", "tool", "style_rule"]);
const VALID_RELATION_TYPES = new Set(["equals", "includes", "contradicts", "causes", "uses", "prerequisite", "enforces"]);

/**
 * Extract entities/relations from a correction and upsert into knowledge graph.
 */
export async function extractGraphKnowledge(personaId, correctionText, botMsg, userMsg, client) {
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

    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: GRAPH_EXTRACTION_PROMPT + entityContext,
        messages: [{
          role: "user",
          content: `Correction du client : "${correctionText}"\n\nContexte — message bot : "${(botMsg || "").slice(0, 200)}"\nMessage user : "${(userMsg || "").slice(0, 200)}"`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 0;

    let graphData;
    try {
      graphData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.log(JSON.stringify({ event: "graph_extraction_json_error", persona: personaId, error: parseErr.message }));
      return 0;
    }
    if (!graphData.has_graph_update) return 0;

    if (graphData.new_entities?.length > 0) {
      const entityRows = graphData.new_entities.map(e => ({
        persona_id: personaId,
        name: e.name,
        type: VALID_ENTITY_TYPES.has(e.type) ? e.type : "concept",
        description: e.description || "",
        confidence: 0.8,
      }));

      const { data: inserted } = await supabase
        .from("knowledge_entities")
        .upsert(entityRows, { onConflict: "persona_id,name" })
        .select("id, name");

      const insertedCount = inserted?.length || 0;

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
            relation_type: VALID_RELATION_TYPES.has(r.type) ? r.type : "uses",
            description: r.description || "",
            confidence: 0.8,
          }));
        if (relationRows.length > 0) {
          await supabase.from("knowledge_relations").insert(relationRows);
        }
      }
      return insertedCount;
    }

    if (graphData.updated_entities?.length > 0) {
      for (const upd of graphData.updated_entities) {
        await supabase.from("knowledge_entities")
          .update({ description: upd.description })
          .eq("persona_id", personaId).eq("name", upd.name);
      }
      return graphData.updated_entities.length;
    }

    return 0;
  } catch (e) {
    console.log(JSON.stringify({ event: "graph_extraction_error", persona: personaId, error: e.message }));
    return 0;
  }
}

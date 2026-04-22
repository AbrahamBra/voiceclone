// ============================================================
// File graph extraction — extracts entities/relations from an
// uploaded knowledge document and upserts into the graph.
//
// Runs asynchronously (from api/cron-consolidate.js). The upload
// endpoint (api/knowledge.js POST) only marks the file as pending.
//
// Related: lib/graph-extraction.js handles correction-based
// extraction. Different prompt + tool-use vs free-text JSON.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";

const FILE_GRAPH_PROMPT = `Tu es un expert en extraction de connaissances business.
Analyse ce document et extrais les entités et relations NOUVELLES pour enrichir la connaissance d'un clone IA en appelant l'outil extract_graph.

Un graphe d'entités peut déjà exister. Cherche uniquement ce qui est NOUVEAU ou COMPLÉMENTAIRE.

Types à privilégier : entreprises, personas/ICPs, concepts métier, frameworks, métriques clés, croyances fortes, outils.

Reste concis. Descriptions courtes (une phrase). Si le document est vide ou sans info exploitable, retourne has_graph_update: false.`;

const ENTITY_TYPES = ["concept", "framework", "person", "company", "metric", "belief", "tool", "style_rule"];
const RELATION_TYPES = ["equals", "includes", "contradicts", "causes", "uses", "prerequisite", "enforces"];
const VALID_ENTITY_TYPES = new Set(ENTITY_TYPES);
const VALID_RELATION_TYPES = new Set(RELATION_TYPES);

const GRAPH_EXTRACTION_TOOL = {
  name: "extract_graph",
  description: "Upsert new entities, relations, and enriched descriptions into the clone's knowledge graph.",
  input_schema: {
    type: "object",
    properties: {
      has_graph_update: {
        type: "boolean",
        description: "false only if the document is truly empty or has no exploitable information.",
      },
      new_entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ENTITY_TYPES },
            description: { type: "string" },
          },
          required: ["name", "type", "description"],
        },
      },
      new_relations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            type: { type: "string", enum: RELATION_TYPES },
            description: { type: "string" },
          },
          required: ["from", "to", "type"],
        },
      },
      updated_entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
          },
          required: ["name", "description"],
        },
      },
    },
    required: ["has_graph_update"],
  },
};

/**
 * Extract entities/relations from a document and upsert into the knowledge graph.
 *
 * @param {string} intellId - intelligence_source_id to attach entities to
 * @param {string} content - raw document text
 * @param {object|null} client - client row (for API key). Null = platform key.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=90000]
 * @param {number} [opts.contentSlice=30000]
 * @returns {Promise<{ count: number, debug: string }>}
 */
export async function extractGraphFromFile(intellId, content, client, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 90000;
  const contentSlice = opts.contentSlice ?? 30000;

  const apiKey = getApiKey(client);
  if (!apiKey) return { count: 0, debug: "no_api_key" };

  const anthropic = new Anthropic({ apiKey });

  const { data: existingEntities } = await supabase
    .from("knowledge_entities")
    .select("name, type, description")
    .eq("persona_id", intellId);

  const entityContext = existingEntities?.length > 0
    ? `\n\nEntités déjà dans le graphe :\n${existingEntities.map(e => `- ${e.name} (${e.type}): ${e.description}`).join("\n")}`
    : "";

  const startMs = Date.now();
  const extractPromise = anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: FILE_GRAPH_PROMPT + entityContext,
    tools: [GRAPH_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_graph" },
    messages: [{
      role: "user",
      content: `Document :\n${content.slice(0, contentSlice)}`,
    }],
  });
  const result = await Promise.race([
    extractPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);

  const toolUse = result.content.find((b) => b.type === "tool_use" && b.name === "extract_graph");
  console.log(JSON.stringify({ event: "graph_extraction_raw", persona: intellId, stop_reason: result.stop_reason, ms: Date.now() - startMs, has_tool_use: !!toolUse }));
  if (!toolUse) return { count: 0, debug: `no_tool_use: stop_reason=${result.stop_reason}` };

  const graphData = toolUse.input;
  if (!graphData.has_graph_update) return { count: 0, debug: "has_graph_update=false" };

  let insertedCount = 0;

  if (graphData.new_entities?.length > 0) {
    const entityRows = graphData.new_entities.map(e => ({
      persona_id: intellId,
      name: e.name,
      type: VALID_ENTITY_TYPES.has(e.type) ? e.type : "concept",
      description: e.description || "",
      confidence: 0.7,
    }));

    const { data: inserted, error: upsertError } = await supabase
      .from("knowledge_entities")
      .upsert(entityRows, { onConflict: "persona_id,name" })
      .select("id, name");

    if (upsertError) return { count: 0, debug: `upsert_error: ${upsertError.message}` };
    insertedCount = inserted?.length || 0;

    if (inserted?.length > 0 && graphData.new_relations?.length > 0) {
      const { data: allEntities } = await supabase
        .from("knowledge_entities").select("id, name").eq("persona_id", intellId);
      const entityMap = {};
      for (const e of (allEntities || [])) entityMap[e.name] = e.id;

      const relationRows = graphData.new_relations
        .filter(r => entityMap[r.from] && entityMap[r.to])
        .map(r => ({
          persona_id: intellId,
          from_entity_id: entityMap[r.from],
          to_entity_id: entityMap[r.to],
          relation_type: VALID_RELATION_TYPES.has(r.type) ? r.type : "uses",
          description: r.description || "",
          confidence: 0.7,
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
        .eq("persona_id", intellId).eq("name", upd.name);
    }
  }

  return { count: insertedCount, debug: `ok: ${insertedCount} entities` };
}

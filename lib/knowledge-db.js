import { supabase } from "./supabase.js";

function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// In-memory cache per persona (TTL 5 min)
const _cache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function loadPersonaData(personaId) {
  const now = Date.now();
  if (_cache[personaId] && now - _cache[personaId].ts < CACHE_TTL) {
    return _cache[personaId].data;
  }

  const { data: persona, error: pErr } = await supabase
    .from("personas").select("*").eq("id", personaId).single();
  if (pErr || !persona) return null;

  const { data: knowledge } = await supabase
    .from("knowledge_files").select("path, keywords, content").eq("persona_id", personaId);

  const { data: scenarios } = await supabase
    .from("scenario_files").select("slug, content").eq("persona_id", personaId);

  const { data: corrections } = await supabase
    .from("corrections").select("correction, user_message, bot_message, created_at")
    .eq("persona_id", personaId).order("created_at", { ascending: true });

  // Load entities + relations (graceful if tables don't exist)
  let entities = [];
  let relations = [];
  try {
    const { data: ent } = await supabase
      .from("knowledge_entities").select("id, name, type, description, confidence")
      .eq("persona_id", personaId);
    entities = ent || [];

    if (entities.length > 0) {
      const { data: rel } = await supabase
        .from("knowledge_relations")
        .select("from_entity_id, to_entity_id, relation_type, description, confidence")
        .eq("persona_id", personaId);
      relations = rel || [];
    }
  } catch { /* tables may not exist yet */ }

  const result = {
    persona,
    knowledge: (knowledge || []).map((k) => ({
      ...k, keywords: (k.keywords || []).map(normalize),
    })),
    scenarios: scenarios || [],
    corrections: corrections || [],
    entities,
    relations,
  };

  _cache[personaId] = { ts: now, data: result };
  return result;
}

export async function getPersonaFromDb(personaId) {
  const data = await loadPersonaData(personaId);
  return data?.persona || null;
}

/**
 * Find relevant knowledge files via keyword matching.
 */
export async function findRelevantKnowledgeFromDb(personaId, messages) {
  const data = await loadPersonaData(personaId);
  if (!data) return [];

  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));
  const matched = [];
  for (const entry of data.knowledge) {
    if (entry.keywords.some((kw) => text.includes(kw))) {
      matched.push({ path: entry.path, content: entry.content });
    }
  }
  return matched;
}

/**
 * Find relevant entities from the knowledge graph.
 * Matches entity names against recent messages, then walks relations.
 */
export async function findRelevantEntities(personaId, messages) {
  const data = await loadPersonaData(personaId);
  if (!data || data.entities.length === 0) return { entities: [], relations: [] };

  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));

  // Phase 1: Direct entity matching
  const directMatches = new Set();
  for (const entity of data.entities) {
    if (text.includes(normalize(entity.name))) {
      directMatches.add(entity.id);
    }
  }

  // Phase 2: Graph walk — follow relations 1 hop
  const relatedIds = new Set();
  for (const rel of data.relations) {
    if (directMatches.has(rel.from_entity_id)) {
      relatedIds.add(rel.to_entity_id);
    }
    if (directMatches.has(rel.to_entity_id)) {
      relatedIds.add(rel.from_entity_id);
    }
  }

  // Combine: direct + 1-hop related
  const allIds = new Set([...directMatches, ...relatedIds]);
  const matchedEntities = data.entities.filter(e => allIds.has(e.id));
  const matchedRelations = data.relations.filter(
    r => allIds.has(r.from_entity_id) && allIds.has(r.to_entity_id)
  );

  return {
    entities: matchedEntities,
    relations: matchedRelations,
    directCount: directMatches.size,
    graphCount: relatedIds.size,
  };
}

export async function loadScenarioFromDb(personaId, scenarioSlug) {
  const data = await loadPersonaData(personaId);
  if (!data) return null;
  const scenario = data.scenarios.find((s) => s.slug === scenarioSlug);
  return scenario?.content || null;
}

export async function getCorrectionsFromDb(personaId) {
  const data = await loadPersonaData(personaId);
  if (!data || data.corrections.length === 0) return null;

  let md = "# Corrections apprises\n\n";
  for (const c of data.corrections) {
    const date = new Date(c.created_at).toISOString().split("T")[0];
    md += `- **${date}** — ${c.correction}\n`;
    if (c.user_message) md += `  - Contexte: "${c.user_message.slice(0, 100)}"\n`;
    if (c.bot_message) md += `  - Reponse: "${c.bot_message.slice(0, 150)}"\n`;
  }
  return md;
}

export function clearCache(personaId) {
  delete _cache[personaId];
}

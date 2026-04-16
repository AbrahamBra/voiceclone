import { supabase } from "./supabase.js";
import { formatCorrectionsWithDecay } from "./correction-decay.js";
import { isEmbeddingAvailable, embedQuery } from "./embeddings.js";
import { retrieveChunks } from "./rag.js";

/**
 * Resolve the intelligence source persona ID.
 * NULL intelligence_source_id means "use my own ID".
 */
export function getIntelligenceId(persona) {
  return persona.intelligence_source_id || persona.id;
}

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

  // Resolve intelligence source (NULL = own ID)
  const intellId = getIntelligenceId(persona);

  // Intelligence data uses intellId (shared pool)
  const { data: knowledge } = await supabase
    .from("knowledge_files").select("path, keywords, content").eq("persona_id", intellId);

  // Scenarios stay personal (per-clone)
  const { data: scenarios } = await supabase
    .from("scenario_files").select("slug, content").eq("persona_id", personaId);

  const { data: corrections } = await supabase
    .from("corrections").select("id, correction, user_message, bot_message, confidence, status, created_at")
    .eq("persona_id", intellId).order("created_at", { ascending: true });

  // Load entities + relations (graceful if tables don't exist)
  let entities = [];
  let relations = [];
  try {
    const { data: ent } = await supabase
      .from("knowledge_entities").select("id, name, type, description, confidence, last_matched_at")
      .eq("persona_id", intellId);
    entities = ent || [];

    if (entities.length > 0) {
      const { data: rel } = await supabase
        .from("knowledge_relations")
        .select("from_entity_id, to_entity_id, relation_type, description, confidence")
        .eq("persona_id", intellId);
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

export async function findRelevantKnowledgeFromDb(personaId, messages, boostTerms = []) {
  const data = await loadPersonaData(personaId);
  if (!data) return [];

  const intellId = getIntelligenceId(data.persona);
  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));

  // Phase 1: Keyword scoring (proportional, not binary)
  const keywordResults = [];
  for (const entry of data.knowledge) {
    if (entry.keywords.length === 0) continue;
    const matchCount = entry.keywords.filter(kw => text.includes(kw)).length;
    if (matchCount > 0) {
      const score = matchCount / entry.keywords.length;
      keywordResults.push({ path: entry.path, content: entry.content, score, source: "keyword" });
    }
  }
  keywordResults.sort((a, b) => b.score - a.score);

  // Phase 2: RAG (always runs if available — enriched by boost terms)
  let ragResults = [];
  if (isEmbeddingAvailable()) {
    try {
      const queryParts = messages.slice(-3).map(m => m.content);
      if (boostTerms.length > 0) queryParts.push(boostTerms.join(" "));
      const enrichedQuery = queryParts.join(" ").slice(0, 1000);

      const chunks = await retrieveChunks(supabase, intellId, enrichedQuery);
      ragResults = chunks.map((c, i) => ({
        path: c.source_path || `rag-chunk-${i}`,
        content: c.content,
        score: c.score,
        source: "rag",
        sourcePath: c.source_path || null,
      }));
    } catch (err) {
      console.log(JSON.stringify({ event: "rag_error", error: err.message }));
    }
  }

  // Phase 3: Reciprocal Rank Fusion
  const K = 60;
  const rrfScores = {};
  const contentMap = {};

  keywordResults.forEach((item, rank) => {
    const key = item.path;
    rrfScores[key] = (rrfScores[key] || 0) + 1 / (K + rank + 1);
    if (!contentMap[key]) contentMap[key] = { path: item.path, content: item.content, sources: new Set() };
    contentMap[key].sources.add("keyword");
  });

  ragResults.forEach((item, rank) => {
    const key = item.sourcePath && contentMap[item.sourcePath] ? item.sourcePath : `rag:${item.path}`;
    rrfScores[key] = (rrfScores[key] || 0) + 1 / (K + rank + 1);
    if (!contentMap[key]) contentMap[key] = { path: item.path, content: item.content, sources: new Set() };
    contentMap[key].sources.add("rag");
  });

  const fused = Object.entries(rrfScores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([key]) => {
      const item = contentMap[key];
      const sourceLabel = item.sources.size > 1 ? "hybrid" : [...item.sources][0];
      return { path: item.path, content: item.content, source: sourceLabel };
    });

  return fused;
}

export async function findRelevantEntities(personaId, messages) {
  const data = await loadPersonaData(personaId);
  if (!data || data.entities.length === 0) return { entities: [], relations: [], boostTerms: [] };

  const intellId = getIntelligenceId(data.persona);
  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));
  const now = Date.now();

  // 1. Filter by confidence threshold
  const eligible = data.entities.filter(e => (e.confidence || 1.0) >= 0.6);

  // 2. Try semantic matching first, fall back to text matching
  let directMatches = [];

  const queryText = messages.slice(-3).map(m => m.content).join(" ").slice(0, 1000);
  const queryEmbedding = await embedQuery(queryText);

  if (queryEmbedding) {
    // Semantic match via pgvector
    try {
      const { data: matched } = await supabase.rpc("match_entities", {
        query_embedding: queryEmbedding,
        match_persona_id: intellId,
        match_threshold: 0.4,
        match_count: 8,
      });

      if (matched?.length > 0) {
        // Enrich RPC results with cached entity data (for graph walking)
        const cachedMap = {};
        for (const e of eligible) cachedMap[e.id] = e;

        for (const m of matched) {
          const cached = cachedMap[m.id];
          if (cached) {
            const lastMatched = cached.last_matched_at ? new Date(cached.last_matched_at).getTime() : now;
            const daysSince = (now - lastMatched) / (1000 * 60 * 60 * 24);
            const recencyFactor = Math.max(0.1, 1.0 - (daysSince / 90));
            directMatches.push({
              ...cached,
              score: m.similarity * (m.confidence || 1.0) * recencyFactor,
            });
          }
        }
      }
    } catch (err) {
      console.log(JSON.stringify({ event: "entity_semantic_match_error", error: err.message }));
    }
  }

  // Fallback: text matching (original logic)
  if (directMatches.length === 0) {
    for (const entity of eligible) {
      if (text.includes(normalize(entity.name))) {
        const lastMatched = entity.last_matched_at ? new Date(entity.last_matched_at).getTime() : now;
        const daysSince = (now - lastMatched) / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.max(0.1, 1.0 - (daysSince / 90));
        directMatches.push({ ...entity, score: (entity.confidence || 1.0) * recencyFactor });
      }
    }
  }

  // 3. Sort by score DESC, take top 8
  directMatches.sort((a, b) => b.score - a.score);
  const topDirect = directMatches.slice(0, 8);
  const directIds = new Set(topDirect.map(e => e.id));

  // 5. Graph walk: 2-hop from top entities (decaying score)
  const hop1Ids = new Set();
  const hop2Ids = new Set();
  for (const rel of data.relations) {
    if (directIds.has(rel.from_entity_id) && !directIds.has(rel.to_entity_id)) hop1Ids.add(rel.to_entity_id);
    if (directIds.has(rel.to_entity_id) && !directIds.has(rel.from_entity_id)) hop1Ids.add(rel.from_entity_id);
  }
  // 2nd hop: entities connected to 1-hop (lower priority)
  for (const rel of data.relations) {
    const other = hop1Ids.has(rel.from_entity_id) ? rel.to_entity_id
                : hop1Ids.has(rel.to_entity_id) ? rel.from_entity_id : null;
    if (other && !directIds.has(other) && !hop1Ids.has(other)) hop2Ids.add(other);
  }

  // Combine: direct + 1-hop + 2-hop (with decaying scores), cap at 15
  const relatedIds = new Set([...hop1Ids, ...hop2Ids]);
  const allIds = new Set([...directIds, ...hop1Ids, ...hop2Ids]);
  const hop1Entities = eligible
    .filter(e => hop1Ids.has(e.id))
    .map(e => ({ ...e, score: (e.score || e.confidence || 0.8) * 0.6 }));
  const hop2Entities = eligible
    .filter(e => hop2Ids.has(e.id))
    .map(e => ({ ...e, score: (e.score || e.confidence || 0.8) * 0.3 }));
  const matchedEntities = [...topDirect, ...hop1Entities, ...hop2Entities]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 25);

  // 6. Collect relations between matched entities, top 8
  const matchedEntityIds = new Set(matchedEntities.map(e => e.id));
  const matchedRelations = data.relations
    .filter(r => matchedEntityIds.has(r.from_entity_id) && matchedEntityIds.has(r.to_entity_id))
    .slice(0, 12);

  // 7. Update last_matched_at for directly matched entities (async, non-blocking)
  if (directIds.size > 0) {
    const ids = [...directIds];
    const now = new Date().toISOString();
    supabase.from("knowledge_entities")
      .update({ last_matched_at: now })
      .in("id", ids)
      .then(({ error }) => {
        if (error) console.log(JSON.stringify({ event: "entity_match_update_error", error: error.message }));
        // Update cache in-memory
        for (const e of data.entities) {
          if (directIds.has(e.id)) e.last_matched_at = now;
        }
      })
      .catch((err) => console.log(JSON.stringify({ event: "entity_match_update_error", error: err.message })));
  }

  // 8. Return with boostTerms for RAG enrichment
  return {
    entities: matchedEntities,
    relations: matchedRelations,
    boostTerms: topDirect.slice(0, 5).map(e => e.name),
    directCount: directIds.size,
    hop1Count: hop1Ids.size,
    hop2Count: hop2Ids.size,
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
  return formatCorrectionsWithDecay(data.corrections, data.entities, data.relations);
}

/**
 * Clear cache for a persona AND all downstream clones sharing its intelligence.
 * Call with intellId after writes to the shared pool.
 */
export function clearIntelligenceCache(intellId) {
  delete _cache[intellId];
  for (const key of Object.keys(_cache)) {
    if (_cache[key]?.data?.persona?.intelligence_source_id === intellId) {
      delete _cache[key];
    }
  }
}

// Backward compat alias
export { clearIntelligenceCache as clearCache };

export { loadPersonaData };

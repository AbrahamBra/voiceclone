import { supabase } from "./supabase.js";

/**
 * Normalize text for keyword matching (remove accents, lowercase).
 */
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

  // Load persona
  const { data: persona, error: pErr } = await supabase
    .from("personas")
    .select("*")
    .eq("id", personaId)
    .single();

  if (pErr || !persona) return null;

  // Load knowledge files
  const { data: knowledge } = await supabase
    .from("knowledge_files")
    .select("path, keywords, content")
    .eq("persona_id", personaId);

  // Load scenario files
  const { data: scenarios } = await supabase
    .from("scenario_files")
    .select("slug, content")
    .eq("persona_id", personaId);

  // Load corrections
  const { data: corrections } = await supabase
    .from("corrections")
    .select("correction, user_message, bot_message, created_at")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: true });

  const result = {
    persona,
    knowledge: (knowledge || []).map((k) => ({
      ...k,
      keywords: (k.keywords || []).map(normalize),
    })),
    scenarios: scenarios || [],
    corrections: corrections || [],
  };

  _cache[personaId] = { ts: now, data: result };
  return result;
}

/**
 * Get persona config from DB.
 */
export async function getPersonaFromDb(personaId) {
  const data = await loadPersonaData(personaId);
  return data?.persona || null;
}

/**
 * Find relevant knowledge files for a persona based on message keywords.
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
 * Load a scenario file content from DB.
 */
export async function loadScenarioFromDb(personaId, scenarioSlug) {
  const data = await loadPersonaData(personaId);
  if (!data) return null;
  const scenario = data.scenarios.find((s) => s.slug === scenarioSlug);
  return scenario?.content || null;
}

/**
 * Get corrections as formatted markdown string from DB.
 */
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

/**
 * Clear the cache for a persona (after feedback, etc.).
 */
export function clearCache(personaId) {
  delete _cache[personaId];
}

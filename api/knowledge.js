import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { chunkText, embedAndStore } from "../lib/embeddings.js";
import { clearIntelligenceCache, getIntelligenceId } from "../lib/knowledge-db.js";

const KEYWORD_PROMPT = `Extrais 5 à 15 mots-clés représentatifs de ce document.
Retourne UNIQUEMENT un tableau JSON de strings, sans aucun autre texte ni balises markdown.
Exemple: ["stratégie", "linkedin", "contenu", "audience", "engagement"]`;

const FILE_GRAPH_PROMPT = `Tu es un expert en extraction de connaissances business.
Analyse ce document et extrais toutes les entités et relations NOUVELLES pour enrichir la connaissance d'un clone IA.

IMPORTANT : Un graphe d'entités existe déjà. Tu DOIS chercher ce qui est NOUVEAU ou COMPLÉMENTAIRE :
- Nouveaux segments d'audience, personas, ICPs, noms de personnes
- Nouvelles objections, pain points, motivations d'achat
- Nouveaux canaux, outils, métriques, chiffres clés
- Nouvelles croyances, principes business, frameworks
- Entreprises, partenaires, concurrents pas encore dans le graphe
- Entités existantes dont la description peut être enrichie

Concentre-toi sur :
1. Entreprises et organisations (clients, prospects, concurrents, partenaires)
2. Personas et cibles (ICP, segments, décideurs, utilisateurs)
3. Positionnement et proposition de valeur
4. Concepts métier, frameworks, méthodologies propres au domaine
5. Métriques et objectifs clés
6. Croyances et principes (ce que la personne croit fermement)

Types d'entités : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

Reponds en JSON :
{
  "has_graph_update": true,
  "new_entities": [{ "name": "...", "type": "...", "description": "..." }],
  "new_relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }],
  "updated_entities": [{ "name": "...", "description": "description enrichie" }]
}

Sois EXHAUSTIF. Extrais au minimum 10 entités de tout document non-trivial. Ne reponds has_graph_update: false que si le document est réellement vide ou sans aucune information exploitable.`;

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

  // ── GET: List files ──
  if (req.method === "GET") {
    const personaId = req.query?.persona;
    if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

    if (!isAdmin) {
      const hasAccess = await hasPersonaAccess(client?.id, personaId);
      if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    // Resolve intelligence source
    const { data: getKnPersona } = await supabase
      .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
    if (!getKnPersona) { res.status(404).json({ error: "Persona not found" }); return; }
    const intellId = getIntelligenceId(getKnPersona);

    const { data: files, error } = await supabase
      .from("knowledge_files")
      .select("path, created_at")
      .eq("persona_id", intellId)
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: "Failed to load files" }); return; }

    // Count chunks per file
    const { data: chunkRows } = await supabase
      .from("chunks")
      .select("source_path")
      .eq("persona_id", intellId);

    const chunkCounts = {};
    for (const row of (chunkRows || [])) {
      if (row.source_path) {
        chunkCounts[row.source_path] = (chunkCounts[row.source_path] || 0) + 1;
      }
    }

    const enriched = (files || []).map(f => ({
      path: f.path,
      created_at: f.created_at,
      chunk_count: chunkCounts[f.path] || 0,
    }));

    res.json({ files: enriched });
    return;
  }

  // ── DELETE: Remove file + chunks ──
  if (req.method === "DELETE") {
    const personaId = req.query?.persona;
    const filename = req.query?.file;
    if (!personaId || !filename) {
      res.status(400).json({ error: "persona and file are required" }); return;
    }

    // Resolve intelligence source + ownership check
    const { data: delKnPersona } = await supabase
      .from("personas").select("client_id, intelligence_source_id").eq("id", personaId).single();
    if (!isAdmin) {
      if (!delKnPersona || delKnPersona.client_id !== client?.id) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }
    const delIntellId = delKnPersona ? getIntelligenceId(delKnPersona) : personaId;

    await supabase.from("knowledge_files")
      .delete()
      .eq("persona_id", delIntellId)
      .eq("path", filename);

    await supabase.from("chunks")
      .delete()
      .eq("persona_id", delIntellId)
      .eq("source_path", filename);

    clearIntelligenceCache(delIntellId);
    res.json({ ok: true });
    return;
  }

  // ── POST: Upload reference posts (linkedin_post source type) ──
  if (req.body?.source_type === "linkedin_post") {
    const { personaId, content } = req.body;
    if (!personaId || !content) {
      res.status(400).json({ error: "personaId and content are required" }); return;
    }
    if (content.length > 250_000) {
      res.status(400).json({ error: "Content too large" }); return;
    }

    const { data: pData } = await supabase
      .from("personas").select("client_id, intelligence_source_id").eq("id", personaId).single();
    if (!isAdmin && (!pData || pData.client_id !== client?.id)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const intellId = pData ? getIntelligenceId(pData) : personaId;

    // Split by --- separator, each post is its own chunk (not merged by chunkText)
    const posts = content.split(/\n---\n|\n---$|^---\n/).map(p => p.trim()).filter(p => p.length > 20);
    let chunkCount = 0;
    try {
      chunkCount = await embedAndStore(supabase, posts, intellId, "linkedin_post");
    } catch (e) {
      console.log(JSON.stringify({ event: "embed_error", error: e.message }));
    }

    clearIntelligenceCache(intellId);
    res.json({ chunk_count: chunkCount });
    return;
  }

  // ── POST: Upload file ──
  const { personaId, filename, content } = req.body || {};
  if (!personaId || !filename || !content) {
    res.status(400).json({ error: "personaId, filename, content are required" }); return;
  }

  if (content.length > 250_000) {
    res.status(400).json({ error: "Content too large (max 250 000 characters)" }); return;
  }

  // Resolve intelligence source + ownership check
  const { data: postKnPersona } = await supabase
    .from("personas").select("client_id, intelligence_source_id").eq("id", personaId).single();
  if (!isAdmin) {
    if (!postKnPersona || postKnPersona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }
  const intellId = postKnPersona ? getIntelligenceId(postKnPersona) : personaId;

  // Unique path with timestamp suffix to avoid collisions
  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex >= 0 ? filename.slice(dotIndex) : "";
  const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const path = `${base}-${Date.now()}${ext}`;

  // Insert file record immediately, then respond — all heavy work (keywords, embeddings,
  // graph extraction) runs fire-and-forget to stay well under Vercel's 60s timeout.
  const { error: insertError } = await supabase.from("knowledge_files").insert({
    persona_id: intellId,
    path,
    keywords: [],
    content,
    contributed_by: client?.id || null,
  });

  if (insertError) {
    console.log(JSON.stringify({ event: "knowledge_insert_error", error: insertError.message, code: insertError.code, intellId, path }));
    res.status(500).json({ error: "Failed to save file", detail: insertError.message }); return;
  }

  clearIntelligenceCache(intellId);
  res.json({ file: { path } });

  // Background: keywords, embeddings, graph extraction (may not complete on Vercel hobby)
  (async () => {
    try {
      const anthropic = new Anthropic({ apiKey: getApiKey(client) });
      const msg = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 150,
          messages: [{ role: "user", content: `${KEYWORD_PROMPT}\n\nDocument :\n${content.slice(0, 3000)}` }],
        }),
        new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 8000)),
      ]);
      const raw = msg.content[0]?.text?.trim() || "[]";
      const keywords = JSON.parse(raw);
      if (Array.isArray(keywords) && keywords.length > 0) {
        await supabase.from("knowledge_files").update({ keywords }).eq("persona_id", intellId).eq("path", path);
      }
    } catch { /* skip */ }

    try {
      const chunks = chunkText(content);
      await embedAndStore(supabase, chunks, intellId, "knowledge_file", path);
    } catch { /* skip */ }

    await extractGraphKnowledgeFromFile(intellId, content, client).catch(() => {});
  })();
}

/**
 * Extract entities/relations from a document and upsert into knowledge graph.
 * Entities from files get confidence 0.7 (lower than corrections at 0.8 — not user-validated).
 * Runs async — caller doesn't wait.
 */
async function extractGraphKnowledgeFromFile(intellId, content, client) {
  try {
    const apiKey = getApiKey(client);
    if (!apiKey) {
      return { count: 0, debug: "no_api_key" };
    }
    const anthropic = new Anthropic({ apiKey });

    const { data: existingEntities } = await supabase
      .from("knowledge_entities")
      .select("name, type, description")
      .eq("persona_id", intellId);

    const entityContext = existingEntities?.length > 0
      ? `\n\nEntités déjà dans le graphe :\n${existingEntities.map(e => `- ${e.name} (${e.type}): ${e.description}`).join("\n")}`
      : "";

    const extractPromise = anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16384,
      system: FILE_GRAPH_PROMPT + entityContext,
      messages: [{
        role: "user",
        content: `Document :\n${content.slice(0, 20000)}`,
      }],
    });
    const result = await Promise.race([
      extractPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50000)),
    ]);

    const raw = result.content[0].text.trim();
    console.log(JSON.stringify({ event: "graph_extraction_raw", persona: intellId, raw_length: raw.length, stop_reason: result.stop_reason }));
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { count: 0, debug: "no_json_in_response" };

    let graphData;
    try {
      graphData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.log(JSON.stringify({ event: "graph_extraction_json_error", persona: intellId, error: parseErr.message }));
      return { count: 0, debug: "json_parse_error" };
    }

    if (!graphData.has_graph_update) return { count: 0, debug: `has_graph_update=false` };

    let insertedCount = 0;

    if (graphData.new_entities?.length > 0) {
      const VALID_ENTITY_TYPES = new Set(["concept", "framework", "person", "company", "metric", "belief", "tool", "style_rule"]);
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

      if (upsertError) {
        return { count: 0, debug: `upsert_error: ${upsertError.message}` };
      }

      insertedCount = inserted?.length || 0;

      if (inserted?.length > 0 && graphData.new_relations?.length > 0) {
        const { data: allEntities } = await supabase
          .from("knowledge_entities").select("id, name").eq("persona_id", intellId);
        const entityMap = {};
        for (const e of (allEntities || [])) entityMap[e.name] = e.id;

        const VALID_RELATION_TYPES = new Set(["equals", "includes", "contradicts", "causes", "uses", "prerequisite", "enforces"]);
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
  } catch (e) {
    console.log(JSON.stringify({ event: "file_graph_extraction_error", persona: intellId, error: e.message }));
    return { count: 0, debug: `exception: ${e.message}` };
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, setCors } from "../lib/supabase.js";
import { chunkText, embedAndStore } from "../lib/embeddings.js";
import { clearCache } from "../lib/knowledge-db.js";

const KEYWORD_PROMPT = `Extrais 5 à 15 mots-clés représentatifs de ce document.
Retourne UNIQUEMENT un tableau JSON de strings, sans aucun autre texte ni balises markdown.
Exemple: ["stratégie", "linkedin", "contenu", "audience", "engagement"]`;

const FILE_GRAPH_PROMPT = `Tu es un expert en extraction de connaissances business.
Analyse ce document et extrais toutes les entités et relations utiles pour enrichir la connaissance d'un clone IA.

Concentre-toi sur :
1. Entreprises et organisations (clients actuels, prospects, concurrents, partenaires)
2. Personas et cibles (ICP, segments, décideurs, utilisateurs)
3. Positionnement et proposition de valeur
4. Concepts métier, frameworks, méthodologies propres au domaine
5. Métriques et objectifs clés
6. Croyances et principes (ce que la personne croit fermement)

Types d'entités : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

Reponds en JSON :
{
  "has_graph_update": true/false,
  "new_entities": [{ "name": "...", "type": "...", "description": "..." }],
  "new_relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }],
  "updated_entities": [{ "name": "...", "description": "nouvelle description" }]
}

Reponds {"has_graph_update": false} si le document ne contient aucune entité exploitable.`;

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
      const { data: persona } = await supabase
        .from("personas").select("client_id").eq("id", personaId).single();
      if (!persona || persona.client_id !== client?.id) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    const { data: files, error } = await supabase
      .from("knowledge_files")
      .select("path, created_at")
      .eq("persona_id", personaId)
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: "Failed to load files" }); return; }

    // Count chunks per file
    const { data: chunkRows } = await supabase
      .from("chunks")
      .select("source_path")
      .eq("persona_id", personaId);

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

    if (!isAdmin) {
      const { data: persona } = await supabase
        .from("personas").select("client_id").eq("id", personaId).single();
      if (!persona || persona.client_id !== client?.id) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    await supabase.from("knowledge_files")
      .delete()
      .eq("persona_id", personaId)
      .eq("path", filename);

    await supabase.from("chunks")
      .delete()
      .eq("persona_id", personaId)
      .eq("source_path", filename);

    clearCache(personaId);
    res.json({ ok: true });
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

  if (!isAdmin) {
    const { data: persona } = await supabase
      .from("personas").select("client_id").eq("id", personaId).single();
    if (!persona || persona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  // Unique path with timestamp suffix to avoid collisions
  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex >= 0 ? filename.slice(dotIndex) : "";
  const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const path = `${base}-${Date.now()}${ext}`;

  // Extract keywords via Claude (with 8s timeout fallback)
  let keywords = [];
  try {
    const anthropic = new Anthropic({ apiKey: getApiKey(client) });
    const keywordPromise = anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `${KEYWORD_PROMPT}\n\nDocument :\n${content.slice(0, 3000)}`,
      }],
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8000)
    );
    const msg = await Promise.race([keywordPromise, timeoutPromise]);
    const raw = msg.content[0]?.text?.trim() || "[]";
    keywords = JSON.parse(raw);
    if (!Array.isArray(keywords)) keywords = [];
  } catch {
    keywords = [];
  }

  // Chunk + embed (graceful if Voyage AI unavailable)
  const chunks = chunkText(content);
  let chunkCount = 0;
  try {
    chunkCount = await embedAndStore(supabase, chunks, personaId, "knowledge_file", path);
  } catch (embedErr) {
    console.log(JSON.stringify({ event: "embed_error", error: embedErr.message, path }));
    // File still stored — keyword search will work without vectors
  }

  const { error: insertError } = await supabase.from("knowledge_files").insert({
    persona_id: personaId,
    path,
    keywords,
    content,
  });

  if (insertError) {
    res.status(500).json({ error: "Failed to save file" }); return;
  }

  clearCache(personaId);

  // Extract graph knowledge from file content (fire-and-forget)
  // Must start BEFORE res.json() so the Promise is in the event loop when Vercel closes the response
  extractGraphKnowledgeFromFile(personaId, content, client).catch(() => {});

  res.json({ file: { path, chunk_count: chunkCount } });
}

/**
 * Extract entities/relations from a document and upsert into knowledge graph.
 * Entities from files get confidence 0.7 (lower than corrections at 0.8 — not user-validated).
 * Runs async — caller doesn't wait.
 */
async function extractGraphKnowledgeFromFile(personaId, content, client) {
  try {
    const anthropic = new Anthropic({ apiKey: getApiKey(client) });

    const { data: existingEntities } = await supabase
      .from("knowledge_entities")
      .select("name, type, description")
      .eq("persona_id", personaId);

    const entityContext = existingEntities?.length > 0
      ? `\n\nEntités déjà dans le graphe :\n${existingEntities.map(e => `- ${e.name} (${e.type}): ${e.description}`).join("\n")}`
      : "";

    const result = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 8192,
      system: FILE_GRAPH_PROMPT + entityContext,
      messages: [{
        role: "user",
        content: `Document :\n${content.slice(0, 20000)}`,
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
        confidence: 0.7,
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
          .eq("persona_id", personaId).eq("name", upd.name);
      }
    }
  } catch (e) {
    console.log(JSON.stringify({ event: "file_graph_extraction_error", persona: personaId, error: e.message }));
  }
}

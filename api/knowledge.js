export const maxDuration = 60;

import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { chunkText, embedAndStore } from "../lib/embeddings.js";
import { clearIntelligenceCache, getIntelligenceId } from "../lib/knowledge-db.js";

const KEYWORD_PROMPT = `Extrais 5 à 15 mots-clés représentatifs de ce document.
Retourne UNIQUEMENT un tableau JSON de strings, sans aucun autre texte ni balises markdown.
Exemple: ["stratégie", "linkedin", "contenu", "audience", "engagement"]`;

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
      .select("path, created_at, extraction_status, extraction_error, extraction_attempts")
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
      extraction_status: f.extraction_status,
      extraction_error: f.extraction_error,
      extraction_attempts: f.extraction_attempts,
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
      .from("personas").select("id, client_id, intelligence_source_id").eq("id", personaId).single();
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
      .from("personas").select("id, client_id, intelligence_source_id").eq("id", personaId).single();
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
    .from("personas").select("id, client_id, intelligence_source_id").eq("id", personaId).single();
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

  // Insert file record with extraction_status='pending' — graph extraction
  // is offloaded to api/cron-consolidate.js (async, within its 300s budget).
  const { error: insertError } = await supabase.from("knowledge_files").insert({
    persona_id: intellId,
    path,
    keywords: [],
    content,
    contributed_by: client?.id || null,
    extraction_status: "pending",
    extraction_attempts: 0,
  });

  if (insertError) {
    console.log(JSON.stringify({ event: "knowledge_insert_error", error: insertError.message, code: insertError.code, intellId, path }));
    res.status(500).json({ error: "Failed to save file", detail: insertError.message }); return;
  }

  clearIntelligenceCache(intellId);

  // Embeddings (RAG + chunk counter) must stay sync — UI counts chunks immediately.
  // Graph extraction is NOT done here (runs in cron).
  try {
    const chunks = chunkText(content);
    await embedAndStore(supabase, chunks, intellId, "knowledge_file", path);
  } catch (e) {
    console.log(JSON.stringify({ event: "embed_error", error: e.message, path }));
  }

  res.json({ file: { path, extraction_status: "pending" } });

  // Keywords: fire-and-forget OK (cosmétique, pas critique)
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
  })();
}

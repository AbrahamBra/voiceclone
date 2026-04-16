import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { clearIntelligenceCache, loadPersonaData, getIntelligenceId } from "../lib/knowledge-db.js";
import { extractGraphKnowledge } from "../lib/graph-extraction.js";

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
      const hasAccess = await hasPersonaAccess(client?.id, personaId);
      if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    // Always bypass cache for Intelligence panel — entities may have just been added
    clearIntelligenceCache(personaId);
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

    // Find contradiction relations
    const contradictions = data.relations
      .filter(r => r.relation_type === "contradicts")
      .map(r => ({
        from: entityMap[r.from_entity_id] || "?",
        to: entityMap[r.to_entity_id] || "?",
        description: r.description,
        confidence: r.confidence,
      }));

    res.json({
      stats: {
        corrections_total: data.corrections.length,
        entities_total: entities.length,
        relations_total: data.relations.length,
        confidence_avg: confidenceAvg,
        contradictions_count: contradictions.length,
      },
      corrections,
      entities,
      contradictions,
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
      const hasAccess = await hasPersonaAccess(client?.id, personaId);
      if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    // Resolve intelligence source for delete
    const { data: delPersona } = await supabase
      .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
    const delIntellId = delPersona ? getIntelligenceId(delPersona) : personaId;

    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", correctionId)
      .eq("persona_id", delIntellId);

    if (error) { res.status(500).json({ error: "Failed to delete" }); return; }

    clearIntelligenceCache(delIntellId);
    res.json({ ok: true });
    return;
  }

  // ── POST: Submit correction ──
  const { correction, botMessage, userMessage, persona: personaId, type, original, modified, accepted } = req.body || {};

  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Access check (owner or shared)
  if (!isAdmin && supabase) {
    const hasAccess = await hasPersonaAccess(client?.id, personaId);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  // Resolve intelligence source for writes
  const { data: fbPersona } = await supabase
    .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
  if (!fbPersona) { res.status(404).json({ error: "Persona not found" }); return; }
  const intellId = getIntelligenceId(fbPersona);

  // ── Type "validate": positive reinforcement — boost graph entities ──
  if (type === "validate") {
    if (!botMessage) { res.status(400).json({ error: "botMessage required" }); return; }

    // Save as positive example
    await supabase.from("corrections").insert({
      persona_id: intellId,
      correction: "[VALIDATED] Reponse validee par l'utilisateur",
      bot_message: botMessage.slice(0, 300),
      user_message: userMessage?.slice(0, 200) || null,
      contributed_by: client?.id || null,
    });

    // Boost confidence of entities that match this message
    const { data: entities } = await supabase
      .from("knowledge_entities")
      .select("id, name, confidence")
      .eq("persona_id", intellId);

    if (entities?.length > 0) {
      const msgLower = botMessage.toLowerCase();
      const matched = entities.filter(e => msgLower.includes(e.name.toLowerCase()));
      for (const e of matched) {
        const newConf = Math.min(1.0, (e.confidence || 0.8) + 0.05);
        await supabase.from("knowledge_entities")
          .update({ confidence: newConf, last_matched_at: new Date().toISOString() })
          .eq("id", e.id);
      }
    }

    clearIntelligenceCache(intellId);
    res.json({ ok: true, message: "Validated" });
    return;
  }

  // ── Type "reject": negative reinforcement — demote specific entities/corrections ──
  // Frontend sends entityIds[] and/or correctionIds[] to demote explicitly.
  if (type === "reject") {
    const { entityIds, correctionIds } = req.body || {};
    if (!entityIds?.length && !correctionIds?.length) {
      res.status(400).json({ error: "entityIds or correctionIds required" }); return;
    }

    let demotedEntities = 0;
    let demotedCorrections = 0;

    // Demote specific entities by ID
    if (entityIds?.length > 0) {
      for (const id of entityIds) {
        const { data: entity } = await supabase
          .from("knowledge_entities")
          .select("confidence")
          .eq("id", id).eq("persona_id", intellId).single();
        if (!entity) continue;
        const newConf = Math.max(0.0, (entity.confidence || 0.8) - 0.1);
        await supabase.from("knowledge_entities")
          .update({ confidence: newConf, last_matched_at: new Date().toISOString() })
          .eq("id", id);
        demotedEntities++;
      }
    }

    // Demote specific corrections by ID
    if (correctionIds?.length > 0) {
      for (const id of correctionIds) {
        const { data: corr } = await supabase
          .from("corrections")
          .select("confidence")
          .eq("id", id).eq("persona_id", intellId).single();
        if (!corr) continue;
        const newConf = Math.max(0.0, (corr.confidence || 0.8) - 0.15);
        const newStatus = newConf <= 0.1 ? "archived" : "active";
        await supabase.from("corrections")
          .update({ confidence: newConf, status: newStatus })
          .eq("id", id);
        demotedCorrections++;
      }
    }

    clearIntelligenceCache(intellId);
    res.json({ ok: true, message: "Rejected", entities_demoted: demotedEntities, corrections_demoted: demotedCorrections });
    return;
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

      const result = await Promise.race([
        anthropic.messages.create({
          model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: `Tu es un assistant qui reecrit des messages. ${voiceContext}`,
          messages: [{
            role: "user",
            content: `Message original du bot :\n"${botMessage.slice(0, 500)}"\n\nCorrection demandee par l'utilisateur :\n"${correction}"\n\nGenere exactement 2 alternatives qui corrigent le probleme. Reponds en JSON :\n{"alternatives": ["alternative 1", "alternative 2"]}`,
          }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
      ]);

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
      persona_id: intellId,
      correction: finalCorrection,
      user_message: userMessage?.slice(0, 200) || null,
      bot_message: botMessage?.slice(0, 300) || null,
      contributed_by: client?.id || null,
    });

    // Extract graph knowledge (await to avoid Vercel kill)
    try {
      await extractGraphKnowledge(intellId, finalCorrection, botMessage, userMessage, client);
    } catch (err) {
      console.log(JSON.stringify({ event: "accept_graph_error", persona: intellId, error: err.message }));
    }

    clearIntelligenceCache(intellId);
    res.json({ ok: true, message: "Correction enregistree et clone ameliore", accepted });
    return;
  }

  // ── Type "save_rule": user explicitly saves a message as a rule ──
  if (type === "save_rule") {
    if (!userMessage) { res.status(400).json({ error: "userMessage required" }); return; }

    try {
      const apiKey = getApiKey(client);
      const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

      // Extract the actual rule from the user message
      const extractResult = await Promise.race([
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          system: `Extrais la regle/instruction de ce message utilisateur. Reponds en JSON : {"rule": "description concise et actionnable de la regle"}. Si le message ne contient pas de regle claire, reponds {"rule": null}.`,
          messages: [{ role: "user", content: userMessage.slice(0, 500) }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]);

      const raw = extractResult.content[0].text.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let rule = userMessage.slice(0, 300); // fallback
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.rule) rule = parsed.rule;
        } catch {}
      }

      await supabase.from("corrections").insert({
        persona_id: intellId,
        correction: rule,
        user_message: userMessage.slice(0, 200),
        bot_message: "[saved-by-user]",
        contributed_by: client?.id || null,
      });

      await extractGraphKnowledge(intellId, rule, null, userMessage, client);
      clearIntelligenceCache(intellId);

      res.json({ ok: true, message: "Règle sauvegardée", rule });
    } catch (e) {
      res.status(500).json({ error: "Failed to save rule: " + e.message });
    }
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
      const diffResult = await Promise.race([
        anthropic.messages.create({
          model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
          max_tokens: 256,
          system: "Compare ces deux versions d'un message. Decris en 1-2 phrases les modifications de style effectuees par l'utilisateur. Sois concis et actionnable.",
          messages: [{ role: "user", content: `ORIGINAL :\n${original.slice(0, 500)}\n\nMODIFIE :\n${modified.slice(0, 500)}` }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
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
    persona_id: intellId,
    correction: finalCorrection,
    user_message: type === "implicit" ? "[diff implicite]" : userMessage?.slice(0, 200) || null,
    bot_message: type === "implicit" ? original?.slice(0, 300) : botMessage?.slice(0, 300) || null,
    contributed_by: client?.id || null,
  });

  if (error) {
    res.status(500).json({ error: "Failed to save correction" });
    return;
  }

  // 2. Extract graph knowledge — await before response (Vercel kills fire-and-forget)
  const { entityCount, contradictions } = await extractGraphKnowledge(intellId, finalCorrection, botMessage || original, userMessage, client);

  clearIntelligenceCache(intellId);

  res.json({
    ok: true,
    message: "Correction enregistree",
    entities_extracted: entityCount,
    contradictions: contradictions.length > 0 ? contradictions : undefined,
  });
}


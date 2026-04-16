import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";
import { calculateFidelityScore } from "../lib/fidelity.js";

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" }); return;
  }

  // ── GET ──
  if (req.method === "GET") {
    const batchParam = req.query?.personas;
    const singleParam = req.query?.persona;

    // Batch mode: ?personas=id1,id2,id3
    if (batchParam) {
      const ids = batchParam.split(",").map(s => s.trim()).filter(Boolean);
      if (ids.length === 0 || ids.length > 20) {
        res.status(400).json({ error: "personas: 1-20 IDs required" }); return;
      }

      if (!isAdmin) {
        for (const id of ids) {
          if (!(await hasPersonaAccess(client?.id, id))) {
            res.status(403).json({ error: "Forbidden" }); return;
          }
        }
      }

      const scores = {};
      for (const id of ids) {
        const { data } = await supabase
          .from("fidelity_scores")
          .select("score_global, calculated_at")
          .eq("persona_id", id)
          .order("calculated_at", { ascending: false })
          .limit(1);
        scores[id] = data?.[0] || null;
      }

      res.json({ scores });
      return;
    }

    // Single mode: ?persona=id
    if (singleParam) {
      if (!isAdmin) {
        if (!(await hasPersonaAccess(client?.id, singleParam))) {
          res.status(403).json({ error: "Forbidden" }); return;
        }
      }

      // Latest full score
      const { data: currentRows } = await supabase
        .from("fidelity_scores")
        .select("*")
        .eq("persona_id", singleParam)
        .order("calculated_at", { ascending: false })
        .limit(1);
      const current = currentRows?.[0] || null;

      // History (last 10, chronological ascending)
      const { data: historyRows } = await supabase
        .from("fidelity_scores")
        .select("score_global, calculated_at")
        .eq("persona_id", singleParam)
        .order("calculated_at", { ascending: false })
        .limit(10);
      const history = (historyRows || []).reverse();

      // Chunk count for can_calculate
      const { count } = await supabase
        .from("chunks")
        .select("id", { count: "exact", head: true })
        .eq("persona_id", singleParam)
        .eq("source_type", "linkedin_post");

      const chunk_count = count || 0;

      res.json({
        current,
        history,
        chunk_count,
        can_calculate: chunk_count >= 3,
      });
      return;
    }

    res.status(400).json({ error: "persona or personas param required" });
    return;
  }

  // ── POST ──
  const { personaId } = req.body || {};
  if (!personaId) { res.status(400).json({ error: "personaId required" }); return; }

  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, personaId))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  // Rate limit: 1 calculation per hour
  const { data: recent } = await supabase
    .from("fidelity_scores")
    .select("calculated_at")
    .eq("persona_id", personaId)
    .order("calculated_at", { ascending: false })
    .limit(1);

  if (recent?.[0]) {
    const elapsed = Date.now() - new Date(recent[0].calculated_at).getTime();
    const oneHour = 60 * 60 * 1000;
    if (elapsed < oneHour) {
      const retry_after_seconds = Math.ceil((oneHour - elapsed) / 1000);
      res.status(429).json({ error: "Rate limited", retry_after_seconds }); return;
    }
  }

  const result = await calculateFidelityScore(personaId, { client });

  if (!result) {
    res.json({ error: "Cannot calculate", can_calculate: false }); return;
  }

  res.json(result);
}

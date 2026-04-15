import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";
import { clearCache } from "../lib/knowledge-db.js";

/**
 * Process calibration ratings.
 * POST /api/calibrate-feedback { persona, ratings: [{ index, score, correction? }] }
 */
export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { persona: personaId, ratings } = req.body || {};
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Ownership check
  if (!isAdmin && supabase) {
    const { data: persona } = await supabase.from("personas").select("client_id").eq("id", personaId).single();
    if (!persona || persona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  if (!Array.isArray(ratings) || ratings.length === 0) {
    res.status(400).json({ error: "ratings array is required" });
    return;
  }

  let adjustments = 0;

  try {
    for (const rating of ratings) {
      // Only save corrections for low-rated messages (< 3/5)
      if (rating.score < 3 && rating.correction?.trim()) {
        await supabase.from("corrections").insert({
          persona_id: personaId,
          correction: rating.correction.trim(),
          user_message: `[calibration contexte ${rating.index + 1}]`,
          bot_message: rating.response?.slice(0, 300) || "",
        });
        adjustments++;
      } else if (rating.score < 3 && !rating.correction?.trim()) {
        // Low score without correction — save a generic note
        await supabase.from("corrections").insert({
          persona_id: personaId,
          correction: `Message de calibration #${rating.index + 1} note ${rating.score}/5 — le style ne correspond pas.`,
          user_message: `[calibration contexte ${rating.index + 1}]`,
          bot_message: rating.response?.slice(0, 300) || "",
        });
        adjustments++;
      }
    }

    // Clear cache so corrections are picked up immediately
    if (adjustments > 0) {
      clearCache(personaId);
    }

    res.json({
      ok: true,
      adjustments,
      message: adjustments > 0
        ? `${adjustments} correction(s) enregistree(s). Le clone va s'ameliorer.`
        : "Calibration validee, aucun ajustement necessaire.",
    });
  } catch (err) {
    console.log(JSON.stringify({ event: "calibrate_feedback_error", error: err.message }));
    res.status(500).json({ error: "Erreur: " + err.message });
  }
}

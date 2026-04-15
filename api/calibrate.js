import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, getApiKey, setCors } from "../lib/supabase.js";
import { getPersonaFromDb } from "../lib/knowledge-db.js";
import { buildSystemPrompt } from "../lib/prompt.js";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

const CALIBRATION_CONTEXTS = [
  "Quelqu'un te pose une question simple sur ton domaine d'expertise. Reponds naturellement.",
  "Un prospect froid t'envoie un message sur LinkedIn pour la premiere fois. Reponds comme tu le ferais.",
  "Un contact te demande un conseil precis sur un sujet que tu maitrises. Donne un conseil actionnable.",
  "Tu reagis a une actualite recente dans ton domaine. Donne ton avis.",
  "Tu relances quelqu'un qui n'a pas repondu a ton dernier message. Sois naturel.",
];

/**
 * Generate 5 calibration messages for a newly created persona.
 * POST /api/calibrate { persona: personaId }
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

  const { persona: personaId } = req.body || {};
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  const persona = await getPersonaFromDb(personaId);
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  if (!isAdmin && persona.client_id !== client?.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { prompt: systemPrompt } = buildSystemPrompt({ persona });

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  try {
    const result = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Genere exactement 5 messages de test pour calibrer ta voix. Chaque message doit correspondre a un contexte different.

Contextes :
${CALIBRATION_CONTEXTS.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Reponds en JSON strict :
[
  {"context": "description courte du contexte", "response": "ta reponse naturelle"},
  ...
]

IMPORTANT : Chaque reponse doit etre dans TON style exact (longueur, ton, expressions). Pas de meta-commentaire.`,
      }],
    });

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Failed to parse calibration messages" });
      return;
    }

    const messages = JSON.parse(jsonMatch[0]);
    res.json({ ok: true, messages: messages.slice(0, 5) });
  } catch (err) {
    console.log(JSON.stringify({ event: "calibrate_error", error: err.message }));
    res.status(500).json({ error: "Erreur de calibration: " + err.message });
  }
}

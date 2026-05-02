import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, setCors, hasPersonaAccess } from "../lib/supabase.js";
import { detectFidelityDecay } from "../lib/fidelity.js";
import { log } from "../lib/log.js";

const VOICE_REFINEMENT_PROMPT = `Tu es un expert en personal branding et analyse de style d'ecriture LinkedIn.
On te donne le profil LinkedIn d'une personne et ses posts, ainsi que ses regles de voix actuelles.
Les scores de fidelite de son clone IA ont decline. Affine les regles de voix pour mieux capturer son style.

Reponds UNIQUEMENT avec un JSON valide contenant uniquement l'objet "voice" (rien d'autre) :
{
  "voice": {
    "tone": ["3-5 adjectifs"],
    "personality": ["3-5 traits"],
    "signaturePhrases": ["5-8 phrases que la personne utilise souvent"],
    "forbiddenWords": ["mots que cette personne n'utiliserait jamais"],
    "neverDoes": ["5-8 anti-patterns observes"],
    "writingRules": ["8-12 regles d'ecriture extraites des posts"]
  }
}`;

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" }); return;
  }

  const { personaId } = req.body || {};
  if (!personaId) { res.status(400).json({ error: "personaId required" }); return; }

  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, personaId))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  // Load recent fidelity history (most recent first)
  const { data: scores } = await supabase
    .from("fidelity_scores")
    .select("score_global, calculated_at")
    .eq("persona_id", personaId)
    .order("calculated_at", { ascending: false })
    .limit(10);

  const decay = detectFidelityDecay(scores || []);

  if (!decay.decaying) {
    res.json({ triggered: false, decay });
    return;
  }

  // Load persona + its chunks for re-extraction
  const { data: persona } = await supabase
    .from("personas")
    .select("id, name, voice")
    .eq("id", personaId)
    .single();

  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const { data: chunks } = await supabase
    .from("chunks")
    .select("content")
    .eq("persona_id", personaId)
    .eq("source_type", "linkedin_post")
    .limit(30);

  if (!chunks || chunks.length < 3) {
    res.json({ triggered: false, reason: "insufficient_chunks", decay });
    return;
  }

  const postsContent = chunks.map((c, i) => `--- POST ${i + 1} ---\n${c.content}`).join("\n\n");
  const currentVoice = JSON.stringify(persona.voice, null, 2);

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey });
  const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

  let updatedVoice;
  try {
    const result = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: VOICE_REFINEMENT_PROMPT,
      messages: [{
        role: "user",
        content: `POSTS LINKEDIN :\n${postsContent}\n\nREGLES DE VOIX ACTUELLES :\n${currentVoice}`,
      }],
    });

    const raw = result.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    const parsed = JSON.parse(match[0]);
    if (!parsed.voice) throw new Error("Missing voice key");
    updatedVoice = parsed.voice;
  } catch (err) {
    log("fidelity_tuning_extraction_error", { persona: personaId, error: err.message });
    res.status(500).json({ error: "Voice re-extraction failed" });
    return;
  }

  const { error: updateErr } = await supabase
    .from("personas")
    .update({ voice: updatedVoice })
    .eq("id", personaId);

  if (updateErr) {
    res.status(500).json({ error: "Failed to update persona voice" });
    return;
  }

  log("fidelity_tuning_triggered", {
    persona: personaId,
    delta: decay.delta,
    weekly_rate: decay.weekly_rate,
  });

  res.json({ triggered: true, decay, updated_voice: updatedVoice });
}

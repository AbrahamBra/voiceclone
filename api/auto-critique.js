// N3 Auto-critique — IA relit ses propres outputs vs les règles actives.
// POST /api/auto-critique  { personaId: "uuid" }
// Émet des learning_events "auto_critique" pour chaque violation détectée.

import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { getCorrectionsFromDb } from "../lib/knowledge-db.js";
import { getActiveHardRules } from "../lib/protocol-db.js";
import { logLearningEvent } from "../lib/learning-events.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { personaId } = req.body || {};
  if (!personaId) {
    res.status(400).json({ error: "personaId is required" }); return;
  }

  if (!isAdmin) {
    const hasAccess = await hasPersonaAccess(client?.id, personaId);
    if (!hasAccess) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  // ── 1. Charger les règles actives ──
  const [correctionsText, hardRules] = await Promise.all([
    getCorrectionsFromDb(personaId).catch(() => null),
    getActiveHardRules(personaId).catch(() => []),
  ]);

  const rulesLines = [];
  if (correctionsText) rulesLines.push(correctionsText);
  if (hardRules.length > 0) {
    rulesLines.push(hardRules.map((r, i) => `${i + 1}. ${r.rule || r.content || JSON.stringify(r)}`).join("\n"));
  }

  if (rulesLines.length === 0) {
    res.json({ critiques: [], emitted: 0, skipped: true, reason: "no_active_rules" }); return;
  }

  const rulesText = rulesLines.join("\n\n");

  // ── 2. Charger les 5 dernières conversations — extraire les turns bot ──
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, messages, scenario_type, created_at")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: false })
    .limit(5);

  const botTurns = [];
  for (const conv of conversations || []) {
    const msgs = Array.isArray(conv.messages) ? conv.messages : [];
    for (const msg of msgs) {
      if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim()) {
        botTurns.push(msg.content.trim());
      }
    }
  }

  if (botTurns.length === 0) {
    res.json({ critiques: [], emitted: 0, skipped: true, reason: "no_recent_output" }); return;
  }

  const messagesText = botTurns.map((t, i) => `[${i + 1}] ${t.slice(0, 400)}`).join("\n\n");

  // ── 3. Appeler Claude Haiku pour l'audit ──
  const prompt = `Tu es un auditeur qualité pour un clone LinkedIn.

Règles actives du clone :
${rulesText}

Voici des messages récents générés par le clone :
${messagesText}

Pour chaque message qui viole une règle, réponds avec ce format JSON :
[{"message_excerpt": "...", "violated_rule": "...", "severity": "low|medium|high", "suggestion": "..."}]

Si aucune violation : []

Réponds uniquement avec le JSON, sans texte autour.`;

  let critiques = [];
  let parseError = false;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content?.[0]?.text?.trim() || "[]";

    // Extract JSON array even if Claude adds a small preamble
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      critiques = JSON.parse(jsonMatch[0]);
    } else {
      parseError = true;
    }
  } catch {
    parseError = true;
  }

  // ── 4. Émettre les learning events ──
  let emitted = 0;
  for (const item of critiques) {
    if (!item.violated_rule) continue;
    await logLearningEvent(personaId, "auto_critique", {
      violated_rule: item.violated_rule,
      severity: item.severity || "low",
      message_excerpt: (item.message_excerpt || "").slice(0, 200),
      suggestion: item.suggestion || "",
      source: "n3_auto_critique",
    });
    emitted++;
  }

  res.json({ critiques, emitted, ...(parseError ? { parse_error: true } : {}) });
}

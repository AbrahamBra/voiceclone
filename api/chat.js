import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

const ACCESS_CODE = process.env.ACCESS_CODE || "ahmet99";

// ============================================================
// KNOWLEDGE BASE — Dynamic loading from /knowledge/
// ============================================================

function loadPage(relativePath) {
  try {
    return readFileSync(join(process.cwd(), "knowledge", relativePath), "utf-8");
  } catch {
    return null;
  }
}

// Topic → wiki pages mapping (ordered by specificity)
const TOPIC_MAP = [
  {
    keywords: ["prise de parole", "oral", "parler", "présenter", "présentation", "discours",
      "trac", "confiance", "public", "3c", "clair", "captivant", "crédible", "chaleur",
      "autorité", "valeur présumée", "valeur perçue", "entretien", "recrutement"],
    pages: ["topics/prise-de-parole.md"],
  },
  {
    keywords: ["écoute", "écouter", "entendre", "attention", "rasa", "silence", "retenir",
      "schéma", "filtre"],
    pages: ["concepts/ecoute-active.md"],
  },
  {
    keywords: ["pouvoir", "hiérarchie", "manager", "carrière", "politique", "coalition",
      "statut", "entreprise", "dirigeant", "capital", "poste"],
    pages: ["concepts/pouvoir-entreprise.md"],
  },
  {
    keywords: ["émotion", "émotionnel", "résilience", "stress", "gestion", "perspective",
      "curiosité", "rire", "pardonner", "passé", "introspect"],
    pages: ["concepts/competence-emotionnelle.md"],
  },
  {
    keywords: ["ignorance", "consensus", "groupe", "opinion", "conformité", "pluraliste",
      "pression sociale", "autocensure", "orange", "croire"],
    pages: ["concepts/ignorance-pluraliste.md"],
  },
  {
    keywords: ["dm", "message", "linkedin", "prospection", "prospect", "rendez-vous", "rdv",
      "relance", "repondre", "reponse", "cold", "outreach", "prendre contact",
      "prise de contact", "objection", "pas le bon moment", "closer"],
    pages: ["topics/dm-linkedin-rdv.md"],
  },
];

function detectRelevantPages(messages) {
  const text = messages
    .slice(-6)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase()
    // normalize accents for matching
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const pages = new Set();
  for (const { keywords, pages: ps } of TOPIC_MAP) {
    const normalizedKw = keywords.map((k) =>
      k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    );
    if (normalizedKw.some((k) => text.includes(k))) {
      ps.forEach((p) => pages.add(p));
    }
  }
  return [...pages];
}

function buildKnowledgeContext(messages) {
  // Always load Ahmet's entity page (core identity + voice DNA)
  const entityPage = loadPage("entities/ahmet-akyurek.md");

  // Always load corrections (feedback loop from conversations)
  const correctionsPage = loadPage("meta/corrections.md");

  // Detect and load relevant topic/concept pages
  const relevantPaths = detectRelevantPages(messages);
  const additionalPages = relevantPaths.map((p) => loadPage(p)).filter(Boolean);

  let ctx = "";
  if (entityPage) ctx += `BASE DE CONNAISSANCE — PROFIL AHMET :\n${entityPage}\n\n`;
  if (correctionsPage) ctx += `CORRECTIONS & APPRENTISSAGES (regles apprises par feedback) :\n${correctionsPage}\n\n`;
  if (additionalPages.length > 0) {
    ctx += `BASE DE CONNAISSANCE — CONTEXTE DETECÉ :\n`;
    ctx += additionalPages.join("\n\n---\n\n");
    ctx += "\n\n";
  }
  return ctx;
}

// ============================================================
// SCENARIO INSTRUCTIONS — Loaded from knowledge/scenarios/
// ============================================================

const HUMANIZER_RULES = loadPage("scenarios/humanizer-rules.md") || "";
const IDENTITY_INSTRUCTION = loadPage("scenarios/identity.md") || "";
const ANALYZE_INSTRUCTION = loadPage("scenarios/analyze.md") || "";
const FREE_CHAT_INSTRUCTION = loadPage("scenarios/free-chat.md") || "";

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildSystemPrompt(scenario, messages) {
  const knowledge = buildKnowledgeContext(messages);
  let prompt = knowledge;
  prompt += "REGLES HUMANIZER (a appliquer a chaque message) :\n" + HUMANIZER_RULES + "\n\n";
  prompt += "INSTRUCTION D'IDENTITE :\n" + IDENTITY_INSTRUCTION + "\n\n";

  if (scenario === "analyze") {
    prompt += "INSTRUCTION SCENARIO ANALYSE :\n" + ANALYZE_INSTRUCTION;
  } else {
    prompt += "INSTRUCTION SCENARIO CHAT LIBRE :\n" + FREE_CHAT_INSTRUCTION;
  }

  return prompt;
}

// ============================================================
// SELF-CRITIQUE LOOP (Level 4)
// ============================================================

async function criticCheck(client, responseText, corrections) {
  if (!corrections) return { pass: true };

  try {
    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        "Tu es un reviewer strict. Voici les regles a verifier :",
        "",
        corrections,
        "",
        "Verifie si le message suivant viole une ou plusieurs de ces regles.",
        "Reponds UNIQUEMENT en JSON valide :",
        '{"pass": true} si aucune violation',
        '{"pass": false, "violations": ["description de chaque violation"]} si violation(s)',
      ].join("\n"),
      messages: [{ role: "user", content: responseText }],
    });

    const raw = result.content[0].text.trim();
    // Extract JSON even if wrapped in markdown code blocks
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pass: true };
    return JSON.parse(jsonMatch[0]);
  } catch {
    // Critic failed → graceful fallback, pass through
    return { pass: true };
  }
}

// ============================================================
// HANDLER
// ============================================================

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const code = req.query.code || req.headers["x-access-code"];
  if (code !== ACCESS_CODE) {
    res.status(403).json({ error: "Code d'acces invalide" });
    return;
  }

  const { scenario, messages, profileText } = req.body;

  if (!scenario || !messages) {
    res.status(400).json({ error: "Missing scenario or messages" });
    return;
  }

  const systemPrompt = buildSystemPrompt(scenario, messages);

  const trimmedMessages = messages.slice(-12);

  if (scenario === "analyze" && profileText && trimmedMessages.length === 1) {
    trimmedMessages[0] = {
      role: "user",
      content: "Voici le profil LinkedIn a analyser :\n\n" + profileText,
    };
  }

  const client = new Anthropic();
  const corrections = loadPage("meta/corrections.md");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // Signal: thinking (frontend can show a loading indicator)
    res.write("data: " + JSON.stringify({ type: "thinking" }) + "\n\n");

    // === PASS 1: Generate (non-streaming) ===
    const pass1 = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: trimmedMessages,
    });

    const pass1Text = pass1.content[0].text;

    // === PASS 2: Critic check against corrections ===
    const verdict = await criticCheck(client, pass1Text, corrections);

    if (verdict.pass) {
      // No violations → stream pass 1 result directly
      res.write("data: " + JSON.stringify({ type: "delta", text: pass1Text }) + "\n\n");
      res.write("data: " + JSON.stringify({ type: "done" }) + "\n\n");
      res.end();
      return;
    }

    // === PASS 3: Regenerate with critic feedback ===
    const violationFeedback = verdict.violations.join("\n- ");
    const correctedMessages = [
      ...trimmedMessages,
      { role: "assistant", content: pass1Text },
      {
        role: "user",
        content: [
          "SYSTEME INTERNE — AUTOCRITIQUE :",
          "Ton message precedent viole ces regles apprises :",
          "- " + violationFeedback,
          "",
          "Reecris ton message en corrigeant ces violations. Garde le meme intent et la meme longueur.",
          "Reponds UNIQUEMENT avec le message corrige, rien d'autre.",
        ].join("\n"),
      },
    ];

    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: correctedMessages,
    });

    stream.on("text", (text) => {
      res.write("data: " + JSON.stringify({ type: "delta", text }) + "\n\n");
    });

    stream.on("end", () => {
      res.write("data: " + JSON.stringify({ type: "done" }) + "\n\n");
      res.end();
    });

    stream.on("error", (err) => {
      if (res.headersSent) {
        res.write(
          "data: " + JSON.stringify({ type: "error", text: "Erreur de generation" }) + "\n\n"
        );
        res.end();
      } else {
        res.status(500).json({ error: "Erreur serveur : " + err.message });
      }
    });
  } catch (err) {
    if (res.headersSent) {
      res.write(
        "data: " + JSON.stringify({ type: "error", text: "Erreur de generation" }) + "\n\n"
      );
      res.end();
    } else {
      res.status(500).json({ error: "Erreur serveur : " + err.message });
    }
  }
}

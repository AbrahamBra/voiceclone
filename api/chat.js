import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { rateLimit } from "./_rateLimit.js";

const ACCESS_CODE = process.env.ACCESS_CODE;

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
  const detectedPages = detectRelevantPages(messages);
  const additionalPages = detectedPages.map((p) => loadPage(p)).filter(Boolean);

  let ctx = "";
  if (entityPage) ctx += `BASE DE CONNAISSANCE — PROFIL AHMET :\n${entityPage}\n\n`;
  if (correctionsPage) ctx += `CORRECTIONS & APPRENTISSAGES (regles apprises par feedback) :\n${correctionsPage}\n\n`;
  if (additionalPages.length > 0) {
    ctx += `BASE DE CONNAISSANCE — CONTEXTE DETECÉ :\n`;
    ctx += additionalPages.join("\n\n---\n\n");
    ctx += "\n\n";
  }
  return { context: ctx, detectedPages };
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
  const { context: knowledge, detectedPages } = buildKnowledgeContext(messages);
  let prompt = knowledge;
  prompt += "REGLES HUMANIZER (a appliquer a chaque message) :\n" + HUMANIZER_RULES + "\n\n";
  prompt += "INSTRUCTION D'IDENTITE :\n" + IDENTITY_INSTRUCTION + "\n\n";

  if (scenario === "analyze") {
    prompt += "INSTRUCTION SCENARIO ANALYSE :\n" + ANALYZE_INSTRUCTION;
  } else {
    prompt += "INSTRUCTION SCENARIO CHAT LIBRE :\n" + FREE_CHAT_INSTRUCTION;
  }

  return { prompt, detectedPages };
}

// ============================================================
// SELF-CRITIQUE LOOP (Level 4)
// ============================================================

async function criticCheck(client, responseText, corrections) {
  if (!corrections) return { pass: true, violations: [], error: false };

  try {
    const result = await client.messages.create({
      model: "claude-sonnet-4-20250514",
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
    if (!jsonMatch) return { pass: true, violations: [], error: false };

    const parsed = JSON.parse(jsonMatch[0]);
    // Defensive validation — Haiku may return unexpected shapes
    const pass = parsed.pass === true;
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    return { pass, violations, error: false };
  } catch {
    // Critic failed → graceful fallback, pass through
    return { pass: true, violations: [], error: true };
  }
}

// ============================================================
// HANDLER
// ============================================================

// ============================================================
// INPUT VALIDATION
// ============================================================

function validateInput(body) {
  const { scenario, messages, profileText } = body || {};

  if (!["free", "analyze"].includes(scenario)) {
    return "Invalid scenario: must be 'free' or 'analyze'";
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return "messages must be an array of 1-20 items";
  }

  for (const msg of messages) {
    if (!msg.role || !["user", "assistant"].includes(msg.role)) {
      return "Each message must have role 'user' or 'assistant'";
    }
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
      return "Each message content must be a non-empty string under 10000 chars";
    }
  }

  if (profileText !== undefined && (typeof profileText !== "string" || profileText.length > 20000)) {
    return "profileText must be a string under 20000 chars";
  }

  return null;
}

// ============================================================
// HANDLER
// ============================================================

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Server misconfiguration guard
  if (!ACCESS_CODE) {
    res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" });
    return;
  }

  // Rate limiting
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const rl = rateLimit(ip);
  if (!rl.allowed) {
    res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter });
    return;
  }

  // Auth — header only (no query param)
  const code = req.headers["x-access-code"];
  if (code !== ACCESS_CODE) {
    res.status(403).json({ error: "Code d'acces invalide" });
    return;
  }

  // Input validation
  const validationError = validateInput(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { scenario, messages, profileText } = req.body;

  const { prompt: systemPrompt, detectedPages } = buildSystemPrompt(scenario, messages);
  const t0 = Date.now();

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

  // Helper to write SSE events
  const sse = (type, data = {}) => {
    res.write("data: " + JSON.stringify({ type, ...data }) + "\n\n");
  };

  try {
    // === PASS 1: Generate (STREAMING to client in real time) ===
    sse("thinking");

    const stream1 = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: trimmedMessages,
    });

    let pass1Text = "";

    stream1.on("text", (text) => {
      pass1Text += text;
      sse("delta", { text });
    });

    stream1.on("error", (err) => {
      // Pass 1 error mid-stream — show error but keep partial text
      console.log(JSON.stringify({
        event: "chat_error", ts: new Date().toISOString(), scenario,
        error: err.message || "Stream error", failedAt: "pass1", elapsedMs: Date.now() - t0,
        partialChars: pass1Text.length,
      }));
      sse("error", { text: "Erreur de generation" });
      res.end();
    });

    await stream1.finalMessage();
    const t1 = Date.now();

    // === PASS 2: Critic check (with keep-alive pings) ===
    sse("validating");

    // Keep-alive ping every 5s to prevent Vercel edge proxy from closing idle SSE
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 5000);

    const verdict = await criticCheck(client, pass1Text, corrections);
    clearInterval(keepAlive);
    const t2 = Date.now();

    const knowledgeLog = { detected: detectedPages, count: detectedPages.length };

    if (verdict.pass) {
      // No violations → user already saw the full text via streaming, just close
      sse("done");
      res.end();
      // Exit A: pass1 streamed + accepted
      const t3 = Date.now();
      console.log(JSON.stringify({
        event: "chat_complete", ts: new Date().toISOString(), scenario,
        totalMs: t3 - t0,
        pass1: { ms: t1 - t0 },
        critic: { ms: t2 - t1, pass: true, violations: [], error: verdict.error || false },
        pass3: { triggered: false, ms: 0 },
        knowledge: knowledgeLog,
      }));
      return;
    }

    // === PASS 3: Critic failed — rewrite ===
    sse("rewriting");
    // Clear previous text on client side (pass 1 content was a draft)
    sse("clear");

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

    const stream3 = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: correctedMessages,
    });

    stream3.on("text", (text) => {
      sse("delta", { text });
    });

    stream3.on("end", () => {
      sse("done");
      res.end();
      // Exit B: pass3 complete
      const t3 = Date.now();
      console.log(JSON.stringify({
        event: "chat_complete", ts: new Date().toISOString(), scenario,
        totalMs: t3 - t0,
        pass1: { ms: t1 - t0 },
        critic: { ms: t2 - t1, pass: false, violations: verdict.violations, error: false },
        pass3: { triggered: true, ms: t3 - t2 },
        knowledge: knowledgeLog,
      }));
    });

    stream3.on("error", (err) => {
      // Exit C: pass3 streaming failure
      const t3 = Date.now();
      console.log(JSON.stringify({
        event: "chat_error", ts: new Date().toISOString(), scenario,
        error: err.message || "Stream error", failedAt: "pass3", elapsedMs: t3 - t0,
      }));
      sse("error", { text: "Erreur de generation" });
      res.end();
    });
  } catch (err) {
    // Exit D: setup or critic failure
    const tErr = Date.now();
    console.log(JSON.stringify({
      event: "chat_error", ts: new Date().toISOString(), scenario,
      error: err.message || "Unknown error", failedAt: "setup_or_critic", elapsedMs: tErr - t0,
    }));
    if (res.headersSent) {
      sse("error", { text: "Erreur de generation" });
      res.end();
    } else {
      res.status(500).json({ error: "Erreur serveur : " + err.message });
    }
  }
}

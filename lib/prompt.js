import { readFileSync } from "fs";
import { join } from "path";

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
  const entityPage = loadPage("entities/ahmet-akyurek.md");
  const correctionsPage = loadPage("meta/corrections.md");
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
// EXPORTS
// ============================================================

export { loadPage };

export function buildSystemPrompt(scenario, messages) {
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

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "../lib/prompt.js";

const PERSONA = {
  name: "Thomas",
  title: "Expert LinkedIn",
  description: "Aide les entrepreneurs a scaler sur LinkedIn.",
  voice: {
    tone: ["direct", "cash", "entrepreneur"],
    personality: ["pragmatique", "energique"],
    signaturePhrases: ["C'est propre", "Niiicce!"],
    forbiddenWords: ["synergie", "cordialement"],
    neverDoes: ["Ne fait jamais de listes a puces", "Ne dit jamais merci sans raison"],
    writingRules: ["Messages ultra-courts (5-15 mots)", "Style WhatsApp"],
  },
  scenarios: {
    default: { label: "Conversation", slug: "default" },
  },
};

describe("buildSystemPrompt", () => {
  it("includes persona identity", () => {
    const { prompt } = buildSystemPrompt({ persona: PERSONA });
    assert.ok(prompt.includes("Tu es Thomas"));
    assert.ok(prompt.includes("Expert LinkedIn"));
  });

  it("includes voice rules", () => {
    const { prompt } = buildSystemPrompt({ persona: PERSONA });
    assert.ok(prompt.includes("direct, cash, entrepreneur"));
    assert.ok(prompt.includes("synergie"));
    assert.ok(prompt.includes("C'est propre"));
    assert.ok(prompt.includes("REGLES DE VOIX"));
  });

  it("includes format rules", () => {
    const { prompt } = buildSystemPrompt({ persona: PERSONA });
    assert.ok(prompt.includes("PLUSIEURS messages courts"));
    assert.ok(prompt.includes("Style WhatsApp"));
  });

  it("includes corrections when provided", () => {
    const corrections = "# Corrections apprises\n\n- **2026-04-10** — Ne jamais tutoyer au premier message\n- **2026-04-11** — Toujours poser une question ouverte";
    const { prompt } = buildSystemPrompt({ persona: PERSONA, corrections });
    assert.ok(prompt.includes("CORRECTIONS"));
    assert.ok(prompt.includes("tutoyer"));
  });

  it("consolidates repeated corrections into permanent rules", () => {
    // Need 4+ lines total (guard: split("\n").length > 3) and words >3 chars with >60% overlap
    const lines = [
      "- **2026-04-10** — Toujours utiliser le tutoiement familier dans les conversations",
      "- **2026-04-11** — Toujours utiliser le tutoiement familier dans les messages",
      "- **2026-04-12** — Toujours utiliser le tutoiement familier dans les echanges",
    ];
    const corrections = "# Corrections apprises\n\n" + lines.join("\n");
    const { prompt } = buildSystemPrompt({ persona: PERSONA, corrections });
    assert.ok(prompt.includes("REGLE PERMANENTE (3x)"));
  });

  it("includes scenario content", () => {
    const scenarioContent = "Tu es en mode qualification. Pose 3 questions avant de proposer un RDV.";
    const { prompt } = buildSystemPrompt({ persona: PERSONA, scenarioContent });
    assert.ok(prompt.includes("INSTRUCTIONS DU SCENARIO"));
    assert.ok(prompt.includes("qualification"));
  });

  it("includes ontology entities", () => {
    const ontology = {
      entities: [
        { id: "1", name: "Content Marketing", description: "Strategie de contenu", confidence: 0.9 },
        { id: "2", name: "LinkedIn Algorithm", description: "Algo de distribution", confidence: 0.8 },
      ],
      relations: [
        { from_entity_id: "1", to_entity_id: "2", relation_type: "uses", from_name: "Content Marketing", to_name: "LinkedIn Algorithm" },
      ],
    };
    const { prompt } = buildSystemPrompt({ persona: PERSONA, ontology });
    assert.ok(prompt.includes("CONCEPTS CLES"));
    assert.ok(prompt.includes("Content Marketing"));
  });

  it("includes knowledge matches", () => {
    const knowledgeMatches = [
      { path: "topics/style.md", content: "Thomas ecrit en style ultra-direct, messages de 5 mots max." },
    ];
    const { prompt } = buildSystemPrompt({ persona: PERSONA, knowledgeMatches });
    assert.ok(prompt.includes("CONTEXTE"));
    assert.ok(prompt.includes("ultra-direct"));
  });

  it("respects token budget — truncates knowledge", () => {
    // TOKEN_BUDGET is 12000 → ~48000 chars max. Feed 60000 chars so truncation fires.
    const INPUT_SIZE = 60000;
    const bigKnowledge = [
      { path: "big.md", content: "X".repeat(INPUT_SIZE) },
    ];
    const { prompt } = buildSystemPrompt({ persona: PERSONA, knowledgeMatches: bigKnowledge });
    // Should be truncated — final prompt must be smaller than the raw input
    assert.ok(prompt.length < INPUT_SIZE, `expected truncation below ${INPUT_SIZE}, got ${prompt.length}`);
    assert.ok(prompt.includes("[...]"));
  });

  it("returns detectedPages from knowledge matches", () => {
    const knowledgeMatches = [
      { path: "topics/style.md", content: "content" },
      { path: "topics/gtm.md", content: "content2" },
    ];
    const { detectedPages } = buildSystemPrompt({ persona: PERSONA, knowledgeMatches });
    assert.deepEqual(detectedPages, ["topics/style.md", "topics/gtm.md"]);
  });

  it("handles all empty optional params", () => {
    const { prompt } = buildSystemPrompt({ persona: PERSONA });
    assert.ok(prompt.includes("Tu es Thomas"));
    assert.ok(!prompt.includes("CORRECTIONS"));
    assert.ok(!prompt.includes("CONCEPTS CLES"));
    assert.ok(!prompt.includes("CONTEXTE"));
  });

  it("priority order: voice > corrections > scenario > ontology > knowledge", () => {
    // Need 4+ lines (guard: split("\n").length > 3)
    const corrections = "# Corrections apprises\n\n- **2026-04-10** — Toujours tutoyer\n- **2026-04-11** — Jamais de vouvoiement";
    const scenarioContent = "Mode qualification";
    const ontology = { entities: [{ id: "1", name: "SEO", description: "Search", confidence: 1 }], relations: [] };
    const knowledgeMatches = [{ path: "k.md", content: "Knowledge content here" }];

    const { prompt } = buildSystemPrompt({ persona: PERSONA, corrections, scenarioContent, ontology, knowledgeMatches });

    const voiceIdx = prompt.indexOf("REGLES DE VOIX");
    const corrIdx = prompt.indexOf("CORRECTIONS");
    const scenIdx = prompt.indexOf("INSTRUCTIONS DU SCENARIO");
    const ontIdx = prompt.indexOf("CONCEPTS CLES");
    const knIdx = prompt.indexOf("CONTEXTE");

    assert.ok(voiceIdx < corrIdx, "voice before corrections");
    assert.ok(corrIdx < scenIdx, "corrections before scenario");
    assert.ok(scenIdx < ontIdx, "scenario before ontology");
    assert.ok(ontIdx < knIdx, "ontology before knowledge");
  });
});

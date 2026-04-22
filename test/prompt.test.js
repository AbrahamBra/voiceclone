import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "../lib/prompt.js";
import { mergeBaselineVoice, DEMO_BASELINE_VOICE } from "../lib/demo-baseline-rules.js";

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

  it("switches to post-format when scenarioKind='post'", () => {
    const { prompt } = buildSystemPrompt({ persona: PERSONA, scenarioKind: "post" });
    assert.ok(prompt.includes("POST LINKEDIN"), "post header must appear");
    assert.ok(prompt.includes("SEUL bloc"), "single-block rule must appear");
    assert.ok(!prompt.includes("PLUSIEURS messages courts"), "no WhatsApp multi-message rule");
    assert.ok(!prompt.includes("Style WhatsApp, pas email"), "no WhatsApp framing for posts");
  });

  it("voice reinforcement uses post hint when kind='post' and budget saturated", () => {
    // Only scenarioContent/corrections/ontology update usedTokens; knowledge
    // doesn't, so saturate via a large scenarioContent to trip the >4000 guard.
    const bigScenario = "X".repeat(20000);
    const { prompt } = buildSystemPrompt({
      persona: PERSONA,
      scenarioContent: bigScenario,
      scenarioKind: "post",
    });
    assert.ok(prompt.includes("Format post LinkedIn complet"), "post reinforcement hint");
    assert.ok(!/Style WhatsApp, messages courts\./.test(prompt.slice(-400)),
      "no WhatsApp reinforcement tail for posts");
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

  it("returns injectedEntities with names of entities that made it into the prompt", () => {
    const ontology = {
      entities: [
        { id: "1", name: "Content Marketing", description: "x", confidence: 0.9 },
        { id: "2", name: "LinkedIn Algorithm", description: "y", confidence: 0.8 },
      ],
      relations: [],
    };
    const { injectedEntities } = buildSystemPrompt({ persona: PERSONA, ontology });
    assert.deepEqual(injectedEntities, ["Content Marketing", "LinkedIn Algorithm"]);
  });

  it("returns empty injectedEntities when no ontology", () => {
    const { injectedEntities } = buildSystemPrompt({ persona: PERSONA });
    assert.deepEqual(injectedEntities, []);
  });

  it("injectedEntities only contains entities that survived the token budget", () => {
    const entities = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: `Entity${i}`,
      description: "padding ".repeat(50),
      confidence: 1 - i / 100,
    }));
    const { injectedEntities } = buildSystemPrompt({ persona: PERSONA, ontology: { entities, relations: [] } });
    assert.ok(injectedEntities.length > 0 && injectedEntities.length < entities.length,
      `expected truncation, got ${injectedEntities.length} of ${entities.length}`);
    assert.strictEqual(injectedEntities[0], "Entity0");
  });

  it("returns injectedCorrectionsCount reflecting lines actually kept", () => {
    const lines = [
      "- **2026-04-10** — Toujours tutoyer",
      "- **2026-04-11** — Jamais de vouvoiement",
      "- **2026-04-12** — Garder les phrases courtes",
    ];
    const corrections = "# Corrections apprises\n\n" + lines.join("\n");
    const { injectedCorrectionsCount } = buildSystemPrompt({ persona: PERSONA, corrections });
    assert.strictEqual(injectedCorrectionsCount, 3);
  });

  it("returns injectedCorrectionsCount = 0 when no corrections", () => {
    const { injectedCorrectionsCount } = buildSystemPrompt({ persona: PERSONA });
    assert.strictEqual(injectedCorrectionsCount, 0);
  });

  it("handles all empty optional params", () => {
    const { prompt } = buildSystemPrompt({ persona: PERSONA });
    assert.ok(prompt.includes("Tu es Thomas"));
    assert.ok(!prompt.includes("CORRECTIONS"));
    assert.ok(!prompt.includes("CONCEPTS CLES"));
    assert.ok(!prompt.includes("CONTEXTE"));
  });

  it("merges baseline voice — baseline items appear in prompt even when persona omits them", () => {
    // PERSONA has its own tone/forbiddenWords, but NOT baseline-only items like
    // "fondamentalement" or "pas corporate". After merge, those should appear.
    const { prompt } = buildSystemPrompt({ persona: PERSONA });
    assert.ok(prompt.includes("fondamentalement"), "baseline forbidden word should be in prompt");
    assert.ok(prompt.includes("pas corporate"), "baseline personality should be in prompt");
    assert.ok(prompt.includes("Tutoiement par défaut en DM LinkedIn"), "baseline writingRule should be in prompt");
    // Persona's own rules must still be there.
    assert.ok(prompt.includes("synergie"));
    assert.ok(prompt.includes("Style WhatsApp"));
  });

  it("mergeBaselineVoice — returns full baseline when voice is missing", () => {
    const merged = mergeBaselineVoice(undefined);
    assert.deepEqual(merged.tone, DEMO_BASELINE_VOICE.tone);
    assert.deepEqual(merged.forbiddenWords, DEMO_BASELINE_VOICE.forbiddenWords);
    assert.deepEqual(merged.signaturePhrases, []);
  });

  it("mergeBaselineVoice — dedupes case-insensitively, persona items come first", () => {
    const merged = mergeBaselineVoice({
      tone: ["Direct", "custom"],                 // "Direct" overlaps baseline "direct"
      forbiddenWords: ["synergie", "custom-word"], // "synergie" also in baseline
    });
    // Persona's "Direct" appears once (casing preserved), baseline's duplicate skipped.
    const directMatches = merged.tone.filter((t) => t.toLowerCase() === "direct");
    assert.strictEqual(directMatches.length, 1);
    assert.strictEqual(merged.tone[0], "Direct", "persona item keeps first position");
    assert.ok(merged.tone.includes("custom"));
    assert.ok(merged.tone.includes("concret"), "baseline non-duplicate is added");

    const synergieMatches = merged.forbiddenWords.filter((w) => w.toLowerCase() === "synergie");
    assert.strictEqual(synergieMatches.length, 1);
    assert.ok(merged.forbiddenWords.includes("custom-word"));
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

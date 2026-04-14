import { getPersona, findRelevantKnowledge, loadPersonaFile } from "./knowledge.js";

export function buildSystemPrompt(scenario, messages) {
  const persona = getPersona();
  const v = persona.voice;

  let prompt = `Tu es ${persona.name}, ${persona.title}.\n`;
  prompt += `${persona.description}\n\n`;

  prompt += "REGLES DE VOIX :\n";
  prompt += `- Ton : ${v.tone.join(", ")}\n`;
  prompt += `- Personnalite : ${v.personality.join(", ")}\n`;
  prompt += `- Phrases signatures a utiliser naturellement : ${v.signaturePhrases.map((p) => `"${p}"`).join(" | ")}\n`;
  prompt += `- Mots INTERDITS (ne jamais utiliser) : ${v.forbiddenWords.join(", ")}\n`;
  prompt += `- Ne jamais faire : ${v.neverDoes.join(" ; ")}\n`;
  prompt += `- Regles d'ecriture : ${v.writingRules.join(" ; ")}\n\n`;

  // Corrections apprises (feedback loop)
  const corrections = loadPersonaFile("corrections.md");
  if (corrections && corrections.trim().split("\n").length > 3) {
    prompt += "CORRECTIONS & APPRENTISSAGES (regles apprises par feedback, PRIORITE HAUTE) :\n";
    prompt += corrections + "\n\n";
  }

  const knowledgeMatches = findRelevantKnowledge(messages);
  const detectedPages = knowledgeMatches.map((m) => m.path);
  if (knowledgeMatches.length > 0) {
    prompt += "BASE DE CONNAISSANCE — CONTEXTE DETECTE :\n";
    prompt += knowledgeMatches.map((m) => m.content).join("\n\n---\n\n");
    prompt += "\n\n";
  }

  const scenarioConfig = persona.scenarios[scenario] || persona.scenarios.default;
  if (scenarioConfig?.file) {
    const scenarioContent = loadPersonaFile(scenarioConfig.file);
    if (scenarioContent) {
      prompt += "INSTRUCTIONS DU SCENARIO :\n" + scenarioContent + "\n";
    }
  }

  return { prompt, detectedPages };
}

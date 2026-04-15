/**
 * Build the system prompt from persona data.
 * Pure function — accepts data objects, no filesystem or DB calls.
 */
export function buildSystemPrompt({ persona, knowledgeMatches, scenarioContent, corrections, ontology }) {
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

  // Corrections apprises (feedback loop — PRIORITE HAUTE)
  if (corrections && corrections.trim().split("\n").length > 3) {
    prompt += "CORRECTIONS & APPRENTISSAGES (regles apprises par feedback, PRIORITE HAUTE) :\n";
    prompt += corrections + "\n\n";
  }

  // Ontology — knowledge graph context (max 10 entities to avoid prompt dilution)
  if (ontology && ontology.entities?.length > 0) {
    const topEntities = ontology.entities.slice(0, 10);
    const topRelations = (ontology.relations || []).slice(0, 8);
    prompt += "CONCEPTS CLES (utilise-les naturellement) :\n";
    for (const e of topEntities) {
      prompt += `- ${e.name} : ${e.description || ""}\n`;
    }
    if (topRelations.length > 0) {
      for (const r of topRelations) {
        const labels = { equals: "=", includes: "contient", contradicts: "≠", causes: "→", uses: "utilise", prerequisite: "necessite" };
        prompt += `- ${r.from_name || "?"} ${labels[r.relation_type] || "→"} ${r.to_name || "?"}\n`;
      }
    }
    prompt += "\n";
  }

  // Knowledge context (keyword-matched files)
  const detectedPages = (knowledgeMatches || []).map((m) => m.path);
  if (knowledgeMatches && knowledgeMatches.length > 0) {
    prompt += "BASE DE CONNAISSANCE — CONTEXTE DETECTE :\n";
    prompt += knowledgeMatches.map((m) => m.content).join("\n\n---\n\n");
    prompt += "\n\n";
  }

  // Scenario instructions
  if (scenarioContent) {
    prompt += "INSTRUCTIONS DU SCENARIO :\n" + scenarioContent + "\n";
  }

  return { prompt, detectedPages };
}

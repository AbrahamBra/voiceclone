// ============================================================
// SELF-CRITIQUE LOOP — Validates responses against learned rules
// ============================================================

export async function criticCheck(client, responseText, corrections) {
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
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pass: true, violations: [], error: false };

    const parsed = JSON.parse(jsonMatch[0]);
    const pass = parsed.pass === true;
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    return { pass, violations, error: false };
  } catch {
    return { pass: true, violations: [], error: true };
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { getPersona, loadPersonaFile } from "./knowledge.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

export async function criticCheck(client, responseText) {
  const persona = getPersona();
  const v = persona.voice;

  const rulesParts = [
    `Mots interdits : ${v.forbiddenWords.join(", ")}`,
    `Regles d'ecriture : ${v.writingRules.join(" ; ")}`,
    `Ne jamais faire : ${v.neverDoes.join(" ; ")}`,
  ];

  // Add learned corrections (high priority)
  const corrections = loadPersonaFile("corrections.md");
  if (corrections && corrections.trim().split("\n").length > 3) {
    rulesParts.push(`\nCORRECTIONS APPRISES (priorite haute) :\n${corrections}`);
  }

  const rules = rulesParts.join("\n");

  try {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: [
        "Tu es un reviewer strict. Voici les regles a verifier :",
        "", rules, "",
        "Verifie si le message suivant viole une ou plusieurs de ces regles.",
        'Reponds UNIQUEMENT en JSON valide :',
        '{"pass": true} si aucune violation',
        '{"pass": false, "violations": ["description de chaque violation"]} si violation(s)',
      ].join("\n"),
      messages: [{ role: "user", content: responseText }],
    });
    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pass: true, violations: [], error: false };
    const parsed = JSON.parse(jsonMatch[0]);
    return { pass: parsed.pass === true, violations: Array.isArray(parsed.violations) ? parsed.violations : [], error: false };
  } catch {
    return { pass: true, violations: [], error: true };
  }
}

export async function runPipeline({ systemPrompt, messages, sse, res }) {
  const client = new Anthropic();
  const t0 = Date.now();

  // PASS 1: Generate (streaming)
  sse("thinking");
  const stream1 = client.messages.stream({
    model: MODEL, max_tokens: 1024, system: systemPrompt, messages,
  });
  let pass1Text = "";
  stream1.on("text", (text) => { pass1Text += text; sse("delta", { text }); });
  await stream1.finalMessage();
  const t1 = Date.now();

  // PASS 2: Critique (with keep-alive)
  sse("validating");
  const keepAlive = setInterval(() => { res.write(": keep-alive\n\n"); }, 5000);
  const verdict = await criticCheck(client, pass1Text);
  clearInterval(keepAlive);
  const t2 = Date.now();

  if (verdict.pass) {
    sse("done");
    console.log(JSON.stringify({ event: "chat_complete", ts: new Date().toISOString(), totalMs: Date.now() - t0, pass1: { ms: t1 - t0 }, critic: { ms: t2 - t1, pass: true, violations: [], error: verdict.error }, pass3: { triggered: false } }));
    return { pass1Text, criticResult: verdict, rewritten: false };
  }

  // PASS 3: Rewrite (streaming)
  sse("rewriting");
  sse("clear");
  const violationFeedback = verdict.violations.join("\n- ");
  const stream3 = client.messages.stream({
    model: MODEL, max_tokens: 1024, system: systemPrompt,
    messages: [
      ...messages,
      { role: "assistant", content: pass1Text },
      { role: "user", content: `SYSTEME INTERNE — AUTOCRITIQUE :\nTon message precedent viole ces regles :\n- ${violationFeedback}\n\nReecris ton message en corrigeant ces violations. Garde le meme intent et la meme longueur.\nReponds UNIQUEMENT avec le message corrige, rien d'autre.` },
    ],
  });

  return new Promise((resolve, reject) => {
    stream3.on("text", (text) => { sse("delta", { text }); });
    stream3.on("end", () => {
      sse("done");
      const t3 = Date.now();
      console.log(JSON.stringify({ event: "chat_complete", ts: new Date().toISOString(), totalMs: t3 - t0, pass1: { ms: t1 - t0 }, critic: { ms: t2 - t1, pass: false, violations: verdict.violations, error: false }, pass3: { triggered: true, ms: t3 - t2 } }));
      resolve({ pass1Text, criticResult: verdict, rewritten: true });
    });
    stream3.on("error", (err) => { sse("done"); reject(err); });
  });
}

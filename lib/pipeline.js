import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const SCORE_THRESHOLD = 8.5;
const MAX_REWRITES = 2;

/**
 * Score a response on 4 dimensions (1-10).
 * Replaces the old binary criticCheck.
 */
export async function scoreResponse(client, responseText, voiceRules, corrections, knowledgeContext) {
  const rulesBlock = [
    `Mots interdits : ${voiceRules.forbiddenWords.join(", ")}`,
    `Regles d'ecriture : ${voiceRules.writingRules.join(" ; ")}`,
    `Ne jamais faire : ${voiceRules.neverDoes.join(" ; ")}`,
  ].join("\n");

  let correctionsBlock = "";
  if (corrections && corrections.trim().split("\n").length > 3) {
    correctionsBlock = `\nCORRECTIONS APPRISES (priorite haute) :\n${corrections}`;
  }

  let knowledgeBlock = "";
  if (knowledgeContext) {
    knowledgeBlock = `\nBASE DE CONNAISSANCE (resume) :\n${knowledgeContext.slice(0, 500)}`;
  }

  try {
    const result = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 512,
      system: `Tu es un evaluateur de qualite strict. Score cette reponse sur 4 dimensions de 1 a 10.

REGLES DE VOIX A RESPECTER :
${rulesBlock}
${correctionsBlock}
${knowledgeBlock}

Criteres :
1. voice (conformite voix) : respect du ton, mots interdits, regles d'ecriture
2. knowledge (pertinence) : utilise la base de connaissance, les frameworks du persona
3. natural (naturel) : sonne humain, pas IA (pas de tirets pour lier des idees, pas de formules generiques)
4. coherence : repond bien a la question posee

Reponds UNIQUEMENT en JSON :
{"global": 8.7, "voice": 9.0, "knowledge": 8.5, "natural": 8.8, "coherence": 8.5, "feedback": "Explication si score < 9", "improvements": ["amelioration 1", "amelioration 2"]}

Le score global est la MOYENNE des 4 dimensions. Sois exigeant : 10 = parfait clone humain, 7 = mediocre, 5 = mauvais.`,
      messages: [{ role: "user", content: responseText }],
    });

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { global: 8.5, voice: 8.5, knowledge: 8.5, natural: 8.5, coherence: 8.5, feedback: "", improvements: [], usage: result.usage };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      global: parsed.global || 8.5,
      voice: parsed.voice || 8.5,
      knowledge: parsed.knowledge || 8.5,
      natural: parsed.natural || 8.5,
      coherence: parsed.coherence || 8.5,
      feedback: parsed.feedback || "",
      improvements: parsed.improvements || [],
      usage: result.usage,
    };
  } catch {
    return { global: 8.5, voice: 8.5, knowledge: 8.5, natural: 8.5, coherence: 8.5, feedback: "", improvements: [], usage: null };
  }
}

/**
 * Run the full pipeline: generate → score → rewrite if needed.
 * Emits SSE events for the frontend to show progress.
 */
export async function runPipeline({ systemPrompt, messages, sse, res, voiceRules, corrections, apiKey, knowledgeContext }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let totalInput = 0, totalOutput = 0;

  // PASS 1: Generate (streaming)
  sse("thinking");
  const stream1 = client.messages.stream({
    model: DEFAULT_MODEL, max_tokens: 1024, system: systemPrompt, messages,
  });
  let currentText = "";
  stream1.on("text", (text) => { currentText += text; sse("delta", { text }); });
  const msg1 = await stream1.finalMessage();
  if (msg1.usage) { totalInput += msg1.usage.input_tokens; totalOutput += msg1.usage.output_tokens; }
  const t1 = Date.now();

  // PASS 2: Score (with keep-alive)
  sse("scoring");
  const keepAlive = setInterval(() => { res.write(": keep-alive\n\n"); }, 5000);

  let rewriteCount = 0;
  let finalScore = null;

  while (rewriteCount <= MAX_REWRITES) {
    const score = await scoreResponse(client, currentText, voiceRules, corrections, knowledgeContext);
    if (score.usage) { totalInput += score.usage.input_tokens; totalOutput += score.usage.output_tokens; }

    finalScore = score;

    // Emit score to frontend
    sse("score_result", {
      global: score.global,
      voice: score.voice,
      knowledge: score.knowledge,
      natural: score.natural,
      coherence: score.coherence,
      improvements: score.improvements,
    });

    if (score.global >= SCORE_THRESHOLD || rewriteCount >= MAX_REWRITES) {
      break;
    }

    // Rewrite
    rewriteCount++;
    sse("rewriting", { attempt: rewriteCount, feedback: score.feedback });
    sse("clear");

    const rewriteStream = client.messages.stream({
      model: DEFAULT_MODEL, max_tokens: 1024, system: systemPrompt,
      messages: [
        ...messages,
        { role: "assistant", content: currentText },
        { role: "user", content: `SYSTEME INTERNE — AUTOCRITIQUE (score: ${score.global}/10) :\nProblemes detectes :\n- ${score.feedback}\n${score.improvements.map(i => `- ${i}`).join("\n")}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent et la meme longueur.\nReponds UNIQUEMENT avec le message corrige.` },
      ],
    });

    currentText = "";
    rewriteStream.on("text", (text) => { currentText += text; sse("delta", { text }); });
    const rewriteMsg = await rewriteStream.finalMessage();
    if (rewriteMsg.usage) { totalInput += rewriteMsg.usage.input_tokens; totalOutput += rewriteMsg.usage.output_tokens; }
  }

  clearInterval(keepAlive);

  sse("done", {
    score: finalScore ? {
      global: finalScore.global,
      voice: finalScore.voice,
      knowledge: finalScore.knowledge,
      natural: finalScore.natural,
      coherence: finalScore.coherence,
    } : null,
    rewrites: rewriteCount,
  });

  const t2 = Date.now();
  console.log(JSON.stringify({
    event: "chat_complete", ts: new Date().toISOString(),
    totalMs: t2 - t0,
    pass1Ms: t1 - t0,
    score: finalScore?.global,
    rewrites: rewriteCount,
    tokens: { input: totalInput, output: totalOutput },
  }));

  return { usage: { input_tokens: totalInput, output_tokens: totalOutput } };
}

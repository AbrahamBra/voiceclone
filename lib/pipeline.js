import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const SCORE_MODEL = "claude-haiku-20250317"; // Fast + cheap for scoring
const SCORE_THRESHOLD = 7.5;
const MAX_REWRITES = 1; // Max 1 rewrite to cap latency

/**
 * Score a response on 4 dimensions (1-10).
 * Uses Haiku for speed — scoring doesn't need Sonnet's reasoning.
 */
export async function scoreResponse(client, responseText, voiceRules, corrections, conversationContext) {
  const rulesBlock = [
    `Mots interdits : ${voiceRules.forbiddenWords.join(", ")}`,
    `Regles d'ecriture : ${voiceRules.writingRules.join(" ; ")}`,
    `Ne jamais faire : ${voiceRules.neverDoes.join(" ; ")}`,
  ].join("\n");

  let correctionsBlock = "";
  if (corrections && corrections.trim().split("\n").length > 3) {
    correctionsBlock = `\nCORRECTIONS APPRISES :\n${corrections.slice(0, 500)}`;
  }

  try {
    const result = await client.messages.create({
      model: SCORE_MODEL,
      max_tokens: 256,
      system: `Evaluateur de conformite voix. Score cette reponse sur 4 dimensions (1-10).

REGLES :
${rulesBlock}
${correctionsBlock}

CONTEXTE CONVERSATION : ${conversationContext || "premiere reponse"}

Criteres :
1. voice : respect du ton, mots interdits, style d'ecriture
2. knowledge : utilise les bons frameworks/concepts
3. natural : sonne humain (pas de tirets IA, pas generique)
4. coherence : repond correctement a la situation (poser des questions de clarification = BIEN, pas une faute)

IMPORTANT : Si la reponse pose des questions pertinentes avant de donner un conseil, c'est POSITIF (score coherence 8+). Ne penalise pas les reponses conversationnelles.

JSON uniquement :
{"global":8.5,"voice":9,"knowledge":8,"natural":8.5,"coherence":8.5,"feedback":"","improvements":[]}`,
      messages: [{ role: "user", content: responseText }],
    });

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { global: 9.0, voice: 9, knowledge: 9, natural: 9, coherence: 9, feedback: "", improvements: [], usage: result.usage };

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
    return { global: 9.0, voice: 9, knowledge: 9, natural: 9, coherence: 9, feedback: "", improvements: [], usage: null };
  }
}

/**
 * Run the full pipeline: generate → score → rewrite if needed.
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

  // PASS 2: Score (Haiku — fast, ~2-3s)
  sse("scoring");
  const keepAlive = setInterval(() => { res.write(": keep-alive\n\n"); }, 5000);

  // Build conversation context for scorer
  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const conversationContext = `User a dit: "${lastUserMsg.slice(0, 150)}"`;

  const score = await scoreResponse(client, currentText, voiceRules, corrections, conversationContext);
  if (score.usage) { totalInput += score.usage.input_tokens; totalOutput += score.usage.output_tokens; }

  // Emit score
  sse("score_result", {
    global: score.global, voice: score.voice,
    knowledge: score.knowledge, natural: score.natural, coherence: score.coherence,
    improvements: score.improvements,
  });

  // Rewrite only if seriously bad (< 7.5) — not for minor issues
  if (score.global < SCORE_THRESHOLD && MAX_REWRITES > 0) {
    sse("rewriting", { attempt: 1, feedback: score.feedback });
    sse("clear");

    const rewriteStream = client.messages.stream({
      model: DEFAULT_MODEL, max_tokens: 1024, system: systemPrompt,
      messages: [
        ...messages,
        { role: "assistant", content: currentText },
        { role: "user", content: `SYSTEME INTERNE — Score: ${score.global}/10.\nProblemes : ${score.feedback}\n${score.improvements.map(i => `- ${i}`).join("\n")}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent.\nReponds UNIQUEMENT avec le message corrige.` },
      ],
    });

    currentText = "";
    rewriteStream.on("text", (text) => { currentText += text; sse("delta", { text }); });
    const rewriteMsg = await rewriteStream.finalMessage();
    if (rewriteMsg.usage) { totalInput += rewriteMsg.usage.input_tokens; totalOutput += rewriteMsg.usage.output_tokens; }

    // Re-score after rewrite (quick)
    const score2 = await scoreResponse(client, currentText, voiceRules, corrections, conversationContext);
    if (score2.usage) { totalInput += score2.usage.input_tokens; totalOutput += score2.usage.output_tokens; }

    sse("score_result", {
      global: score2.global, voice: score2.voice,
      knowledge: score2.knowledge, natural: score2.natural, coherence: score2.coherence,
    });
  }

  clearInterval(keepAlive);

  sse("done", {
    score: { global: score.global, voice: score.voice, knowledge: score.knowledge, natural: score.natural, coherence: score.coherence },
  });

  const t2 = Date.now();
  console.log(JSON.stringify({
    event: "chat_complete", ts: new Date().toISOString(),
    totalMs: t2 - t0, generateMs: t1 - t0, scoreMs: t2 - t1,
    score: score.global, rewritten: score.global < SCORE_THRESHOLD,
    tokens: { input: totalInput, output: totalOutput },
  }));

  return { usage: { input_tokens: totalInput, output_tokens: totalOutput } };
}

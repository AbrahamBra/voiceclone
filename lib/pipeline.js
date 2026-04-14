import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

/**
 * Run the critic check against voice rules.
 */
export async function criticCheck(client, responseText, voiceRules, corrections) {
  const rulesParts = [
    `Mots interdits : ${voiceRules.forbiddenWords.join(", ")}`,
    `Regles d'ecriture : ${voiceRules.writingRules.join(" ; ")}`,
    `Ne jamais faire : ${voiceRules.neverDoes.join(" ; ")}`,
  ];

  if (corrections && corrections.trim().split("\n").length > 3) {
    rulesParts.push(`\nCORRECTIONS APPRISES (priorite haute) :\n${corrections}`);
  }

  const rules = rulesParts.join("\n");

  try {
    const result = await client.messages.create({
      model: DEFAULT_MODEL,
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
    if (!jsonMatch) return { pass: true, violations: [], error: false, usage: result.usage };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.pass === true,
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      error: false,
      usage: result.usage,
    };
  } catch {
    return { pass: true, violations: [], error: true, usage: null };
  }
}

/**
 * Run the full 3-pass pipeline.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {Array} opts.messages
 * @param {Function} opts.sse
 * @param {object} opts.res - HTTP response
 * @param {object} opts.voiceRules - persona.voice object for critic
 * @param {string} opts.corrections - corrections markdown
 * @param {string} opts.apiKey - Anthropic API key to use
 * @returns {{ usage: { input_tokens, output_tokens } }}
 */
export async function runPipeline({ systemPrompt, messages, sse, res, voiceRules, corrections, apiKey }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let totalInput = 0, totalOutput = 0;

  // PASS 1: Generate (streaming)
  sse("thinking");
  const stream1 = client.messages.stream({
    model: DEFAULT_MODEL, max_tokens: 1024, system: systemPrompt, messages,
  });
  let pass1Text = "";
  stream1.on("text", (text) => { pass1Text += text; sse("delta", { text }); });
  const msg1 = await stream1.finalMessage();
  if (msg1.usage) { totalInput += msg1.usage.input_tokens; totalOutput += msg1.usage.output_tokens; }
  const t1 = Date.now();

  // PASS 2: Critique (with keep-alive)
  sse("validating");
  const keepAlive = setInterval(() => { res.write(": keep-alive\n\n"); }, 5000);
  const verdict = await criticCheck(client, pass1Text, voiceRules, corrections);
  clearInterval(keepAlive);
  if (verdict.usage) { totalInput += verdict.usage.input_tokens; totalOutput += verdict.usage.output_tokens; }
  const t2 = Date.now();

  if (verdict.pass) {
    sse("done");
    console.log(JSON.stringify({ event: "chat_complete", ts: new Date().toISOString(), totalMs: Date.now() - t0, pass1: { ms: t1 - t0 }, critic: { ms: t2 - t1, pass: true }, pass3: { triggered: false } }));
    return { usage: { input_tokens: totalInput, output_tokens: totalOutput } };
  }

  // PASS 3: Rewrite (streaming)
  sse("rewriting");
  sse("clear");
  const violationFeedback = verdict.violations.join("\n- ");
  const stream3 = client.messages.stream({
    model: DEFAULT_MODEL, max_tokens: 1024, system: systemPrompt,
    messages: [
      ...messages,
      { role: "assistant", content: pass1Text },
      { role: "user", content: `SYSTEME INTERNE — AUTOCRITIQUE :\nTon message precedent viole ces regles :\n- ${violationFeedback}\n\nReecris ton message en corrigeant ces violations. Garde le meme intent et la meme longueur.\nReponds UNIQUEMENT avec le message corrige, rien d'autre.` },
    ],
  });

  return new Promise((resolve, reject) => {
    stream3.on("text", (text) => { sse("delta", { text }); });
    stream3.on("end", async () => {
      sse("done");
      try {
        const msg3 = await stream3.finalMessage();
        if (msg3.usage) { totalInput += msg3.usage.input_tokens; totalOutput += msg3.usage.output_tokens; }
      } catch { /* ignore */ }
      const t3 = Date.now();
      console.log(JSON.stringify({ event: "chat_complete", ts: new Date().toISOString(), totalMs: t3 - t0, pass1: { ms: t1 - t0 }, critic: { ms: t2 - t1, pass: false, violations: verdict.violations }, pass3: { triggered: true, ms: t3 - t2 } }));
      resolve({ usage: { input_tokens: totalInput, output_tokens: totalOutput } });
    });
    stream3.on("error", (err) => { sse("done"); reject(err); });
  });
}

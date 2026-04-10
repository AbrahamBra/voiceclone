import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt, loadPage } from "../lib/prompt.js";
import { criticCheck } from "../lib/critic.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";

const ACCESS_CODE = process.env.ACCESS_CODE;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" }); return; }

  // Rate limiting
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const rl = rateLimit(ip);
  if (!rl.allowed) { res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter }); return; }

  // Auth
  if (req.headers["x-access-code"] !== ACCESS_CODE) { res.status(403).json({ error: "Code d'acces invalide" }); return; }

  // Validation
  const validationError = validateInput(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const { scenario, messages, profileText } = req.body;
  const { prompt: systemPrompt, detectedPages } = buildSystemPrompt(scenario, messages);
  const t0 = Date.now();

  const trimmedMessages = messages.slice(-12);
  if (scenario === "analyze" && profileText && trimmedMessages.length === 1) {
    trimmedMessages[0] = {
      role: "user",
      content: "Voici le profil LinkedIn a analyser :\n\n" + profileText,
    };
  }

  const client = new Anthropic();
  const corrections = loadPage("meta/corrections.md");
  const sse = initSSE(res);

  try {
    // === PASS 1: Generate (streaming to client) ===
    sse("thinking");
    const stream1 = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: trimmedMessages,
    });

    let pass1Text = "";
    stream1.on("text", (text) => { pass1Text += text; sse("delta", { text }); });
    stream1.on("error", (err) => {
      console.log(JSON.stringify({ event: "chat_error", ts: new Date().toISOString(), scenario, error: err.message || "Stream error", failedAt: "pass1", elapsedMs: Date.now() - t0, partialChars: pass1Text.length }));
      sse("error", { text: "Erreur de generation" });
      res.end();
    });

    await stream1.finalMessage();
    const t1 = Date.now();

    // === PASS 2: Critic (with keep-alive) ===
    sse("validating");
    const keepAlive = setInterval(() => { res.write(": keep-alive\n\n"); }, 5000);
    const verdict = await criticCheck(client, pass1Text, corrections);
    clearInterval(keepAlive);
    const t2 = Date.now();
    const knowledgeLog = { detected: detectedPages, count: detectedPages.length };

    if (verdict.pass) {
      sse("done");
      res.end();
      const t3 = Date.now();
      console.log(JSON.stringify({ event: "chat_complete", ts: new Date().toISOString(), scenario, totalMs: t3 - t0, pass1: { ms: t1 - t0 }, critic: { ms: t2 - t1, pass: true, violations: [], error: verdict.error || false }, pass3: { triggered: false, ms: 0 }, knowledge: knowledgeLog }));
      return;
    }

    // === PASS 3: Rewrite ===
    sse("rewriting");
    sse("clear");

    const violationFeedback = verdict.violations.join("\n- ");
    const stream3 = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        ...trimmedMessages,
        { role: "assistant", content: pass1Text },
        { role: "user", content: "SYSTEME INTERNE — AUTOCRITIQUE :\nTon message precedent viole ces regles apprises :\n- " + violationFeedback + "\n\nReecris ton message en corrigeant ces violations. Garde le meme intent et la meme longueur.\nReponds UNIQUEMENT avec le message corrige, rien d'autre." },
      ],
    });

    stream3.on("text", (text) => { sse("delta", { text }); });
    stream3.on("end", () => {
      sse("done");
      res.end();
      const t3 = Date.now();
      console.log(JSON.stringify({ event: "chat_complete", ts: new Date().toISOString(), scenario, totalMs: t3 - t0, pass1: { ms: t1 - t0 }, critic: { ms: t2 - t1, pass: false, violations: verdict.violations, error: false }, pass3: { triggered: true, ms: t3 - t2 }, knowledge: knowledgeLog }));
    });
    stream3.on("error", (err) => {
      console.log(JSON.stringify({ event: "chat_error", ts: new Date().toISOString(), scenario, error: err.message || "Stream error", failedAt: "pass3", elapsedMs: Date.now() - t0 }));
      sse("error", { text: "Erreur de generation" });
      res.end();
    });
  } catch (err) {
    const tErr = Date.now();
    console.log(JSON.stringify({ event: "chat_error", ts: new Date().toISOString(), scenario, error: err.message || "Unknown error", failedAt: "setup_or_critic", elapsedMs: tErr - t0 }));
    if (res.headersSent) { sse("error", { text: "Erreur de generation" }); res.end(); }
    else { res.status(500).json({ error: "Erreur serveur : " + err.message }); }
  }
}

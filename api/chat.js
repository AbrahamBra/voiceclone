import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";

const ACCESS_CODE = process.env.ACCESS_CODE;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" }); return; }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const rl = rateLimit(ip);
  if (!rl.allowed) { res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter }); return; }

  if (req.headers["x-access-code"] !== ACCESS_CODE) {
    res.status(403).json({ error: "Code d'acces invalide" });
    return;
  }

  const validationError = validateInput(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const { message, history, scenario } = req.body;
  const messages = [...history.slice(-19), { role: "user", content: message }];
  const { prompt: systemPrompt } = buildSystemPrompt(scenario, messages);

  const sse = initSSE(res);

  try {
    await runPipeline({ systemPrompt, messages, sse, res });
    res.end();
  } catch (err) {
    console.log(JSON.stringify({
      event: "chat_error", ts: new Date().toISOString(),
      scenario, error: err.message || "Unknown error",
    }));
    if (res.headersSent) {
      sse("error", { text: "Erreur de generation" });
      res.end();
    } else {
      res.status(500).json({ error: "Erreur serveur : " + err.message });
    }
  }
}

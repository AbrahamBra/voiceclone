import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ACCESS_CODE = process.env.ACCESS_CODE;
const PERSONA_ID = process.env.PERSONA || "alex";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured" }); return; }

  if (req.headers["x-access-code"] !== ACCESS_CODE) {
    res.status(403).json({ error: "Invalid access code" });
    return;
  }

  const { correction, botMessage, userMessage } = req.body || {};

  if (!correction || typeof correction !== "string" || correction.length < 3 || correction.length > 500) {
    res.status(400).json({ error: "correction must be a string of 3-500 chars" });
    return;
  }

  const correctionsPath = join(process.cwd(), "personas", PERSONA_ID, "corrections.md");

  try {
    let content = readFileSync(correctionsPath, "utf-8");

    const date = new Date().toISOString().split("T")[0];
    const context = userMessage ? `\n  - Contexte: user a dit "${userMessage.slice(0, 100)}"` : "";
    const response = botMessage ? `\n  - Reponse probleme: "${botMessage.slice(0, 150)}"` : "";

    const entry = `\n- **${date}** — ${correction}${context}${response}\n`;

    content += entry;
    writeFileSync(correctionsPath, content, "utf-8");

    res.json({ ok: true, message: "Correction enregistree" });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur: " + err.message });
  }
}

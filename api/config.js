import { getPersona } from "../lib/knowledge.js";

const ACCESS_CODE = process.env.ACCESS_CODE;

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" }); return; }

  if (req.headers["x-access-code"] !== ACCESS_CODE) {
    res.status(403).json({ error: "Invalid access code" });
    return;
  }

  const persona = getPersona();
  const scenarios = {};
  for (const [key, val] of Object.entries(persona.scenarios)) {
    scenarios[key] = {
      label: val.label,
      description: val.description.replace(/\{name\}/g, persona.name),
      welcome: val.welcome || null,
    };
  }

  res.json({
    name: persona.name,
    title: persona.title,
    avatar: persona.avatar,
    description: persona.description,
    scenarios,
    theme: persona.theme,
  });
}

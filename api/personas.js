import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ACCESS_CODE = process.env.ACCESS_CODE;

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured" }); return; }

  if (req.headers["x-access-code"] !== ACCESS_CODE) {
    res.status(403).json({ error: "Invalid access code" });
    return;
  }

  const personasDir = join(process.cwd(), "personas");
  const personas = [];

  try {
    for (const dir of readdirSync(personasDir)) {
      try {
        const p = JSON.parse(readFileSync(join(personasDir, dir, "persona.json"), "utf-8"));
        personas.push({
          id: dir,
          name: p.name,
          title: p.title,
          avatar: p.avatar,
        });
      } catch { /* skip dirs without persona.json */ }
    }
  } catch { /* personas dir doesn't exist */ }

  res.json({ personas });
}

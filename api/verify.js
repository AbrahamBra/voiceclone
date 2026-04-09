// ============================================================
// VERIFY — Lightweight access code validation (no Anthropic tokens)
// ============================================================

const ACCESS_CODE = process.env.ACCESS_CODE;

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!ACCESS_CODE) {
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  const code = req.headers["x-access-code"];
  if (code === ACCESS_CODE) {
    res.status(200).json({ valid: true });
  } else {
    res.status(403).json({ valid: false });
  }
}

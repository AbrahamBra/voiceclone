// Pure, idempotent sanitization for protocol_section.prose where kind='identity'.
// Targets corruption patterns observed in dumps from Notion :
//   - <aside>...</aside> wrapper tags around callout blocks
//   - Other Notion structural tags (<details>, <summary>, <caption>) — strip wrapper, keep text
//   - Mojibake : `?ￂﾠ` literal in place of NBSP, etc.
//   - Zero-width chars (BOM, ZWSP, ZWJ, ZWNJ)
//   - Excess blank lines (3+ collapsed to 2)
//   - Trailing whitespace per line
//
// Non-destructive : every textual content remains, only the noise is stripped.
// Idempotent : sanitize(sanitize(x)) === sanitize(x).

const NOTION_WRAPPER_TAGS = ["aside", "details", "summary", "caption"];
const ZERO_WIDTH = /[﻿​‌‍]/g;

// Common mojibake replacements observed in Notion exports.
const MOJIBAKE_MAP = [
  ["?ￂﾠ", " "], // 4-char "?ￂﾠ" literal — NBSP misdecoded
  ["Â ", " "],  // "Â " — UTF-8 NBSP read as latin-1
  ["Â ", " "],       // "Â " — same artifact, simpler form
  ["â€™", "'"],  // â€™ → '
  ["â€œ", "\""], // â€œ → "
  ["â€", "\""], // â€ → "
  ["â€“", "–"], // â€" → –
  ["â€”", "—"], // â€" → —
];

export function sanitizeIdentityProse(input) {
  if (typeof input !== "string") return "";
  let s = input;

  // 1. Strip Notion wrapper tags (keep inner content)
  for (const tag of NOTION_WRAPPER_TAGS) {
    const open = new RegExp(`<\\s*${tag}[^>]*>`, "gi");
    const close = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "gi");
    s = s.replace(open, "").replace(close, "");
  }

  // 2. Strip Notion icon img tags (e.g. <img src="/icons/no_orange.svg" alt="..." width="40px" />)
  s = s.replace(/<img\s[^>]*\/?>/gi, "");

  // 3. Mojibake replacements
  for (const [bad, good] of MOJIBAKE_MAP) {
    s = s.split(bad).join(good);
  }

  // 4. Zero-width chars
  s = s.replace(ZERO_WIDTH, "");

  // 5. Trim trailing whitespace per line
  s = s.split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n");

  // 6. Collapse 3+ blank lines to 2
  s = s.replace(/\n{3,}/g, "\n\n");

  // 7. Trim leading/trailing whitespace globally
  s = s.trim();

  return s;
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^---$/gm, "<hr>")
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)[.)]\s+(.+)$/gm, "<li>$2</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/▶/g, "&#9654;").replace(/→/g, "&#8594;")
    .replace(/\n/g, "<br>");
}

export function getRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "a l'instant";
  if (mins < 60) return "il y a " + mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "il y a " + hours + "h";
  const days = Math.floor(hours / 24);
  return "il y a " + days + "j";
}

// LinkedIn doesn't render markdown — but it accepts Unicode. Convert markdown
// emphasis to Unicode math-bold / math-italic, strip `---`, render lists with
// `• `. Preserves paragraph double-breaks. Plain/markdown export = straight copy.
const BOLD_MAP_LOWER = 0x1D41A - 97; // a
const BOLD_MAP_UPPER = 0x1D400 - 65; // A
const BOLD_MAP_DIGIT = 0x1D7CE - 48; // 0
const ITALIC_MAP_LOWER = 0x1D44E - 97;
const ITALIC_MAP_UPPER = 0x1D434 - 65;

function toUnicodeBold(s) {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code >= 97 && code <= 122) out += String.fromCodePoint(code + BOLD_MAP_LOWER);
    else if (code >= 65 && code <= 90) out += String.fromCodePoint(code + BOLD_MAP_UPPER);
    else if (code >= 48 && code <= 57) out += String.fromCodePoint(code + BOLD_MAP_DIGIT);
    else out += ch;
  }
  return out;
}

function toUnicodeItalic(s) {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0);
    // LinkedIn italic map: "h" (0x68) has no slot at 0x1D455 — replaced by Planck constant 0x210E.
    if (code === 104) out += "\u210E";
    else if (code >= 97 && code <= 122) out += String.fromCodePoint(code + ITALIC_MAP_LOWER);
    else if (code >= 65 && code <= 90) out += String.fromCodePoint(code + ITALIC_MAP_UPPER);
    else out += ch;
  }
  return out;
}

export function toLinkedIn(md) {
  if (!md) return "";
  return md
    .replace(/\*\*(.+?)\*\*/g, (_, inner) => toUnicodeBold(inner))
    .replace(/\*(.+?)\*/g, (_, inner) => toUnicodeItalic(inner))
    .replace(/^---+\s*$/gm, "")
    .replace(/^[-*•]\s+(.+)$/gm, "• $1")
    .replace(/^(\d+)[.)]\s+(.+)$/gm, "$1. $2");
}

export function groupByDate(items, dateField) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups = {
    "Aujourd'hui": [],
    "Hier": [],
    "Cette semaine": [],
    "Plus ancien": [],
  };

  for (const item of items) {
    const d = new Date(item[dateField]);
    if (d >= today) groups["Aujourd'hui"].push(item);
    else if (d >= yesterday) groups["Hier"].push(item);
    else if (d >= weekAgo) groups["Cette semaine"].push(item);
    else groups["Plus ancien"].push(item);
  }

  return groups;
}

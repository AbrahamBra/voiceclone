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
  if (mins < 60) return "il y a " + mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "il y a " + hours + "h";
  const days = Math.floor(hours / 24);
  return "il y a " + days + "j";
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

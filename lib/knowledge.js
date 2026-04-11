import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const PERSONA_DIR = join(process.cwd(), "persona");
const KNOWLEDGE_DIR = join(PERSONA_DIR, "knowledge");

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { keywords: [], body: content };
  const yaml = match[1];
  const keywordsMatch = yaml.match(/keywords:\s*\[(.*?)\]/);
  if (!keywordsMatch) return { keywords: [], body: content.slice(match[0].length).trim() };
  const keywords = keywordsMatch[1]
    .split(",")
    .map((k) => k.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
  return { keywords, body: content.slice(match[0].length).trim() };
}

function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findMarkdownFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) files.push(...findMarkdownFiles(fullPath));
      else if (entry.endsWith(".md")) files.push(fullPath);
    }
  } catch { /* dir doesn't exist */ }
  return files;
}

const keywordIndex = [];
for (const filePath of findMarkdownFiles(KNOWLEDGE_DIR)) {
  const raw = readFileSync(filePath, "utf-8");
  const { keywords, body } = parseFrontmatter(raw);
  if (keywords.length > 0) {
    keywordIndex.push({
      keywords: keywords.map(normalize),
      path: relative(PERSONA_DIR, filePath),
      content: body,
    });
  }
}

export function findRelevantKnowledge(messages) {
  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));
  const matched = [];
  for (const entry of keywordIndex) {
    if (entry.keywords.some((kw) => text.includes(kw))) {
      matched.push({ path: entry.path, content: entry.content });
    }
  }
  return matched;
}

export function loadPersonaFile(relativePath) {
  try { return readFileSync(join(PERSONA_DIR, relativePath), "utf-8"); }
  catch { return null; }
}

let _persona = null;
export function getPersona() {
  if (!_persona) _persona = JSON.parse(readFileSync(join(PERSONA_DIR, "persona.json"), "utf-8"));
  return _persona;
}

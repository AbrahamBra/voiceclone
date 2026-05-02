/**
 * Migration script: filesystem personas → Supabase
 * Run: node scripts/migrate-to-supabase.js
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

config(); // Load .env

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PERSONAS_DIR = join(process.cwd(), "personas");

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { keywords: [], body: content };
  const yaml = match[1];
  const kwMatch = yaml.match(/keywords:\s*\[(.*?)\]/);
  const keywords = kwMatch
    ? kwMatch[1].split(",").map(k => k.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];
  return { keywords, body: content.slice(match[0].length).trim() };
}

function findMdFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) files.push(...findMdFiles(fullPath));
      else if (entry.endsWith(".md") && entry !== "corrections.md") files.push(fullPath);
    }
  } catch { }
  return files;
}

async function createClients() {
  console.log("\n--- Creating client accounts ---");

  const clients = [
    { access_code: "paolo2026", name: "Paolo", tier: "free", max_clones: 2 },
    { access_code: "thomas2026", name: "Thomas", tier: "free", max_clones: 2 },
    { access_code: "victor2026", name: "Victor", tier: "free", max_clones: 2 },
  ];

  for (const c of clients) {
    const { data, error } = await supabase
      .from("clients")
      .upsert(c, { onConflict: "access_code" })
      .select()
      .single();

    if (error) console.log(`  ERROR ${c.name}: ${error.message}`);
    else console.log(`  Client ${c.name}: ${data.id} (code: ${c.access_code})`);
  }

  return clients;
}

async function migratePersona(personaDir, slug, clientId) {
  console.log(`\n--- Migrating persona: ${slug} ---`);

  // Read persona.json
  const personaJson = JSON.parse(readFileSync(join(personaDir, "persona.json"), "utf-8"));

  // Insert persona
  const { data: persona, error: pErr } = await supabase
    .from("personas")
    .upsert({
      slug,
      client_id: clientId,
      name: personaJson.name,
      title: personaJson.title || "",
      avatar: personaJson.avatar || slug.slice(0, 2).toUpperCase(),
      description: personaJson.description || "",
      voice: personaJson.voice,
      scenarios: personaJson.scenarios,
      theme: personaJson.theme,
    }, { onConflict: "client_id,slug" })
    .select()
    .single();

  if (pErr) { console.log(`  ERROR persona: ${pErr.message}`); return; }
  console.log(`  Persona: ${persona.id}`);

  // Migrate knowledge files
  const knowledgeDir = join(personaDir, "knowledge");
  const knowledgeFiles = findMdFiles(knowledgeDir);
  for (const filePath of knowledgeFiles) {
    const raw = readFileSync(filePath, "utf-8");
    const { keywords, body } = parseFrontmatter(raw);
    const relativePath = filePath.replace(personaDir + "\\", "").replace(personaDir + "/", "");

    const { error } = await supabase.from("knowledge_files").upsert({
      persona_id: persona.id,
      path: relativePath,
      keywords,
      content: body,
      source_type: "manual",
    }, { onConflict: "persona_id,path" });

    if (error) console.log(`  ERROR knowledge ${relativePath}: ${error.message}`);
    else console.log(`  Knowledge: ${relativePath} (${keywords.length} keywords)`);
  }

  // Migrate scenario files
  const scenariosDir = join(personaDir, "scenarios");
  try {
    for (const file of readdirSync(scenariosDir)) {
      if (!file.endsWith(".md")) continue;
      const slug2 = file.replace(".md", "");
      const content = readFileSync(join(scenariosDir, file), "utf-8");

      const { error } = await supabase.from("scenario_files").upsert({
        persona_id: persona.id,
        slug: slug2,
        content,
      }, { onConflict: "persona_id,slug" });

      if (error) console.log(`  ERROR scenario ${slug2}: ${error.message}`);
      else console.log(`  Scenario: ${slug2}`);
    }
  } catch { }

  return persona;
}

async function main() {
  console.log("VoiceClone Migration: Filesystem → Supabase\n");

  // Create client accounts
  await createClients();

  // Get client IDs
  const { data: paoloClient } = await supabase.from("clients").select("id").eq("access_code", "paolo2026").single();
  const { data: thomasClient } = await supabase.from("clients").select("id").eq("access_code", "thomas2026").single();
  const { data: victorClient } = await supabase.from("clients").select("id").eq("access_code", "victor2026").single();

  // Migrate each persona
  for (const dir of readdirSync(PERSONAS_DIR)) {
    const personaDir = join(PERSONAS_DIR, dir);
    if (!statSync(personaDir).isDirectory()) continue;
    try { readFileSync(join(personaDir, "persona.json")); } catch { continue; }

    let clientId = null;
    if (dir === "paolo") clientId = paoloClient?.id;
    else if (dir === "thomas") clientId = thomasClient?.id;
    else if (dir === "victor") clientId = victorClient?.id;
    // alex stays as platform persona (client_id = null)

    await migratePersona(personaDir, dir, clientId);
  }

  console.log("\n--- Migration complete ---");
}

main().catch(console.error);

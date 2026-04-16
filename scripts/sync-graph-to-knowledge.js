#!/usr/bin/env node
/**
 * Sync high-confidence graph entities → knowledge .md files.
 *
 * Reads knowledge_entities with confidence >= CONFIDENCE_THRESHOLD from Supabase,
 * groups them by type, and writes/updates:
 *   personas/[slug]/knowledge/topics/learned-patterns.md
 *
 * This makes learned patterns available to the RAG pipeline, not just
 * the token-limited ontology section of the system prompt.
 *
 * Usage:
 *   node scripts/sync-graph-to-knowledge.js
 *   node scripts/sync-graph-to-knowledge.js --persona thomas
 *   node scripts/sync-graph-to-knowledge.js --dry-run
 *   node scripts/sync-graph-to-knowledge.js --threshold 0.75
 */

import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DRY_RUN = process.argv.includes("--dry-run");
const PERSONA_FILTER = process.argv.includes("--persona")
  ? process.argv[process.argv.indexOf("--persona") + 1]
  : null;
const THRESHOLD_ARG = process.argv.includes("--threshold")
  ? parseFloat(process.argv[process.argv.indexOf("--threshold") + 1])
  : null;
const CONFIDENCE_THRESHOLD = THRESHOLD_ARG ?? 0.8;

const TYPE_LABELS = {
  style_rule: "Règles de style",
  belief: "Croyances & convictions",
  concept: "Concepts métier",
  framework: "Frameworks & méthodes",
  tool: "Outils",
  person: "Personnes",
  company: "Entreprises",
  metric: "Métriques",
};

async function run() {
  // 1. Load all personas (or the filtered one)
  let query = supabase.from("personas").select("id, slug, name");
  if (PERSONA_FILTER) query = query.eq("slug", PERSONA_FILTER);
  const { data: personas, error } = await query;

  if (error || !personas?.length) {
    console.error("No personas found:", error?.message);
    process.exit(1);
  }

  for (const persona of personas) {
    console.log(`\n── ${persona.name} (${persona.slug}) ──`);

    // 2. Load high-confidence entities
    const { data: entities, error: entErr } = await supabase
      .from("knowledge_entities")
      .select("name, type, description, confidence, last_matched_at")
      .eq("persona_id", persona.id)
      .gte("confidence", CONFIDENCE_THRESHOLD)
      .order("confidence", { ascending: false });

    if (entErr) { console.error("  Error loading entities:", entErr.message); continue; }
    if (!entities?.length) {
      console.log(`  No entities with confidence >= ${CONFIDENCE_THRESHOLD}`);
      continue;
    }

    console.log(`  ${entities.length} entities above threshold`);

    // 3. Group by type
    const grouped = {};
    for (const e of entities) {
      if (!grouped[e.type]) grouped[e.type] = [];
      grouped[e.type].push(e);
    }

    // 4. Build markdown content
    const now = new Date().toISOString().split("T")[0];
    let md = `# Patterns appris (sync auto — ${now})\n\n`;
    md += `> Généré depuis le knowledge graph. Entités avec confidence ≥ ${CONFIDENCE_THRESHOLD}.\n`;
    md += `> Ne pas éditer manuellement — relancer \`sync-graph-to-knowledge.js\` pour mettre à jour.\n\n`;

    for (const [type, items] of Object.entries(grouped)) {
      const label = TYPE_LABELS[type] || type;
      md += `## ${label}\n\n`;
      for (const e of items) {
        md += `- **${e.name}** (confiance: ${(e.confidence * 100).toFixed(0)}%)`;
        if (e.description) md += ` — ${e.description}`;
        md += "\n";
      }
      md += "\n";
    }

    // 5. Write file
    const personaDir = join("personas", persona.slug, "knowledge", "topics");
    const filePath = join(personaDir, "learned-patterns.md");

    if (DRY_RUN) {
      console.log(`  [dry-run] Would write ${filePath}`);
      console.log(md.slice(0, 300) + "...");
      continue;
    }

    if (!existsSync(personaDir)) mkdirSync(personaDir, { recursive: true });
    writeFileSync(filePath, md, "utf-8");
    console.log(`  Wrote ${filePath} (${entities.length} entities, ${md.length} chars)`);

    // 6. Upsert into Supabase knowledge_files so it gets re-embedded by the RAG pipeline
    const keywords = entities.slice(0, 20).map(e => e.name.toLowerCase());
    const { error: upsertErr } = await supabase
      .from("knowledge_files")
      .upsert(
        { persona_id: persona.id, path: filePath, content: md, keywords },
        { onConflict: "persona_id,path" }
      );

    if (upsertErr) {
      console.error("  Error upserting to knowledge_files:", upsertErr.message);
    } else {
      console.log(`  Upserted into knowledge_files (RAG will re-embed on next indexing run)`);
    }
  }

  console.log("\nDone.");
}

run().catch(err => { console.error(err); process.exit(1); });

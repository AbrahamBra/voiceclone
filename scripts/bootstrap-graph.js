#!/usr/bin/env node
/**
 * Bootstrap knowledge graph for ALL personas from their knowledge files + corrections.
 *
 * Reads each persona's:
 * - persona.json (voice rules → style_rule entities)
 * - knowledge/topics/*.md (domain knowledge → concept/framework/tool entities)
 * - existing corrections from DB (re-process with updated prompt)
 *
 * Usage: node scripts/bootstrap-graph.js [--dry-run] [--persona thomas]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DRY_RUN = process.argv.includes("--dry-run");
const PERSONA_FILTER = process.argv.includes("--persona")
  ? process.argv[process.argv.indexOf("--persona") + 1]
  : null;

const EXTRACTION_PROMPT = `Tu es un expert en extraction de connaissances pour un clone de voix IA.
Analyse ce contenu et extrais TOUTES les entites et relations utiles pour construire un graphe de connaissances.

Types d'entites : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

Pour les regles de voix (persona.json), extrais chaque regle comme style_rule :
- Mots interdits → une entite par mot/expression
- Expressions signatures → une entite par expression
- Regles d'ecriture → une entite par regle

Pour les fichiers knowledge, extrais :
- Concepts metier, frameworks, methodologies
- Personnes, entreprises, outils mentionnes
- Metriques et chiffres cles
- Croyances et convictions

Reponds en JSON :
{
  "entities": [{ "name": "...", "type": "...", "description": "..." }],
  "relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }]
}`;

async function extractFromText(text, context) {
  const result = await anthropic.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: EXTRACTION_PROMPT,
    messages: [{ role: "user", content: `Source : ${context}\n\nContenu :\n${text.slice(0, 4000)}` }],
  });

  const raw = result.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { entities: [], relations: [] };
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("  ⚠ JSON parse failed for", context);
    return { entities: [], relations: [] };
  }
}

async function processPersona(slug) {
  const personaPath = join("personas", slug, "persona.json");
  if (!existsSync(personaPath)) {
    console.log(`⚠ No persona.json for ${slug}, skipping`);
    return;
  }

  const persona = JSON.parse(readFileSync(personaPath, "utf-8"));
  console.log(`\n═══ ${persona.name || slug} ═══`);

  // Find persona ID in DB
  const { data: dbPersona } = await supabase
    .from("personas")
    .select("id, name")
    .eq("slug", slug)
    .single();

  if (!dbPersona) {
    console.log(`  ⚠ Persona "${slug}" not found in DB, skipping`);
    return;
  }

  const personaId = dbPersona.id;
  let allEntities = [];
  let allRelations = [];

  // 1. Extract from voice rules in persona.json
  console.log("  → Extracting from voice rules...");
  const voiceText = [
    persona.voice?.forbiddenWords?.length ? "Mots interdits : " + persona.voice.forbiddenWords.join(", ") : "",
    persona.voice?.writingRules?.length ? "Regles d'ecriture :\n" + persona.voice.writingRules.join("\n") : "",
    persona.voice?.signaturePhrases?.length ? "Expressions signatures : " + persona.voice.signaturePhrases.join(", ") : "",
    persona.voice?.neverDoes?.length ? "Ne fait jamais :\n" + persona.voice.neverDoes.join("\n") : "",
    persona.voice?.tone ? "Ton : " + persona.voice.tone.join(", ") : "",
  ].filter(Boolean).join("\n\n");

  if (voiceText.length > 20) {
    const voiceResult = await extractFromText(voiceText, `persona.json voice rules for ${persona.name}`);
    allEntities.push(...(voiceResult.entities || []));
    allRelations.push(...(voiceResult.relations || []));
    console.log(`    ${voiceResult.entities?.length || 0} entities, ${voiceResult.relations?.length || 0} relations`);
  }

  // 2. Extract from knowledge topic files
  const topicsDir = join("personas", slug, "knowledge", "topics");
  if (existsSync(topicsDir)) {
    const files = readdirSync(topicsDir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      console.log(`  → Extracting from ${file}...`);
      const content = readFileSync(join(topicsDir, file), "utf-8");
      if (content.trim().length < 20) continue;
      const result = await extractFromText(content, `knowledge file ${file} for ${persona.name}`);
      allEntities.push(...(result.entities || []));
      allRelations.push(...(result.relations || []));
      console.log(`    ${result.entities?.length || 0} entities, ${result.relations?.length || 0} relations`);
    }
  }

  // 3. Re-process existing corrections from DB
  const { data: corrections } = await supabase
    .from("corrections")
    .select("id, correction, user_message, bot_message")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (corrections?.length > 0) {
    console.log(`  → Re-processing ${corrections.length} corrections...`);
    // Batch corrections into groups of 5 to reduce API calls
    for (let i = 0; i < corrections.length; i += 5) {
      const batch = corrections.slice(i, i + 5);
      const batchText = batch.map((c, j) =>
        `Correction ${i + j + 1}: "${c.correction}"\nContexte bot: "${(c.bot_message || "").slice(0, 100)}"`
      ).join("\n\n");

      const result = await extractFromText(batchText, `corrections batch ${i / 5 + 1} for ${persona.name}`);
      allEntities.push(...(result.entities || []));
      allRelations.push(...(result.relations || []));
    }
    console.log(`    ${allEntities.length} total entities from corrections`);
  }

  // Deduplicate entities by name
  const entityMap = new Map();
  for (const e of allEntities) {
    const key = e.name?.toLowerCase().trim();
    if (!key) continue;
    if (!entityMap.has(key) || (e.description || "").length > (entityMap.get(key).description || "").length) {
      entityMap.set(key, e);
    }
  }
  const uniqueEntities = [...entityMap.values()];

  console.log(`\n  📊 Total: ${uniqueEntities.length} unique entities, ${allRelations.length} relations`);

  if (DRY_RUN) {
    console.log("\n  [DRY RUN] Would insert:");
    for (const e of uniqueEntities) {
      console.log(`    - ${e.type}: ${e.name} — ${(e.description || "").slice(0, 60)}`);
    }
    return;
  }

  // Insert entities
  if (uniqueEntities.length > 0) {
    const entityRows = uniqueEntities.map(e => ({
      persona_id: personaId,
      name: e.name,
      type: e.type || "concept",
      description: e.description || "",
      confidence: 0.9,
    }));

    const { data: inserted, error } = await supabase
      .from("knowledge_entities")
      .upsert(entityRows, { onConflict: "persona_id,name" })
      .select("id, name");

    if (error) {
      console.error("  ✗ Entity insert error:", error.message);
    } else {
      console.log(`  ✓ ${inserted?.length || 0} entities upserted`);
    }

    // Insert relations
    if (allRelations.length > 0 && inserted?.length > 0) {
      const { data: allDbEntities } = await supabase
        .from("knowledge_entities")
        .select("id, name")
        .eq("persona_id", personaId);

      const idMap = {};
      for (const e of (allDbEntities || [])) idMap[e.name.toLowerCase()] = e.id;

      const relationRows = allRelations
        .filter(r => r.from && r.to && idMap[r.from.toLowerCase()] && idMap[r.to.toLowerCase()])
        .map(r => ({
          persona_id: personaId,
          from_entity_id: idMap[r.from.toLowerCase()],
          to_entity_id: idMap[r.to.toLowerCase()],
          relation_type: r.type || "uses",
          description: r.description || "",
          confidence: 0.85,
        }));

      if (relationRows.length > 0) {
        const { error: relError } = await supabase
          .from("knowledge_relations")
          .insert(relationRows);
        if (relError) {
          console.error("  ✗ Relation insert error:", relError.message);
        } else {
          console.log(`  ✓ ${relationRows.length} relations inserted`);
        }
      }
    }
  }
}

async function main() {
  console.log("🧠 Knowledge Graph Bootstrap");
  console.log(DRY_RUN ? "  Mode: DRY RUN (no writes)" : "  Mode: LIVE");
  if (PERSONA_FILTER) console.log(`  Filter: ${PERSONA_FILTER} only`);
  console.log("");

  const slugs = readdirSync("personas").filter(d => {
    if (PERSONA_FILTER && d !== PERSONA_FILTER) return false;
    return existsSync(join("personas", d, "persona.json"));
  });

  console.log(`Found ${slugs.length} persona(s): ${slugs.join(", ")}`);

  for (const slug of slugs) {
    await processPersona(slug);
  }

  console.log("\n✅ Done!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

/**
 * Extract ontology (entities + relations) for existing personas.
 * Run: node scripts/extract-ontology.js
 */

import { config } from "dotenv"; config();
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ONTOLOGY_PROMPT = `Tu es un expert en extraction de connaissances et en ontologie.
Analyse ces posts et ce profil. Extrais les ENTITES et RELATIONS cles qui definissent la pensee de cette personne.

Types d'entites : concept, framework, person, company, metric, belief, tool
Types de relations : equals (A = B), includes (A contient B), contradicts (A s'oppose a B), causes (A provoque B), uses (A utilise B), prerequisite (A necessite B)

Reponds UNIQUEMENT en JSON valide :
{
  "entities": [
    { "name": "nom", "type": "concept|framework|...", "description": "description courte" }
  ],
  "relations": [
    { "from": "nom source", "to": "nom cible", "type": "equals|includes|...", "description": "explication" }
  ]
}

Sois precis. Extrais 15-30 entites et 10-20 relations. Les entites doivent refleter les concepts UNIQUES de cette personne.`;

async function extractOntology(personaId, personaName) {
  console.log(`\n=== Extracting ontology for ${personaName} (${personaId}) ===`);

  // Get knowledge files for context
  const { data: knowledge } = await supabase
    .from("knowledge_files")
    .select("content")
    .eq("persona_id", personaId);

  const { data: persona } = await supabase
    .from("personas")
    .select("name, title, description, voice")
    .eq("id", personaId)
    .single();

  if (!persona) { console.log("  Persona not found"); return; }

  const content = [
    `PROFIL: ${persona.name} - ${persona.title}`,
    persona.description,
    "",
    "CONTENU ET STYLE:",
    ...(knowledge || []).map(k => k.content.slice(0, 2000)),
  ].join("\n");

  console.log(`  Input: ${content.length} chars`);

  const result = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: ONTOLOGY_PROMPT,
    messages: [{ role: "user", content }],
  });

  const raw = result.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { console.log("  Failed to parse JSON"); return; }

  const ontology = JSON.parse(jsonMatch[0]);
  console.log(`  Entities: ${ontology.entities?.length || 0}`);
  console.log(`  Relations: ${ontology.relations?.length || 0}`);

  // Insert entities
  if (ontology.entities?.length > 0) {
    const entityRows = ontology.entities.map(e => ({
      persona_id: personaId,
      name: e.name,
      type: e.type || "concept",
      description: e.description || "",
      confidence: 1.0,
    }));

    const { data: inserted, error } = await supabase
      .from("knowledge_entities")
      .upsert(entityRows, { onConflict: "persona_id,name" })
      .select("id, name");

    if (error) { console.log(`  Entity insert error: ${error.message}`); return; }
    console.log(`  Inserted ${inserted.length} entities`);

    // Insert relations
    if (inserted && ontology.relations?.length > 0) {
      const entityMap = {};
      for (const e of inserted) entityMap[e.name] = e.id;

      const relationRows = ontology.relations
        .filter(r => entityMap[r.from] && entityMap[r.to])
        .map(r => ({
          persona_id: personaId,
          from_entity_id: entityMap[r.from],
          to_entity_id: entityMap[r.to],
          relation_type: r.type || "uses",
          description: r.description || "",
          confidence: 1.0,
        }));

      if (relationRows.length > 0) {
        const { error: relErr } = await supabase.from("knowledge_relations").insert(relationRows);
        if (relErr) console.log(`  Relation insert error: ${relErr.message}`);
        else console.log(`  Inserted ${relationRows.length} relations`);
      } else {
        console.log(`  No valid relations (entity names didn't match)`);
      }
    }
  }

  console.log(`  Done for ${personaName}`);
}

async function main() {
  // Get all personas
  const { data: personas } = await supabase
    .from("personas")
    .select("id, name")
    .eq("is_active", true);

  for (const p of personas) {
    await extractOntology(p.id, p.name);
  }

  console.log("\n=== All done ===");
}

main().catch(console.error);

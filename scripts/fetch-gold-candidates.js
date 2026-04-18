#!/usr/bin/env node
/**
 * fetch-gold-candidates.js
 *
 * Étape 1/2 du seed gold automatique.
 *
 * Exporte les messages candidats vers data/rhythm-gold-candidates.json :
 *   - persona = argv[2] (slug, ex: "thomas")
 *   - role = 'assistant'
 *   - longueur ≥ MIN_WORDS mots
 *   - PAS déjà is_gold
 *   - PAS dans corrections.bot_message (exclut les messages explicitement corrigés par le user)
 *
 * Puis Claude lit le fichier, sélectionne ~25 meilleurs par cohérence interne,
 * émet une liste d'IDs, et apply-gold-ids.js pose is_gold=true.
 *
 * Usage :
 *   node scripts/fetch-gold-candidates.js thomas
 *   node scripts/fetch-gold-candidates.js thomas --limit 150 --min-words 15
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { extractDraft } from "../lib/critic/extractDraft.js";

const personaSlug = process.argv[2];
if (!personaSlug) {
  console.error("Usage: node scripts/fetch-gold-candidates.js <persona-slug> [--limit N] [--min-words N]");
  process.exit(1);
}

const flag = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const LIMIT = parseInt(flag("--limit", "120"), 10);
const MIN_WORDS = parseInt(flag("--min-words", "12"), 10);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const normalize = s => (s || "").trim().replace(/\s+/g, " ");

async function main() {
  // Plusieurs personas peuvent partager le même name/slug (par client). On les agrège.
  const { data: personas, error: pErr } = await supabase
    .from("personas").select("id, name, slug, client_id")
    .or(`name.ilike.${personaSlug},slug.ilike.${personaSlug}`);
  if (pErr) throw pErr;
  if (!personas?.length) throw new Error(`Persona "${personaSlug}" introuvable`);
  console.log(`Personas matchés : ${personas.map(p => `${p.name}[${p.slug}]`).join(", ")}`);
  const personaIds = personas.map(p => p.id);

  const { data: convs, error: cErr } = await supabase
    .from("conversations").select("id").in("persona_id", personaIds);
  if (cErr) throw cErr;
  if (!convs?.length) { console.log("Aucune conversation."); return; }
  const convIds = convs.map(c => c.id);

  const { data: corrections, error: corrErr } = await supabase
    .from("corrections").select("bot_message").in("persona_id", personaIds);
  if (corrErr) throw corrErr;
  const antiGold = new Set((corrections || []).map(c => normalize(c.bot_message)).filter(Boolean));

  const { data: msgs, error: mErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, is_gold")
    .in("conversation_id", convIds)
    .eq("role", "assistant")
    .eq("is_gold", false)
    .order("created_at", { ascending: false })
    .limit(LIMIT * 3);
  if (mErr) throw mErr;

  const candidates = (msgs || [])
    .filter(m => !antiGold.has(normalize(m.content)))
    .map(m => {
      const extracted = extractDraft(m.content);
      const wordsInExtracted = (extracted.match(/\S+/g) || []).length;
      return {
        id: m.id,
        conversation_id: m.conversation_id,
        created_at: m.created_at,
        content: m.content,
        extracted,
        words_extracted: wordsInExtracted,
      };
    })
    .filter(c => c.words_extracted >= MIN_WORDS)
    .slice(0, LIMIT);

  if (!existsSync("data")) mkdirSync("data");
  const outPath = "data/rhythm-gold-candidates.json";
  const payload = {
    personas,
    generated_at: new Date().toISOString(),
    filters: { min_words: MIN_WORDS, limit: LIMIT, anti_gold_excluded: antiGold.size },
    count: candidates.length,
    candidates,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\n✓ ${candidates.length} candidats exportés → ${outPath}`);
  console.log(`  personas: ${personas.map(p => p.name).join(", ")}`);
  console.log(`  exclus (anti-gold via corrections): ${antiGold.size}`);
  console.log(`\nÉtape suivante: Claude lit le fichier, sélectionne, puis apply-gold-ids.js pose is_gold.`);
}

main().catch(err => { console.error(err); process.exit(1); });

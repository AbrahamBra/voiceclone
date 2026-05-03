#!/usr/bin/env node
/**
 * apply-gold-ids.js
 *
 * Étape 2/2 du seed gold automatique.
 *
 * Lit data/rhythm-gold-selected.json (produit par Claude après lecture
 * de rhythm-gold-candidates.json) et pose is_gold=true sur les IDs listés.
 *
 * Format attendu :
 *   { "persona": { "id": "uuid", "name": "Thomas" },
 *     "ids": ["uuid1", "uuid2", ...],
 *     "rationale": "optional note" }
 *
 * Usage :
 *   node scripts/apply-gold-ids.js
 *   node scripts/apply-gold-ids.js --dry-run
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";

const DRY_RUN = process.argv.includes("--dry-run");
const INPUT = "data/rhythm-gold-selected.json";

if (!existsSync(INPUT)) {
  console.error(`Fichier ${INPUT} introuvable. Claude doit le produire d'abord.`);
  process.exit(1);
}

const payload = JSON.parse(readFileSync(INPUT, "utf8"));
if (!Array.isArray(payload.ids) || !payload.ids.length) {
  console.error("Pas d'IDs dans le fichier.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log(`${payload.ids.length} IDs à marquer gold pour persona ${payload.persona?.name || "?"}`);
  if (payload.rationale) console.log(`Rationale: ${payload.rationale}`);

  if (DRY_RUN) {
    console.log("--dry-run : aucune écriture.");
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .update({ is_gold: true })
    .in("id", payload.ids)
    .select("id");

  if (error) throw error;
  console.log(`✓ ${data?.length || 0} messages marqués is_gold=true`);
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
/**
 * reseed-post-scenarios.js
 *
 * Re-seed ciblé pour les 3 personas (victor, paolo, thomas) après l'audit
 * scénarios post du 2026-04-22. Met à jour :
 *
 *   1. scenario_files.content  (slug='post')  ← depuis personas/<slug>/scenarios/post.md
 *   2. personas.scenarios.post.welcome        ← depuis personas/<slug>/persona.json
 *
 * Ne touche PAS : knowledge_files, corrections, autres scenarios (qualification,
 * default), voice, theme. Pas d'écrasement du reste.
 *
 * Usage :
 *   node scripts/reseed-post-scenarios.js         # dry-run (affiche le diff, ne touche rien)
 *   node scripts/reseed-post-scenarios.js --apply # applique les updates
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FAIL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents du .env");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PERSONAS_DIR = join(process.cwd(), "personas");

const TARGETS = [
  { slug: "victor",  access_code: "victor2026" },
  { slug: "paolo",   access_code: "paolo2026"  },
  { slug: "thomas",  access_code: "thomas2026" },
];

function log(...a) { console.log("[reseed]", ...a); }
function fail(msg) { console.error("[reseed] FAIL:", msg); process.exit(1); }

async function findPersonaId(target) {
  const { data: cli, error: ce } = await supabase
    .from("clients").select("id").eq("access_code", target.access_code).maybeSingle();
  if (ce) fail(`clients fetch (${target.slug}): ${ce.message}`);
  if (!cli) fail(`client introuvable pour access_code=${target.access_code}`);

  const { data: p, error: pe } = await supabase
    .from("personas").select("id, scenarios")
    .eq("client_id", cli.id).eq("slug", target.slug).maybeSingle();
  if (pe) fail(`personas fetch (${target.slug}): ${pe.message}`);
  if (!p) fail(`persona ${target.slug} absent pour client ${target.access_code}`);
  return p;
}

async function processPersona(target) {
  log(`\n--- ${target.slug} ---`);

  const personaDir = join(PERSONAS_DIR, target.slug);
  const scenarioContent = readFileSync(join(personaDir, "scenarios", "post.md"), "utf-8");
  const personaJson = JSON.parse(readFileSync(join(personaDir, "persona.json"), "utf-8"));
  const newWelcome = personaJson.scenarios?.post?.welcome;
  if (!newWelcome) fail(`welcome manquant dans ${target.slug}/persona.json scenarios.post`);

  const p = await findPersonaId(target);
  log(`persona_id = ${p.id}`);

  // 1. scenario_files (slug='post')
  const { data: existingSf } = await supabase
    .from("scenario_files").select("content")
    .eq("persona_id", p.id).eq("slug", "post").maybeSingle();

  const scenarioNeedsUpdate = !existingSf || existingSf.content !== scenarioContent;
  if (scenarioNeedsUpdate) {
    log(`scenario_files.post : ${existingSf ? "CONTENU DIFFÉRENT" : "absent"} → update`);
    if (APPLY) {
      const { error } = await supabase.from("scenario_files").upsert(
        { persona_id: p.id, slug: "post", content: scenarioContent },
        { onConflict: "persona_id,slug" }
      );
      if (error) fail(`scenario_files upsert (${target.slug}): ${error.message}`);
      log("scenario_files.post : OK");
    }
  } else {
    log("scenario_files.post : déjà à jour");
  }

  // 2. personas.scenarios.post.welcome
  const currentWelcome = p.scenarios?.post?.welcome;
  if (currentWelcome !== newWelcome) {
    log(`personas.scenarios.post.welcome : "${currentWelcome?.slice(0, 50) || "(absent)"}" → "${newWelcome.slice(0, 50)}"`);
    if (APPLY) {
      const updatedScenarios = {
        ...p.scenarios,
        post: { ...(p.scenarios?.post || {}), welcome: newWelcome },
      };
      const { error } = await supabase
        .from("personas").update({ scenarios: updatedScenarios }).eq("id", p.id);
      if (error) fail(`personas update (${target.slug}): ${error.message}`);
      log("personas.scenarios : OK");
    }
  } else {
    log("personas.scenarios.post.welcome : déjà à jour");
  }
}

(async () => {
  log(APPLY ? "MODE APPLY — les updates seront écrits" : "MODE DRY-RUN — ajoute --apply pour écrire");
  for (const t of TARGETS) await processPersona(t);
  log("\nTerminé.");
})().catch(e => fail(e.message));

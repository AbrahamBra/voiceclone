#!/usr/bin/env node
/**
 * seed-rhythm-gold.js
 *
 * CLI de tagging : parcourt les messages assistant d'une persona, les présente
 * un par un sans score ni contexte, et laisse l'humain marquer is_gold=true
 * sur les exemples qui incarnent le bon rythme.
 *
 * Objectif : seed initial du corpus distributionnel persona (20-30 msgs suffisent
 * pour stabiliser une covariance Mahalanobis sur le vecteur Signal B).
 *
 * Usage :
 *   node scripts/seed-rhythm-gold.js thomas
 *   node scripts/seed-rhythm-gold.js thomas --limit 80 --min-words 15
 *
 * Flags :
 *   --limit N       : nombre de candidats à tirer (défaut 60)
 *   --min-words N   : longueur minimale en mots pour être candidat (défaut 10)
 *   --clients ...   : noms séparés par virgule (restreint aux conv de ces clients, insensible à la casse)
 *
 * Clavier :
 *   g  marquer gold
 *   s  skip
 *   b  afficher à nouveau le message précédent (pas d'undo, juste lecture)
 *   q  quitter
 */

import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";
import readline from "readline";

const personaSlug = process.argv[2];
if (!personaSlug) {
  console.error("Usage: node scripts/seed-rhythm-gold.js <persona-slug> [--limit N] [--min-words N] [--clients a@x,b@y]");
  process.exit(1);
}

const flag = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const LIMIT = parseInt(flag("--limit", "60"), 10);
const MIN_WORDS = parseInt(flag("--min-words", "10"), 10);
const CLIENT_NAMES = (flag("--clients", "") || "").split(",").map(s => s.trim()).filter(Boolean);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function resolvePersonaId(slug) {
  const { data, error } = await supabase
    .from("personas")
    .select("id, name")
    .ilike("name", slug)
    .limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error(`Persona "${slug}" introuvable`);
  return data[0];
}

async function fetchCandidates(personaId) {
  let convQuery = supabase.from("conversations").select("id, client_id").eq("persona_id", personaId);

  if (CLIENT_NAMES.length) {
    const orFilter = CLIENT_NAMES.map(n => `name.ilike.${n}`).join(",");
    const { data: clients, error: cErr } = await supabase
      .from("clients").select("id, name").or(orFilter);
    if (cErr) throw cErr;
    if (!clients?.length) throw new Error("Aucun client matchant --clients");
    console.log(`Clients résolus : ${clients.map(c => c.name).join(", ")}`);
    convQuery = convQuery.in("client_id", clients.map(c => c.id));
  }

  const { data: convs, error: convErr } = await convQuery;
  if (convErr) throw convErr;
  if (!convs?.length) return [];

  const convIds = convs.map(c => c.id);

  // assistant, pas encore gold, pas trop court
  const { data: msgs, error: mErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, is_gold")
    .in("conversation_id", convIds)
    .eq("role", "assistant")
    .eq("is_gold", false)
    .order("created_at", { ascending: false })
    .limit(LIMIT * 4);
  if (mErr) throw mErr;

  const filtered = (msgs || []).filter(m => {
    const w = (m.content.match(/\S+/g) || []).length;
    return w >= MIN_WORDS;
  });

  // shuffle pour éviter un biais temporel
  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }

  return filtered.slice(0, LIMIT);
}

async function markGold(id) {
  const { error } = await supabase.from("messages").update({ is_gold: true }).eq("id", id);
  if (error) throw error;
}

function prompt(rl, q) {
  return new Promise(res => rl.question(q, ans => res(ans.trim().toLowerCase())));
}

function render(m, i, total) {
  const dash = "─".repeat(60);
  console.log("\n" + dash);
  console.log(`[${i + 1}/${total}]  ${new Date(m.created_at).toISOString().slice(0, 16).replace("T", " ")}`);
  console.log(dash);
  console.log(m.content);
  console.log(dash);
}

async function main() {
  const persona = await resolvePersonaId(personaSlug);
  console.log(`\nPersona : ${persona.name} (${persona.id})`);
  if (CLIENT_NAMES.length) console.log(`Filtre clients : ${CLIENT_NAMES.join(", ")}`);

  const candidates = await fetchCandidates(persona.id);
  if (!candidates.length) {
    console.log("Aucun candidat trouvé.");
    return;
  }
  console.log(`${candidates.length} candidats à évaluer.\n`);
  console.log("Raccourcis : g=gold  s=skip  b=re-display  q=quit\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let gold = 0, skipped = 0, last = null;

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    render(m, i, candidates.length);

    while (true) {
      const ans = await prompt(rl, "→ ");
      if (ans === "g") {
        await markGold(m.id);
        gold++;
        console.log(`✓ gold (${gold})`);
        last = m;
        break;
      } else if (ans === "s" || ans === "") {
        skipped++;
        last = m;
        break;
      } else if (ans === "b" && last) {
        render(last, i - 1, candidates.length);
      } else if (ans === "q") {
        rl.close();
        console.log(`\nStop. ${gold} marqués gold, ${skipped} skip sur ${i} vus.`);
        return;
      } else {
        console.log("g=gold  s=skip  b=re-display  q=quit");
      }
    }
  }

  rl.close();
  console.log(`\nFini. ${gold} marqués gold, ${skipped} skip sur ${candidates.length}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

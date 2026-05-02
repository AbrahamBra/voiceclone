#!/usr/bin/env node
/**
 * One-shot : générer le narrative changelog d'ImmoStates depuis les
 * 10 propositions acceptées, sans passer par le UI (qui n'a pas de bouton publish).
 *
 * Usage : node scripts/generate-narrative-immostates.js
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ override: true });

const PERSONA_ID = "32047cda-77cf-466b-899d-27d151a487a4"; // ImmoStates / thierry-brahim

async function main() {
  // Dynamic imports AFTER dotenv to avoid ESM hoisting issues
  const { createClient } = await import("@supabase/supabase-js");
  const { generateNarrative } = await import("../lib/protocol-v2-changelog-narrator.js");

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: docs } = await supabase
    .from("protocol_document").select("id, version")
    .eq("owner_id", PERSONA_ID).eq("status", "active").limit(1);
  if (!docs?.length) { console.error("No active doc for ImmoStates"); process.exit(1); }
  const docId = docs[0].id;

  const { data: props } = await supabase
    .from("proposition")
    .select("id, status, intent, target_kind, proposed_text, rationale")
    .eq("document_id", docId)
    .in("status", ["accepted", "rejected", "revised"]);

  const accepted = (props || []).filter(p => p.status === "accepted");
  const rejected = (props || []).filter(p => p.status === "rejected");
  const revised  = (props || []).filter(p => p.status === "revised");

  console.log(`Generating narrative — ${accepted.length} accepted, ${rejected.length} rejected, ${revised.length} revised`);

  const result = await generateNarrative({
    accepted, rejected, revised,
    personaName: "ImmoStates (Thierry-Brahim)",
    fromVersion: 1,
    toVersion: 2,
  });

  console.log("\n========== NARRATIVE (full changelog) ==========\n");
  console.log(result.narrative || "(empty)");
  console.log("\n========== BRIEF (notification) ==========\n");
  console.log(result.brief || "(empty)");
  if (result.error) console.error("\nError:", result.error);
}

main().catch(e => { console.error(e); process.exit(1); });

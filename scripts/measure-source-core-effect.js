#!/usr/bin/env node
/**
 * Measurement script — diff system_prompt assembly with vs without source_core.
 *
 * Read-only against the live DB. Loads Nicolas's persona, then calls
 * getActiveArtifactsForPersona twice (with and without sourceCore=visite_profil)
 * and prints what's new + the resulting prompt block sizes.
 *
 * Usage : node --env-file=<path-to-.env> scripts/measure-source-core-effect.js
 */

import { createClient } from "@supabase/supabase-js";
import { getActiveArtifactsForPersona, getActiveDocument, getActivePlaybookForSource } from "../lib/protocol-v2-db.js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Find Nicolas
const { data: nicolas, error: nErr } = await sb
  .from("personas")
  .select("id, name, slug")
  .eq("slug", "nicolas-lavall-e")
  .maybeSingle();
if (nErr || !nicolas) {
  console.error("Nicolas introuvable:", nErr);
  process.exit(1);
}
console.log(`Persona: ${nicolas.name} (id=${nicolas.id})`);

// Show docs available
const globalDoc = await getActiveDocument(sb, nicolas.id);
const playbookDoc = await getActivePlaybookForSource(sb, nicolas.id, "visite_profil");
console.log("\n── Active docs for this persona ──");
console.log(`Global  : ${globalDoc ? `id=${globalDoc.id}, source_core=${globalDoc.source_core}, version=${globalDoc.version}` : "NONE"}`);
console.log(`Playbook: ${playbookDoc ? `id=${playbookDoc.id}, source_core=${playbookDoc.source_core}, version=${playbookDoc.version}, parent=${playbookDoc.parent_template_id}` : "NONE"}`);

// Without source_core (legacy)
const artsGlobal = await getActiveArtifactsForPersona(sb, nicolas.id);
// With source_core (new)
const artsWithPlaybook = await getActiveArtifactsForPersona(sb, nicolas.id, { sourceCore: "visite_profil" });

const globalIds = new Set(artsGlobal.map(a => a.id));
const playbookOnly = artsWithPlaybook.filter(a => !globalIds.has(a.id));

console.log("\n── Counts ──");
console.log(`Without source_core : ${artsGlobal.length} artifacts (global doc only)`);
console.log(`With  source_core   : ${artsWithPlaybook.length} artifacts (global + playbook)`);
console.log(`Delta (playbook-only): ${playbookOnly.length}`);

console.log("\n── Playbook artifacts (only injected when source_core=visite_profil) ──");
for (const a of playbookOnly) {
  const sevTag = a.severity === "hard" ? "[!]" : a.severity === "strong" ? "[~]" : "[-]";
  const text = a?.content?.text || "(no text)";
  console.log(`${sevTag} (${a.kind}) ${text.slice(0, 130).replace(/\n/g, " / ")}${text.length > 130 ? "…" : ""}`);
}

// Approximate token count delta on the prompt block (as buildSystemPrompt would render it).
function tokenEstimate(text) { return Math.ceil((text || "").length / 4); }
let bytesGlobal = 0, bytesWithPb = 0;
for (const a of artsGlobal) bytesGlobal += (a?.content?.text?.length || 0);
for (const a of artsWithPlaybook) bytesWithPb += (a?.content?.text?.length || 0);

console.log("\n── Approx token impact on system_prompt ──");
console.log(`Without source_core : ~${tokenEstimate(" ".repeat(bytesGlobal))} tokens of artifacts text`);
console.log(`With  source_core   : ~${tokenEstimate(" ".repeat(bytesWithPb))} tokens of artifacts text`);
console.log(`Delta added by playbook: ~${tokenEstimate(" ".repeat(bytesWithPb - bytesGlobal))} tokens`);
console.log(`(Note: PROTOCOL_TOKEN_BUDGET=400 in lib/prompt.js may truncate; firsts in created_at DESC win.)`);

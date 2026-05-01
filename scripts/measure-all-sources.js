#!/usr/bin/env node
/**
 * Diagnose post-seed : pour chaque source_core chez Nicolas, mesure
 * combien d'artifacts seraient injectés dans le system_prompt par
 * getActiveArtifactsForPersona, et affiche un échantillon. Catch les bugs
 * d'assemblage (loader, multi-section spyer, parent_template inheritance).
 *
 * Read-only — pas d'écriture.
 */

import { createClient } from "@supabase/supabase-js";
import {
  getActiveDocument,
  getActivePlaybookForSource,
  getActiveArtifactsForPersona,
} from "../lib/protocol-v2-db.js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SOURCES = ["visite_profil", "dr_recue", "interaction_contenu", "premier_degre", "spyer", "sales_nav"];

const { data: nicolas } = await sb
  .from("personas").select("id, name").eq("slug", "nicolas-lavall-e").maybeSingle();
if (!nicolas) { console.error("Nicolas introuvable"); process.exit(1); }
console.log(`Persona: ${nicolas.name} (${nicolas.id})\n`);

// Global doc baseline.
const globalDoc = await getActiveDocument(sb, nicolas.id);
console.log(`── Global doc ──`);
console.log(`  ${globalDoc ? `id=${globalDoc.id} v${globalDoc.version}` : "(absent)"}\n`);

// Per-source breakdown.
console.log(`── Source playbooks (Nicolas) ──`);
for (const src of SOURCES) {
  const playbook = await getActivePlaybookForSource(sb, nicolas.id, src);
  if (!playbook) {
    console.log(`  ${src.padEnd(22)} → (absent)`);
    continue;
  }
  // Sections + artifact count for this doc.
  const { data: sections } = await sb
    .from("protocol_section").select("id, order, heading").eq("document_id", playbook.id).order("order", { ascending: true });
  const sectionIds = (sections || []).map((s) => s.id);
  const { data: artifacts } = sectionIds.length > 0
    ? await sb.from("protocol_artifact").select("id, severity").in("source_section_id", sectionIds).eq("is_active", true)
    : { data: [] };

  const sevCount = { hard: 0, strong: 0, light: 0 };
  for (const a of artifacts || []) sevCount[a.severity] = (sevCount[a.severity] || 0) + 1;

  console.log(`  ${src.padEnd(22)} → doc=${playbook.id.slice(0, 8)}… v${playbook.version}, ${sections?.length || 0} sections, ${artifacts?.length || 0} artifacts (hard:${sevCount.hard} strong:${sevCount.strong} light:${sevCount.light})${playbook.parent_template_id ? `, parent_template=${playbook.parent_template_id.slice(0, 8)}…` : ""}`);
  for (const s of sections || []) {
    console.log(`      [${s.order}] ${s.heading}`);
  }
}

// Now : the actual injection — call getActiveArtifactsForPersona per source
// (mirrors what api/chat.js does). This validates the loader + parent_template
// walking + multi-section aggregation.
console.log(`\n── System prompt assembly per source (top-level injection) ──`);
const baseline = await getActiveArtifactsForPersona(sb, nicolas.id);
console.log(`  baseline (no source_core)        → ${baseline.length} artifacts`);
for (const src of SOURCES) {
  const arts = await getActiveArtifactsForPersona(sb, nicolas.id, { sourceCore: src, limit: 200 });
  const delta = arts.length - baseline.length;
  console.log(`  source_core=${src.padEnd(22)} → ${arts.length} artifacts (+${delta} vs baseline)`);
}

// Sample : show 3 artifacts from spyer to verify multi-section content is mixed in.
console.log(`\n── Échantillon spyer (3 artifacts) ──`);
const spyerArts = await getActiveArtifactsForPersona(sb, nicolas.id, { sourceCore: "spyer", limit: 200 });
const sample = spyerArts.slice(0, 3);
for (const a of sample) {
  const text = (a.content?.text || "").slice(0, 130);
  console.log(`  [${a.severity}] ${text}${(a.content?.text || "").length > 130 ? "…" : ""}`);
}

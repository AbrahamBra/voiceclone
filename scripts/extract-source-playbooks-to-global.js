// Backfill : extract chaque playbook source-specific d'un persona en
// propositions sur le doc protocole global, avec dédup sémantique
// (embedding Voyage + cosine ≥ SEMANTIC_DEDUP_THRESHOLD) et provenance
// taggée (source_core + toggle_idx + toggle_title + playbook_id).
//
// Pourquoi : aujourd'hui les playbooks source-specific (visite_profil,
// dr_recue, interaction_contenu, etc.) sont cloisonnés. 80%+ du contenu
// est doctrine commune (qualif/SWOT, règles d'or, persona buyer,
// métaprompt) qui devrait nourrir le protocole. Cf migration 070.
//
// Usage :
//   node --env-file=.env.local scripts/extract-source-playbooks-to-global.js [--persona=<slug-or-id>] [--apply] [--source=<source_core>]
//
//   --persona      Default = 'nicolas-lavall-e'. Accepte slug ou uuid.
//   --apply        Default = dry-run (compte les candidates, pas d'INSERT).
//   --source       Filtre sur un source_core (ex --source=visite_profil).
//                  Default = tous les playbooks actifs.
//
// Exécutable plusieurs fois sans risque : la dédup sémantique merge
// intelligemment, et le merge append au champ provenance.playbook_sources
// au lieu de dupliquer.

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { extractPlaybookToPropositions } from "../lib/playbook-to-propositions.js";
import { parsePlaybookProse } from "../lib/playbook-parser.js";
import {
  embedForProposition,
  findSimilarProposition,
  SEMANTIC_DEDUP_THRESHOLD,
} from "../lib/protocol-v2-embeddings.js";

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1] || "nicolas-lavall-e";
const sourceFilter = args.find((a) => a.startsWith("--source="))?.split("=")[1] || null;
const APPLY = args.includes("--apply");
const MIN_CONFIDENCE_INSERT = 0.5; // mirror import-doc.js

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
// ANTHROPIC_API_KEY + VOYAGE_API_KEY checked best-effort (warned, not fatal).
// extractFromChunk returns [] on missing ANTHROPIC ; embedForProposition
// returns [] on missing VOYAGE. Both let the script run and surface counts
// of skipped candidates rather than crashing — useful when running from a
// sandboxed env that masks LLM keys (e.g. Claude Code subprocess).
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠ Missing ANTHROPIC_API_KEY — extraction returnera 0 candidates (skip Sonnet).");
}
if (!process.env.VOYAGE_API_KEY) {
  console.warn("⚠ Missing VOYAGE_API_KEY — embed retournera [] (skip dédup, skip insert).");
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`=== Backfill playbook → global proto (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);
console.log(`Persona  : ${personaArg}`);
console.log(`Source   : ${sourceFilter || "(all)"}`);
console.log("");

// 1) Resolve persona
const isUuid = /^[0-9a-f]{8}-/.test(personaArg);
const personaQ = sb.from("personas").select("id, name, slug");
const { data: persona } = isUuid
  ? await personaQ.eq("id", personaArg).maybeSingle()
  : await personaQ.eq("slug", personaArg).maybeSingle();
if (!persona) {
  console.error(`✗ Persona '${personaArg}' introuvable`);
  process.exit(1);
}
console.log(`✓ Persona  : ${persona.name} (${persona.slug}) — ${persona.id}`);

// 2) Resolve global doc
const { data: globalDoc } = await sb
  .from("protocol_document")
  .select("id, version")
  .eq("owner_kind", "persona")
  .eq("owner_id", persona.id)
  .eq("status", "active")
  .is("source_core", null)
  .maybeSingle();
if (!globalDoc) {
  console.error(`✗ Pas de doc global actif pour ce persona — bootstrap d'abord (cf scripts/bootstrap-protocol-doc-existing.js)`);
  process.exit(1);
}
console.log(`✓ Global doc: ${globalDoc.id} (v${globalDoc.version})`);

// 3) List source-specific playbooks
let playbooksQ = sb
  .from("protocol_document")
  .select("id, source_core, version")
  .eq("owner_kind", "persona")
  .eq("owner_id", persona.id)
  .eq("status", "active")
  .not("source_core", "is", null);
if (sourceFilter) playbooksQ = playbooksQ.eq("source_core", sourceFilter);
const { data: playbooks } = await playbooksQ.order("source_core");

if (!playbooks || playbooks.length === 0) {
  console.error(`✗ Aucun playbook source-specific actif`);
  process.exit(0);
}
console.log(`✓ ${playbooks.length} playbook(s) à traiter:\n`);
for (const p of playbooks) console.log(`    ${p.source_core} → ${p.id.slice(0, 8)}`);
console.log("");

// 4) Pour chaque playbook : load sections, concat prose, extract toggle-by-toggle
const summary = {
  playbooks_processed: 0,
  toggles_total: 0,
  candidates_total: 0,
  inserts: 0,
  merges: 0,
  low_conf_skipped: 0,
  embed_errors: 0,
  insert_errors: 0,
};

for (const pb of playbooks) {
  console.log(`── ${pb.source_core} (${pb.id.slice(0, 8)}) ──`);
  const { data: sections } = await sb
    .from("protocol_section")
    .select("prose, \"order\"")
    .eq("document_id", pb.id)
    .order("order", { ascending: true });
  const prose = (sections || []).map((s) => s.prose || "").join("\n\n");
  if (!prose.trim()) {
    console.log(`  (prose vide, skip)`);
    continue;
  }
  // Pre-parse pour visibilité (le helper le refait, coût négligeable)
  const preParsed = parsePlaybookProse(prose);
  const toggleSizes = preParsed.toggles.map((t) => `T${t.idx}=${t.prose.length}`).join(", ");
  console.log(`  prose : ${prose.length} chars — ${preParsed.toggles.length} toggles parsés (${toggleSizes})`);
  if (!preParsed.parsed) console.log(`  ⚠ parser n'a pas trouvé de structure ## N. — fallback sur prose entière`);

  console.log(`  → extraction toggle par toggle (Sonnet)...`);
  const t0 = Date.now();
  let candidates;
  try {
    candidates = await extractPlaybookToPropositions(
      { prose, sourceCore: pb.source_core, playbookId: pb.id, docFilename: `playbook:${pb.source_core}` },
      { onSkip: (s) => console.log(`    skip toggle ${s.toggle_idx} (${s.reason}, ${s.prose_len} chars)`) }
    );
  } catch (err) {
    console.log(`  ✗ extraction échouée: ${err.message}`);
    continue;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${candidates.length} candidates extraits en ${dt}s`);
  summary.playbooks_processed++;
  summary.candidates_total += candidates.length;

  // Compte les toggles uniques touchés (info)
  const togglesSeen = new Set(candidates.map((c) => c.provenance.toggle_idx));
  summary.toggles_total += togglesSeen.size;

  if (!APPLY) {
    // En dry-run on s'arrête au comptage des candidats
    console.log(`    (dry-run : pas d'embed ni d'insert)`);
    continue;
  }

  // 5) Pour chaque candidate : embed → findSimilar sur global → merge ou insert
  for (const cand of candidates) {
    const proposal = cand.proposal;
    const text = (proposal?.proposed_text || "").trim();
    if (!text) continue;

    let embedding;
    try {
      embedding = await embedForProposition(text);
    } catch (err) {
      summary.embed_errors++;
      console.log(`    embed err: ${err.message}`);
      continue;
    }
    if (!Array.isArray(embedding) || embedding.length === 0) {
      summary.embed_errors++;
      continue;
    }

    const similar = await findSimilarProposition(sb, {
      documentId: globalDoc.id,
      embedding,
      targetKind: cand.target_kind,
      threshold: SEMANTIC_DEDUP_THRESHOLD,
      limit: 1,
    });

    if (similar.length > 0) {
      // Merge : append cette source au provenance.playbook_sources existant.
      // 1) Lire la prov actuelle (jsonb)
      const top = similar[0];
      const { data: existingRow } = await sb
        .from("proposition")
        .select("provenance, source_refs, count")
        .eq("id", top.id)
        .maybeSingle();
      const prevProv = existingRow?.provenance || {};
      const prevSources = Array.isArray(prevProv.playbook_sources) ? prevProv.playbook_sources : [];
      // Évite double append du même playbook (script idempotent)
      const alreadyHas = prevSources.some(
        (s) => s.playbook_id === cand.provenance.playbook_id && s.toggle_idx === cand.provenance.toggle_idx
      );
      if (alreadyHas) {
        // déjà comptée — ne rien faire
        summary.merges++;
        continue;
      }
      const newSources = [...prevSources, cand.provenance];
      const newCount = (existingRow?.count || 1) + 1;
      const { error: mergeErr } = await sb
        .from("proposition")
        .update({
          provenance: { ...prevProv, playbook_sources: newSources },
          count: newCount,
        })
        .eq("id", top.id);
      if (mergeErr) {
        summary.insert_errors++;
        console.log(`    merge err: ${mergeErr.message}`);
      } else {
        summary.merges++;
      }
      continue;
    }

    // Insert nouvelle proposition avec provenance initiale
    if (typeof proposal.confidence !== "number" || proposal.confidence < MIN_CONFIDENCE_INSERT) {
      summary.low_conf_skipped++;
      continue;
    }
    const insertRow = {
      id: crypto.randomUUID(),
      document_id: globalDoc.id,
      source: "playbook_extraction",
      source_ref: null,
      source_refs: [],
      count: 1,
      intent: proposal.intent,
      target_kind: cand.target_kind,
      proposed_text: text,
      rationale: proposal.rationale || null,
      confidence: proposal.confidence,
      embedding,
      embedding_model: "voyage-3",
      status: "pending",
      provenance: { playbook_sources: [cand.provenance] },
    };
    const { error: insErr } = await sb.from("proposition").insert(insertRow);
    if (insErr) {
      summary.insert_errors++;
      console.log(`    insert err: ${insErr.message} (target_kind=${cand.target_kind}, intent=${proposal.intent})`);
    } else {
      summary.inserts++;
    }
  }

  console.log(`  ✓ ${pb.source_core} traité`);
  console.log("");
}

// 6) Résumé
console.log("=== Résumé ===");
console.log(`Playbooks traités       : ${summary.playbooks_processed}`);
console.log(`Toggles uniques (sum)   : ${summary.toggles_total}`);
console.log(`Candidates extraites    : ${summary.candidates_total}`);
if (APPLY) {
  console.log(`Inserts                 : ${summary.inserts}`);
  console.log(`Merges (provenance ⊕)   : ${summary.merges}`);
  console.log(`Low-conf skipped        : ${summary.low_conf_skipped}`);
  console.log(`Embed errors            : ${summary.embed_errors}`);
  console.log(`Insert errors           : ${summary.insert_errors}`);
} else {
  console.log(`(dry-run — re-run avec --apply pour persister)`);
}
console.log("");
console.log("✓ done");

#!/usr/bin/env node
/**
 * Seed Nicolas's missing source-playbooks (premier_degre + spyer with 5
 * instances) from the markdown content under scripts/data/nicolas-playbooks/.
 *
 * Inserts protocol_document + protocol_section rows only. Proposition
 * extraction is delegated to scripts/extract-source-playbooks-to-global.js
 * which uses the toggle-aware playbook-parser → playbook-to-propositions
 * pipeline (with semantic dedup against the global protocol).
 *
 * For spyer : creates 1 doc with 1 "common" section (order 0) + 5 instance
 * sections (orders 1..5), one per influencer.
 *
 * Idempotent : skips if active doc already exists for that source_core
 * (use --force to archive existing first).
 *
 * Usage :
 *   node --env-file=.env scripts/seed-nicolas-premier-degre-spyer.js [--dry-run] [--force]
 *
 * Then to extract → propositions :
 *   node --env-file=.env scripts/extract-source-playbooks-to-global.js \
 *     --persona=nicolas-lavall-e --apply
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "nicolas-playbooks");
const NICOLAS_SLUG = "nicolas-lavall-e";

const SPECS = [
  {
    source_core: "premier_degre",
    multi: false,
    sections: [
      { file: "premier_degre.md", heading: "Playbook réseau 1er degré — demande de mise en relation" },
    ],
  },
  {
    source_core: "spyer",
    multi: true,
    sections: [
      { file: "spyer-common.md",          heading: "Spyer — règles communes (toutes instances)" },
      { file: "spyer-alec-henry.md",      heading: "Instance — Spyer Alec Henry" },
      { file: "spyer-nina-ramen.md",      heading: "Instance — Spyer Nina Ramen" },
      { file: "spyer-margo-cunego.md",    heading: "Instance — Spyer Margo Cunego" },
      { file: "spyer-franck-nicolas.md",  heading: "Instance — Spyer Franck Nicolas" },
      { file: "spyer-max-piccinini.md",   heading: "Instance — Spyer Max Piccinini" },
    ],
  },
];

async function readSection(file) {
  const fullPath = path.join(DATA_DIR, file);
  const prose = await fs.readFile(fullPath, "utf8");
  return prose.trim();
}

async function findActiveDoc(sb, personaId, sourceCore) {
  const { data } = await sb
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .eq("source_core", sourceCore)
    .maybeSingle();
  return data || null;
}

async function archiveDoc(sb, docId) {
  await sb.from("protocol_document").update({ status: "archived" }).eq("id", docId);
}

async function insertSection({ sb, documentId, order, heading, prose, dryRun }) {
  const sectionId = crypto.randomUUID();
  if (dryRun) return { section_id: sectionId, prose_len: prose.length };

  const { error } = await sb.from("protocol_section").insert({
    id: sectionId,
    document_id: documentId,
    order,
    kind: "custom",
    heading,
    prose,
    structured: null,
    client_visible: false,
    client_editable: false,
    author_kind: "user",
  });
  if (error) throw new Error(`section insert failed: ${error.message}`);
  return { section_id: sectionId, prose_len: prose.length };
}

async function seedSourceCore(sb, personaId, spec, { dryRun, force }) {
  const existing = await findActiveDoc(sb, personaId, spec.source_core);
  if (existing) {
    if (!force) {
      console.log(`✓ ${spec.source_core} already active (id=${existing.id.slice(0,8)}) → skip`);
      return null;
    }
    console.log(`⚠ archiving existing ${spec.source_core} doc id=${existing.id.slice(0,8)} (--force)`);
    if (!dryRun) await archiveDoc(sb, existing.id);
  }

  const documentId = crypto.randomUUID();
  const now = new Date().toISOString();
  if (!dryRun) {
    const { error: docErr } = await sb.from("protocol_document").insert({
      id: documentId,
      owner_kind: "persona",
      owner_id: personaId,
      version: 1,
      status: "active",
      source_core: spec.source_core,
      created_at: now,
      updated_at: now,
    });
    if (docErr) throw new Error(`doc insert (${spec.source_core}): ${docErr.message}`);
  }

  console.log(`\n── ${spec.source_core} (doc id=${documentId.slice(0,8)}${dryRun ? " [dry]" : ""}) ──`);

  const sectionResults = [];
  for (let i = 0; i < spec.sections.length; i++) {
    const sec = spec.sections[i];
    const prose = await readSection(sec.file);
    const result = await insertSection({ sb, documentId, order: i, heading: sec.heading, prose, dryRun });
    console.log(`  + section[${i}] "${sec.heading}" (${result.prose_len} chars)`);
    sectionResults.push(result);
  }

  return { document_id: documentId, sections: sectionResults };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env");
    process.exit(1);
  }
  const sb = createClient(url, key);

  const { data: nicolas, error: nErr } = await sb
    .from("personas").select("id, slug, name").eq("slug", NICOLAS_SLUG).maybeSingle();
  if (nErr || !nicolas) {
    console.error(`Persona slug=${NICOLAS_SLUG} not found`);
    process.exit(1);
  }
  console.log(`Persona: ${nicolas.name} (${nicolas.id})${dryRun ? "  [DRY-RUN]" : ""}${force ? "  [FORCE]" : ""}`);

  const summary = [];
  for (const spec of SPECS) {
    try {
      const result = await seedSourceCore(sb, nicolas.id, spec, { dryRun, force });
      if (result) {
        const totalChars = result.sections.reduce((n, s) => n + s.prose_len, 0);
        summary.push(`${spec.source_core}: ${result.sections.length} sections, ${totalChars} chars total`);
      } else {
        summary.push(`${spec.source_core}: skipped (already active)`);
      }
    } catch (err) {
      summary.push(`${spec.source_core}: ERROR ${err.message}`);
      console.error(`✗ ${spec.source_core}:`, err);
    }
  }

  console.log("\n── Résumé ──");
  for (const line of summary) console.log("  " + line);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

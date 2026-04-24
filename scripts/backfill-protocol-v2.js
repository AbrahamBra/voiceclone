// Migrates existing `operating_protocols` + `protocol_hard_rules` into the
// new protocol v2 model (protocol_document + section hard_rules + artifacts).
//
// Idempotent: re-running does not duplicate anything (content_hash dedup).
// CLI: node scripts/backfill-protocol-v2.js [--dry-run] [--persona=<id>]

import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const FALLBACK_PROSE =
  "Règles héritées du protocole v1. " +
  "Upload un playbook complet pour activer les sections patterns/scoring/process.";

/**
 * Stable hash on rule SEMANTICS (not label).
 * Includes: check_kind, check_params (canonical JSON), severity, sorted scenarios.
 */
export function computeContentHash(rule) {
  const canonical = {
    check_kind: rule.check_kind,
    check_params: canonicalJson(rule.check_params || {}),
    severity: rule.severity || "hard",
    scenarios: [...(rule.applies_to_scenarios || [])].sort(),
  };
  const str = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(str).digest("hex");
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(canonicalJson);
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = canonicalJson(obj[k]);
  return out;
}

/**
 * Builds the insert plan for ONE `operating_protocols` row.
 * Pure function — no I/O, testable.
 *
 * @param protocol        operating_protocols row including .rules (hard_rules joined)
 * @param existingHashes  Set<string> of content_hash already present in v2 for this persona
 * @returns { document, sections, artifacts }
 */
export function buildBackfillPlan(protocol, existingHashes) {
  const documentId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();

  const document = {
    id: documentId,
    owner_kind: "persona",
    owner_id: protocol.persona_id,
    version: protocol.version || 1,
    status: protocol.is_active ? "active" : "archived",
    created_at: new Date().toISOString(),
  };

  const section = {
    id: sectionId,
    document_id: documentId,
    order: 0,
    kind: "hard_rules",
    heading: "Règles absolues",
    prose: protocol.raw_document || FALLBACK_PROSE,
    structured: null,
    author_kind: "auto_extraction",
  };

  const artifacts = [];
  for (const rule of (protocol.rules || [])) {
    const hash = computeContentHash(rule);
    if (existingHashes.has(hash)) continue;
    artifacts.push({
      id: crypto.randomUUID(),
      source_section_id: sectionId,
      source_quote: rule.source_quote || null,
      kind: "hard_check",
      content: {
        check_kind: rule.check_kind,
        check_params: rule.check_params || {},
      },
      severity: rule.severity || "hard",
      scenarios: rule.applies_to_scenarios || null,
      is_active: true,
      is_manual_override: false,
      content_hash: hash,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
    });
  }

  return { document, sections: [section], artifacts };
}

// ── CLI runner ───────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const personaFilter = args.find(a => a.startsWith("--persona="))?.split("=")[1];

  const { supabase } = await import("../lib/supabase.js");

  let q = supabase
    .from("operating_protocols")
    .select("id, persona_id, version, is_active, raw_document, protocol_hard_rules(*)");
  if (personaFilter) q = q.eq("persona_id", personaFilter);
  const { data: protocols, error } = await q;
  if (error) { console.error(error); process.exit(1); }

  let stats = { personas: 0, documents: 0, sections: 0, artifacts: 0, skipped: 0 };
  for (const p of protocols) {
    const protocol = { ...p, rules: p.protocol_hard_rules || [] };

    // Load hashes already present for this persona (cross-protocol idempotence).
    const { data: existing } = await supabase
      .from("protocol_artifact")
      .select("content_hash, protocol_section!inner(document_id, protocol_document!inner(owner_id))")
      .eq("protocol_section.protocol_document.owner_id", p.persona_id);
    const existingHashes = new Set((existing || []).map(r => r.content_hash));

    const plan = buildBackfillPlan(protocol, existingHashes);
    if (plan.artifacts.length === 0 && existingHashes.size > 0) {
      stats.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry] persona=${p.persona_id} doc_v${plan.document.version} +${plan.artifacts.length} artifacts`);
      continue;
    }

    await supabase.from("protocol_document").insert(plan.document);
    await supabase.from("protocol_section").insert(plan.sections);
    if (plan.artifacts.length > 0) {
      await supabase.from("protocol_artifact").insert(plan.artifacts);
    }
    stats.personas++;
    stats.documents++;
    stats.sections += plan.sections.length;
    stats.artifacts += plan.artifacts.length;
  }

  console.log("Backfill done:", stats);
}

// Run only if called directly (not when imported in tests).
// pathToFileURL handles Windows (file:///C:/...) and POSIX (file:///home/...) uniformly.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}

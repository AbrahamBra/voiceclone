// Backfill : re-embed pending propositions where embedding IS NULL.
//
// Cause : api/v2/protocol/import-doc.js + scripts/feedback-event-to-proposition.js
// passaient un array JS brut à supabase-js qui stockait NULL silencieusement.
// Fix dans le code : JSON.stringify(embedding). Reste à embedder les rows
// historiques pour qu'elles soient visibles à findSimilarProposition + au
// scan contradictions.
//
// Note : dotenv config DOIT happen avant l'import dynamique de lib/embeddings.js
// car ce module capture VOYAGE_API_KEY au module load time. Sans override:true
// avant import, le shell env "" (set par le harness) écrase la valeur du .env.
//
// Usage : node scripts/backfill-proposition-embeddings.js [--apply] [--persona <slug>]

import dotenv from "dotenv";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env", override: true });

const apply = process.argv.includes("--apply");
const personaArgIdx = process.argv.indexOf("--persona");
const personaSlug = personaArgIdx >= 0 ? process.argv[personaArgIdx + 1] : null;
const SLEEP_MS = 220;

// Dynamic imports AFTER dotenv override so VOYAGE_API_KEY is captured correctly.
const { createClient } = await import("@supabase/supabase-js");
const { embedForProposition } = await import("../lib/protocol-v2-embeddings.js");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`=== Backfill proposition embeddings (${apply ? "APPLY" : "DRY-RUN"})${personaSlug ? ` persona=${personaSlug}` : ""} ===\n`);
console.log(`VOYAGE_API_KEY loaded: ${process.env.VOYAGE_API_KEY ? "yes" : "NO — bail"}`);
if (!process.env.VOYAGE_API_KEY) process.exit(2);

let docIds = null;
if (personaSlug) {
  const { data: persona } = await sb.from("personas").select("id").eq("slug", personaSlug).single();
  if (!persona) { console.error(`persona not found: ${personaSlug}`); process.exit(1); }
  const { data: docs } = await sb.from("protocol_document").select("id").eq("owner_kind","persona").eq("owner_id", persona.id);
  docIds = (docs || []).map((d) => d.id);
}

let q = sb.from("proposition")
  .select("id, proposed_text, target_kind, document_id, created_at")
  .is("embedding", null)
  .eq("status", "pending");
if (docIds) q = q.in("document_id", docIds);

const { data: targets, error } = await q;
if (error) { console.error("query failed:", error.message); process.exit(2); }

console.log(`Pending propositions with NULL embedding: ${targets?.length || 0}`);
if (!targets || targets.length === 0) { console.log("Rien à faire."); process.exit(0); }

if (!apply) {
  console.log("(dry-run) re-embed + UPDATE skipped. Re-run with --apply.");
  process.exit(0);
}

let ok = 0, fail = 0;
for (let i = 0; i < targets.length; i++) {
  const p = targets[i];
  let embedding;
  try {
    embedding = await embedForProposition(p.proposed_text);
  } catch (err) {
    console.error(`  ✗ ${p.id.slice(0,8)} embed: ${err.message}`);
    fail++;
    if (i < targets.length - 1) await sleep(SLEEP_MS);
    continue;
  }

  if (!Array.isArray(embedding) || embedding.length === 0) {
    console.error(`  ✗ ${p.id.slice(0,8)} embed returned null/empty`);
    fail++;
    if (i < targets.length - 1) await sleep(SLEEP_MS);
    continue;
  }

  const { error: updErr } = await sb.from("proposition")
    .update({ embedding: JSON.stringify(embedding) })
    .eq("id", p.id);
  if (updErr) {
    console.error(`  ✗ ${p.id.slice(0,8)} UPDATE: ${updErr.message}`);
    fail++;
  } else {
    ok++;
    if (ok % 20 === 0 || ok === targets.length) {
      console.log(`  ${i+1}/${targets.length}  ok=${ok}  fail=${fail}`);
    }
  }
  if (i < targets.length - 1) await sleep(SLEEP_MS);
}

console.log(`\n=== SUMMARY ===`);
console.log(`embedded ok : ${ok}`);
console.log(`failed      : ${fail}`);

// Inventaire des propositions Nicolas pour mesurer recall import-doc actuel.
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: nicolas } = await sb.from("personas").select("id").eq("slug", "nicolas-lavall-e").single();

const { data: docs } = await sb.from("protocol_document")
  .select("id, status, version, source_core, created_at, updated_at")
  .eq("owner_kind", "persona").eq("owner_id", nicolas.id)
  .order("created_at", { ascending: false });
console.log("=== protocol_document Nicolas ===");
for (const d of docs) console.log(`  ${d.status.padEnd(8)} v${d.version}  src=${d.source_core || "GLOBAL"}  ${d.created_at}  id=${d.id}`);

const docIds = docs.map(d => d.id);
const { data: props } = await sb.from("proposition")
  .select("id, document_id, target_kind, intent, proposed_text, source, source_ref, status, confidence, created_at")
  .in("document_id", docIds)
  .order("created_at", { ascending: false });

console.log(`\n=== propositions Nicolas (${props.length} total) ===`);
const byStatus = {};
const bySource = {};
const byTarget = {};
for (const p of props) {
  byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  bySource[p.source] = (bySource[p.source] || 0) + 1;
  byTarget[p.target_kind] = (byTarget[p.target_kind] || 0) + 1;
}
console.log("by status :", byStatus);
console.log("by source :", bySource);
console.log("by target :", byTarget);

// Recent propositions sample
console.log("\n=== 10 most recent propositions ===");
for (const p of props.slice(0, 10)) {
  const text = (p.proposed_text || "").slice(0, 80).replace(/\n/g, " ");
  console.log(`  ${p.status.padEnd(10)} ${p.target_kind.padEnd(15)} ${p.source.padEnd(15)} c=${p.confidence}  "${text}"`);
}

// import_batch tracking
const { data: batches } = await sb.from("protocol_import_batch")
  .select("id, document_id, doc_filename, doc_kind, chunks_processed, candidates_total, propositions_created, propositions_merged, silenced, created_at")
  .in("document_id", docIds)
  .order("created_at", { ascending: false });
console.log(`\n=== import_batch Nicolas (${batches?.length || 0}) ===`);
for (const b of batches || []) {
  console.log(`  ${b.created_at}  ${b.doc_filename || "?"}  kind=${b.doc_kind || "?"}`);
  console.log(`    chunks=${b.chunks_processed}  candidates=${b.candidates_total}  created=${b.propositions_created}  merged=${b.propositions_merged}  silenced=${b.silenced}`);
}

// chunks Nicolas final
const { count: chunksCount } = await sb.from("chunks")
  .select("*", { count: "exact", head: true })
  .eq("persona_id", nicolas.id);
console.log(`\n=== chunks Nicolas total : ${chunksCount} ===`);

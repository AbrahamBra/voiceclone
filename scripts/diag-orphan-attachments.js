// For each orphan persona, count attached rows (conversations, protocols,
// shares, keys, knowledge_chunks, corrections) to inform the cleanup decision:
//   - 0 attachments everywhere → safe hard-delete
//   - any attachment → rename slug (avoid collision) and patch client_id
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const TABLES = [
  "conversations",
  "operating_protocols",
  "persona_shares",
  "persona_api_keys",
  "knowledge_chunks",
  "corrections",
  "feedback_events",
  "business_outcomes",
  "protocol_document",
];

async function countFor(table, personaId) {
  const ownerCol = table === "protocol_document" ? "owner_id" : "persona_id";
  const { count, error } = await supabase
    .from(table).select("id", { count: "exact", head: true }).eq(ownerCol, personaId);
  if (error) return `ERR(${error.code})`;
  return count;
}

async function main() {
  if (!supabase) { console.error("env missing"); process.exit(1); }

  const { data: orphans } = await supabase
    .from("personas").select("id, slug, name, is_active, created_at")
    .is("client_id", null).order("is_active", { ascending: false }).order("created_at", { ascending: false });

  console.log(`orphans: ${orphans?.length || 0}\n`);
  for (const p of orphans || []) {
    const counts = {};
    for (const t of TABLES) counts[t] = await countFor(t, p.id);
    const total = Object.values(counts).filter(n => typeof n === "number").reduce((a, b) => a + b, 0);
    console.log(`${p.is_active ? "active  " : "inactive"}  ${p.slug.padEnd(18)}  ${p.id.slice(0, 8)}  total=${total}`);
    for (const [t, n] of Object.entries(counts)) if (n) console.log(`    ${t}: ${n}`);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });

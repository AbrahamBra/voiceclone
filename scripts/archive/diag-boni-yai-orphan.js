// Read-only diag : find out why persona boni-yai has client_id=null,
// surface candidate owners (conversations, operating_protocols, shares).
//
// Run from main repo root so .env.local is loaded:
//   cd ../../.. && node .claude/worktrees/flamboyant-poincare-853f25/scripts/diag-boni-yai-orphan.js
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

async function main() {
  if (!supabase) {
    console.error("Supabase not configured. Run from a directory whose .env(.local) has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const { data: persona } = await supabase
    .from("personas")
    .select("*")
    .eq("slug", "boni-yai")
    .single();

  if (!persona) {
    console.log("persona slug=boni-yai → NOT FOUND");
    process.exit(0);
  }

  console.log("=== persona boni-yai ===");
  console.log({
    id: persona.id,
    name: persona.name,
    slug: persona.slug,
    client_id: persona.client_id,
    is_active: persona.is_active,
    created_at: persona.created_at,
    type: persona.type,
  });

  // 1. Conversations attached to this persona — who created them?
  const { data: convs } = await supabase
    .from("conversations")
    .select("id, client_id, created_at, lifecycle_state")
    .eq("persona_id", persona.id)
    .order("created_at", { ascending: false })
    .limit(20);
  console.log(`\n=== conversations (${convs?.length || 0}) ===`);
  for (const c of convs || []) {
    console.log(`  ${c.created_at?.slice(0, 10)} client=${c.client_id?.slice(0, 8)} state=${c.lifecycle_state}`);
  }

  // 2. Aggregate distinct client_ids across conversations
  if (convs?.length) {
    const counts = {};
    for (const c of convs) counts[c.client_id] = (counts[c.client_id] || 0) + 1;
    console.log("\n=== client_id distribution across conversations ===");
    for (const [cid, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const { data: client } = await supabase.from("clients").select("id, name, access_code").eq("id", cid).single();
      console.log(`  ${cid?.slice(0, 8)} → ${n} convs   name=${client?.name}  access_code=${client?.access_code?.slice(0, 12)}…`);
    }
  }

  // 3. Operating protocols — who uploaded them?
  const { data: ops } = await supabase
    .from("operating_protocols")
    .select("id, version, is_active, created_by, created_at")
    .eq("persona_id", persona.id);
  console.log(`\n=== operating_protocols (${ops?.length || 0}) ===`);
  for (const o of ops || []) {
    console.log(`  v${o.version} active=${o.is_active} created_by=${o.created_by?.slice(0, 8) || "—"} created=${o.created_at?.slice(0, 10)}`);
  }

  // 4. Persona shares
  const { data: shares } = await supabase
    .from("persona_shares")
    .select("client_id, granted_at")
    .eq("persona_id", persona.id);
  console.log(`\n=== persona_shares (${shares?.length || 0}) ===`);
  for (const s of shares || []) {
    const { data: client } = await supabase.from("clients").select("name, access_code").eq("id", s.client_id).single();
    console.log(`  client=${s.client_id?.slice(0, 8)} name=${client?.name} granted=${s.granted_at?.slice(0, 10)}`);
  }

  // 5. API keys minted against this persona
  const { data: keys } = await supabase
    .from("persona_api_keys")
    .select("label, created_by, revoked_at, created_at")
    .eq("persona_id", persona.id);
  console.log(`\n=== persona_api_keys (${keys?.length || 0}) ===`);
  for (const k of keys || []) {
    console.log(`  label="${k.label}" created_by=${k.created_by?.slice(0, 8)} revoked=${k.revoked_at ? "yes" : "no"} created=${k.created_at?.slice(0, 10)}`);
  }

  console.log("\n=== recommendation ===");
  console.log("Pick the client_id with the most conversations / who uploaded the operating_protocol.");
  console.log("Patch via:");
  console.log(`  UPDATE personas SET client_id = '<chosen>' WHERE id = '${persona.id}';`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});

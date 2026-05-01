// Read-only diag : list ALL personas with client_id=null + the admin client_id
// to use as owner fallback. Surfaces the broader scope of the boni-yai issue.
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

async function main() {
  if (!supabase) { console.error("env missing"); process.exit(1); }

  const { data: admin } = await supabase
    .from("clients")
    .select("id, name, access_code")
    .eq("access_code", "__admin__")
    .single();
  console.log("=== admin client ===");
  console.log({ id: admin?.id, name: admin?.name });

  const { data: orphans } = await supabase
    .from("personas")
    .select("id, slug, name, client_id, is_active, created_at")
    .is("client_id", null)
    .order("created_at", { ascending: false });
  console.log(`\n=== personas with client_id=null (${orphans?.length || 0}) ===`);
  for (const p of orphans || []) {
    console.log(`  active=${p.is_active}  ${p.slug.padEnd(20)}  ${p.name.padEnd(25)}  created=${p.created_at?.slice(0, 10)}  id=${p.id.slice(0, 8)}`);
  }

  const { count: totalActive } = await supabase
    .from("personas")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  console.log(`\nTotal active personas in prod : ${totalActive}`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });

// One-shot: inspect Thomas duplicates + Adrien Fernandez personas before deletion.
// Shows owner, activity, conversation counts so we can pick the right Thomas
// to retire and confirm nothing touches Brahim's clones.
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

async function main() {
  const names = ["Thomas", "Adrien Fernandez"];

  for (const name of names) {
    const { data: personas, error } = await supabase
      .from("personas")
      .select("id, slug, client_id, client_label, name, is_active, created_at")
      .eq("name", name)
      .order("created_at", { ascending: true });

    if (error) throw error;

    console.log(`\n=== ${name} (${personas.length} row${personas.length !== 1 ? "s" : ""}) ===`);

    if (personas.length === 0) continue;

    const ownerIds = [...new Set(personas.map(p => p.client_id).filter(Boolean))];
    const { data: owners } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", ownerIds);
    const ownerMap = Object.fromEntries((owners || []).map(o => [o.id, o.name]));

    for (const p of personas) {
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, last_message_at")
        .eq("persona_id", p.id)
        .order("last_message_at", { ascending: false, nullsLast: true });

      const lastMsg = convs?.[0]?.last_message_at || null;
      const convCount = convs?.length || 0;

      const { count: msgCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", (convs || []).map(c => c.id).length > 0 ? (convs || []).map(c => c.id) : ["00000000-0000-0000-0000-000000000000"]);

      console.log({
        id: p.id,
        slug: p.slug,
        client_id: p.client_id,
        owner: ownerMap[p.client_id] || "(admin/null)",
        client_label: p.client_label,
        is_active: p.is_active,
        created_at: p.created_at,
        last_message_at: lastMsg,
        conversations: convCount,
        messages: msgCount || 0,
      });
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

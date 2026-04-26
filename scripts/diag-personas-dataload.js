// Inspect all personas grouped by name with data load.
// Decides KEEP vs DEACTIVATE per row based on activity.
// Pure read-only — no mutations.
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

async function countByCol(table, fk) {
  const { data, error } = await supabase.from(table).select(fk).not(fk, "is", null);
  if (error) {
    console.error(`error counting ${table}.${fk}: ${error.message}`);
    return new Map();
  }
  const counts = new Map();
  for (const row of data || []) {
    const k = row[fk];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

async function main() {
  const { data: personas } = await supabase
    .from("personas")
    .select("id, name, slug, client_id, is_active, created_at")
    .order("name");

  const [convCounts, correctionsCounts, knowledgeCounts, feedbackCounts, opsCounts, protoCounts] =
    await Promise.all([
      countByCol("conversations", "persona_id"),
      countByCol("corrections", "persona_id"),
      countByCol("knowledge_chunks", "persona_id"),
      countByCol("feedback_events", "persona_id"),
      countByCol("operating_protocols", "persona_id"),
      countByCol("protocol_document", "owner_id"),
    ]);

  // Messages = via conversations.
  const { data: convs } = await supabase.from("conversations").select("id, persona_id");
  const convToPersona = new Map();
  for (const c of convs || []) convToPersona.set(c.id, c.persona_id);
  const { data: msgs } = await supabase.from("messages").select("conversation_id");
  const msgCounts = new Map();
  for (const m of msgs || []) {
    const personaId = convToPersona.get(m.conversation_id);
    if (personaId) msgCounts.set(personaId, (msgCounts.get(personaId) || 0) + 1);
  }

  // Last message per persona.
  const { data: lastMsgs } = await supabase
    .from("conversations")
    .select("persona_id, last_message_at")
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false });
  const lastByPersona = new Map();
  for (const c of lastMsgs || []) {
    if (!lastByPersona.has(c.persona_id)) lastByPersona.set(c.persona_id, c.last_message_at);
  }

  const enriched = (personas || []).map((p) => ({
    ...p,
    conv: convCounts.get(p.id) || 0,
    msg: msgCounts.get(p.id) || 0,
    corr: correctionsCounts.get(p.id) || 0,
    knowledge: knowledgeCounts.get(p.id) || 0,
    feedback: feedbackCounts.get(p.id) || 0,
    ops: opsCounts.get(p.id) || 0,
    proto: protoCounts.get(p.id) || 0,
    last_msg: lastByPersona.get(p.id) || null,
    score:
      (convCounts.get(p.id) || 0) * 5 +
      (msgCounts.get(p.id) || 0) +
      (correctionsCounts.get(p.id) || 0) * 10 +
      (knowledgeCounts.get(p.id) || 0) * 2 +
      (feedbackCounts.get(p.id) || 0) * 3 +
      (opsCounts.get(p.id) || 0) * 50 +
      (protoCounts.get(p.id) || 0) * 100,
  }));

  const byName = new Map();
  for (const e of enriched) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e);
  }

  console.log("\n=== Personas by name ===\n");
  for (const [name, rows] of byName) {
    rows.sort((a, b) => b.score - a.score);
    console.log(`\n--- ${name} (${rows.length}) ---`);
    for (const r of rows) {
      const verdict = !r.is_active
        ? "💤 already inactive"
        : rows.length > 1 && r === rows[0]
          ? "✅ KEEP (max data)"
          : rows.length > 1
            ? "🗑️  DEACTIVATE (dup)"
            : "✅ singleton";
      console.log(
        `  ${r.id.slice(0, 8)} | slug=${r.slug.padEnd(22)} | active=${String(r.is_active).padEnd(5)} | ` +
          `conv=${String(r.conv).padStart(3)} msg=${String(r.msg).padStart(4)} corr=${String(r.corr).padStart(3)} ` +
          `kn=${String(r.knowledge).padStart(3)} fb=${String(r.feedback).padStart(2)} ops=${r.ops} v2=${r.proto} ` +
          `score=${String(r.score).padStart(5)} last=${r.last_msg?.slice(0, 10) || "—"} | ${verdict}`,
      );
    }
  }

  // Summary
  const distinct = byName.size;
  const totalRows = (personas || []).length;
  const activeRows = enriched.filter((p) => p.is_active).length;
  const inactiveRows = enriched.filter((p) => !p.is_active).length;
  const wouldDeactivate = enriched.filter((p) => {
    const group = byName.get(p.name);
    if (!group || group.length === 1) return false;
    if (!p.is_active) return false;
    return p !== group[0];
  });

  console.log(`\n=== Synthèse ===`);
  console.log(`Total rows                : ${totalRows}`);
  console.log(`Distinct names            : ${distinct}`);
  console.log(`Currently active          : ${activeRows}`);
  console.log(`Currently inactive        : ${inactiveRows}`);
  console.log(`Would deactivate (dups)   : ${wouldDeactivate.length}`);
  if (wouldDeactivate.length > 0) {
    const totalLost = wouldDeactivate.reduce(
      (acc, r) => ({
        conv: acc.conv + r.conv,
        msg: acc.msg + r.msg,
        corr: acc.corr + r.corr,
      }),
      { conv: 0, msg: 0, corr: 0 },
    );
    console.log(
      `   Data load on dups (lost on backfill, NOT deleted from DB) : conv=${totalLost.conv} msg=${totalLost.msg} corr=${totalLost.corr}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

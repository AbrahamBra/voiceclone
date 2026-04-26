// Read-only audit : pour chaque persona active, lister toutes les sources
// de données disponibles pour reconstruire un protocole vivant structuré.
//
// Sources possibles :
//   - operating_protocols.raw_document (doc upload original)
//   - protocol_hard_rules (règles déjà extraites du doc)
//   - knowledge_chunks (RAG content) — ne couvre peut-être pas le doc protocole
//   - personas.system_prompt / writing_rules
//   - scenarios files (FS-based, pas en DB)
//   - corrections (signaux N2 accumulés)
//
// Pas de mutation. Pure observation.
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

async function main() {
  const { data: personas } = await supabase
    .from("personas")
    .select("*")
    .eq("is_active", true)
    .order("name");

  for (const p of personas || []) {
    console.log("\n" + "=".repeat(80));
    console.log(`${p.name} (${p.slug}) — ${p.id.slice(0, 8)} — type=${p.type}`);
    console.log("=".repeat(80));

    // 1. operating_protocols
    const { data: ops } = await supabase
      .from("operating_protocols")
      .select("id, version, is_active, raw_document, created_at")
      .eq("persona_id", p.id);
    if ((ops || []).length === 0) {
      console.log("  operating_protocols : ❌ aucun");
    } else {
      for (const o of ops) {
        const rawLen = o.raw_document?.length || 0;
        console.log(
          `  operating_protocols  : v${o.version} active=${o.is_active} raw_len=${rawLen} created=${o.created_at?.slice(0, 10)}`,
        );
        if (rawLen > 0) {
          console.log(`     preview: ${o.raw_document.slice(0, 200).replace(/\n/g, " | ")}`);
        }
      }
    }

    // 2. protocol_hard_rules
    const { count: hardCount } = await supabase
      .from("protocol_hard_rules")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", p.id);
    console.log(`  protocol_hard_rules  : ${hardCount} rules`);

    // 3. knowledge_chunks (RAG)
    const { count: kwCount } = await supabase
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", p.id);
    console.log(`  knowledge_chunks     : ${kwCount} chunks`);

    // 4. proto-v2 doc state
    const { data: docs } = await supabase
      .from("protocol_document")
      .select("id, version, status")
      .eq("owner_id", p.id);
    for (const d of docs || []) {
      const { data: secs } = await supabase
        .from("protocol_section")
        .select("kind, prose")
        .eq("document_id", d.id);
      const sectionStats = (secs || []).map(
        (s) => `${s.kind}:${s.prose?.length || 0}`,
      );
      const { count: artCount } = await supabase
        .from("protocol_artifact")
        .select("id", { count: "exact", head: true })
        .in("source_section_id", (secs || []).map(s => s.id || ""));
      const { count: propCount } = await supabase
        .from("proposition")
        .select("id", { count: "exact", head: true })
        .eq("document_id", d.id);
      console.log(`  protocol_document    : v${d.version} ${d.status} doc=${d.id.slice(0, 8)}`);
      console.log(`     sections (kind:prose_len): ${sectionStats.join(" ")}`);
      console.log(`     artifacts: ${artCount} | propositions: ${propCount}`);
    }

    // 5. scenarios files mentioned in DB?
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, scenario_type")
      .eq("persona_id", p.id)
      .not("scenario_type", "is", null)
      .limit(50);
    const scenarioTypes = new Set((convs || []).map((c) => c.scenario_type));
    console.log(`  scenarios used in convs : ${[...scenarioTypes].join(", ") || "—"}`);

    // 6. Corrections summary (channels)
    const { data: corrs } = await supabase
      .from("corrections")
      .select("source_channel, correction")
      .eq("persona_id", p.id);
    const channels = new Map();
    for (const c of corrs || []) {
      channels.set(c.source_channel, (channels.get(c.source_channel) || 0) + 1);
    }
    console.log(`  corrections by channel  : ${[...channels].map(([k, v]) => `${k}:${v}`).join(" ") || "—"}`);

    // 7. Other persona-level columns of interest
    const knownInterest = ["system_prompt", "voice_calibration", "writing_rules", "scenarios", "calibration", "tone", "voice"];
    for (const k of knownInterest) {
      if (p[k] != null) {
        const repr = typeof p[k] === "string" ? `${p[k].length} chars` : `json ${JSON.stringify(p[k]).length} chars`;
        console.log(`  personas.${k.padEnd(20)} : ${repr}`);
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("Synthèse — pour chaque persona, ce qui peut servir au backfill structuré :");
  console.log("=".repeat(80));
  for (const p of personas || []) {
    const { data: ops } = await supabase
      .from("operating_protocols")
      .select("raw_document")
      .eq("persona_id", p.id)
      .limit(1)
      .maybeSingle();
    const hasRawDoc = (ops?.raw_document?.length || 0) > 100;
    const verdict = hasRawDoc
      ? `✅ raw_document ${ops.raw_document.length} chars → extractible`
      : `❌ pas de raw_document — needs new upload from user`;
    console.log(`  ${p.name.padEnd(22)} : ${verdict}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

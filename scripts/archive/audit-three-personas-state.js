// État post-PR #219 : Nicolas / Boni-yai / Mohamed.
// - Nicolas : bug params={} fixé ?
// - Boni-yai : scaffold vide ?
// - Mohamed : pas de protocol_document ?
// - maturity_level state global

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SLUGS = ["nicolas-lavall-e", "boni-yai", "mohamed-camara"];

console.log("=== AUDIT 3 PERSONAS — POST PR#219 ===\n");

for (const slug of SLUGS) {
  const { data: p } = await sb.from("personas")
    .select("id, slug, name, intelligence_source_id, is_active, maturity_level, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!p) { console.log(`✗ ${slug} : NOT FOUND\n`); continue; }
  const intellId = p.intelligence_source_id || p.id;

  console.log(`━━ ${slug} (${p.name})`);
  console.log(`   id=${p.id} active=${p.is_active} maturity=${p.maturity_level || "NULL"}`);

  // protocol_document
  const { data: docs } = await sb.from("protocol_document")
    .select("id, status, version, created_at, updated_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", p.id);
  const activeDoc = docs?.find(d => d.status === "active");
  console.log(`   protocol_document: ${docs?.length || 0} total, active=${activeDoc?.id || "NONE"}`);

  if (activeDoc) {
    const { data: secs } = await sb.from("protocol_section")
      .select("kind, prose, updated_at")
      .eq("document_id", activeDoc.id)
      .order("kind");
    console.log(`   sections: ${secs?.length || 0}`);
    for (const s of secs || []) {
      const proseLen = (s.prose || "").length;
      const flag = proseLen === 0 ? "□" : "▣";
      console.log(`     ${flag} ${s.kind.padEnd(15)} prose_len=${proseLen}`);
    }

    // artifacts + check_params status (le drama Nicolas)
    const { data: artifacts } = await sb.from("protocol_artifact")
      .select("id, kind, severity, content, is_active, created_at")
      .eq("document_id", activeDoc.id)
      .eq("is_active", true);
    console.log(`   artifacts active: ${artifacts?.length || 0}`);
    if (artifacts && artifacts.length) {
      let withParams = 0;
      let emptyParams = 0;
      for (const a of artifacts) {
        const params = a.content?.check_params || a.content?.params || {};
        const hasParams = params && Object.keys(params).length > 0;
        if (hasParams) withParams++; else emptyParams++;
      }
      console.log(`     check_params filled: ${withParams}/${artifacts.length} (empty: ${emptyParams})`);
      if (emptyParams > 0) {
        // Show first empty-params artifact for diagnosis
        const sample = artifacts.find(a => {
          const params = a.content?.check_params || a.content?.params || {};
          return !params || Object.keys(params).length === 0;
        });
        console.log(`     ⚠ sample empty: kind=${sample.kind} content_keys=${Object.keys(sample.content || {}).join(",")}`);
      }
    }
  }

  // chunks
  const { count: nChunks } = await sb.from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  // knowledge_files
  const { count: nKf } = await sb.from("knowledge_files")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  console.log(`   chunks: ${nChunks}    knowledge_files: ${nKf}`);

  // recent feedback / corrections / firings
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [
    { count: nFE },
    { count: nCorr },
    { count: nFirings },
  ] = await Promise.all([
    sb.from("feedback_events").select("*", { count: "exact", head: true }).eq("persona_id", p.id).gte("created_at", since30d),
    sb.from("corrections").select("*", { count: "exact", head: true }).eq("persona_id", p.id).gte("created_at", since30d),
    sb.from("protocol_rule_firing").select("*", { count: "exact", head: true }).eq("persona_id", p.id).gte("created_at", since30d),
  ]);
  console.log(`   30d : feedback_events=${nFE}  corrections=${nCorr}  firings=${nFirings}`);
  console.log("");
}

// Maturity level distribution
console.log("━━ MATURITY LEVEL DISTRIBUTION (all personas)");
const { data: allPers } = await sb.from("personas")
  .select("slug, name, is_active, maturity_level")
  .order("created_at", { ascending: false });
const dist = { NULL: 0, L1: 0, L2: 0, L3: 0, other: 0 };
for (const p of allPers || []) {
  const k = p.maturity_level === null || p.maturity_level === undefined ? "NULL" : p.maturity_level;
  if (k in dist) dist[k]++; else dist.other++;
}
console.log(`   ${JSON.stringify(dist)}`);
const nullPersons = (allPers || []).filter(p => !p.maturity_level);
console.log(`   NULL personas (${nullPersons.length}):`);
for (const p of nullPersons.slice(0, 15)) {
  console.log(`     ${p.is_active ? "✓" : "·"} ${p.slug.padEnd(25)} ${p.name || ""}`);
}

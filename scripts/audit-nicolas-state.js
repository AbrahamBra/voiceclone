import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: nicolas } = await sb.from("personas")
  .select("id, slug, name, voice, is_active, created_at")
  .eq("slug", "nicolas-lavall-e")
  .single();

if (!nicolas) { console.error("Nicolas not found"); process.exit(1); }

console.log("=== NICOLAS STATE AUDIT ===\n");
console.log("ID:", nicolas.id);
console.log("Slug:", nicolas.slug);
console.log("is_active:", nicolas.is_active);
console.log("created_at:", nicolas.created_at);

const writingRules = nicolas.voice?.writingRules || [];
console.log("\n--- LEGACY voice.writingRules ---");
console.log("count:", writingRules.length);
writingRules.forEach((r, i) => console.log(`  ${i + 1}. ${typeof r === "string" ? r.slice(0, 100) : JSON.stringify(r).slice(0, 100)}`));

const { data: doc } = await sb.from("protocol_document")
  .select("id, status, version, created_at, updated_at")
  .eq("owner_kind", "persona")
  .eq("owner_id", nicolas.id)
  .eq("status", "active")
  .maybeSingle();

console.log("\n--- NEW pipeline protocol_document ---");
console.log(doc ? `id=${doc.id} v${doc.version} created=${doc.created_at}` : "NONE");

if (doc) {
  const { data: secs } = await sb.from("protocol_section")
    .select("kind, prose, updated_at")
    .eq("document_id", doc.id);
  console.log("\nSections:");
  for (const s of secs || []) {
    console.log(`  ${s.kind.padEnd(15)} prose_len=${(s.prose || "").length.toString().padStart(5)} updated=${s.updated_at}`);
  }

  const { count: artifactCount } = await sb.from("protocol_artifact")
    .select("*", { count: "exact", head: true })
    .eq("document_id", doc.id);
  console.log("\nprotocol_artifact count:", artifactCount);

  const { data: artifactsByStatus } = await sb.from("protocol_artifact")
    .select("status")
    .eq("document_id", doc.id);
  const statusCounts = {};
  for (const a of artifactsByStatus || []) statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  console.log("artifact statuses:", statusCounts);
}

const { count: feedbackCount } = await sb.from("feedback_events")
  .select("*", { count: "exact", head: true })
  .eq("persona_id", nicolas.id);
console.log("\n--- feedback_events ---");
console.log("total:", feedbackCount);

const { data: recentFeedback } = await sb.from("feedback_events")
  .select("event_type, created_at")
  .eq("persona_id", nicolas.id)
  .order("created_at", { ascending: false })
  .limit(5);
console.log("recent 5:");
for (const f of recentFeedback || []) console.log(`  ${f.created_at} ${f.event_type}`);

const { count: propositionCount } = await sb.from("proposition")
  .select("*", { count: "exact", head: true })
  .eq("persona_id", nicolas.id);
console.log("\n--- propositions ---");
console.log("total:", propositionCount);

const { data: propByStatus } = await sb.from("proposition")
  .select("status, source")
  .eq("persona_id", nicolas.id);
const propCounts = {};
const sourceCounts = {};
for (const p of propByStatus || []) {
  propCounts[p.status] = (propCounts[p.status] || 0) + 1;
  sourceCounts[p.source] = (sourceCounts[p.source] || 0) + 1;
}
console.log("by status:", propCounts);
console.log("by source:", sourceCounts);

const { count: correctionCount } = await sb.from("corrections")
  .select("*", { count: "exact", head: true })
  .eq("persona_id", nicolas.id);
console.log("\n--- legacy corrections ---");
console.log("total:", correctionCount);

const { data: corrByStatus } = await sb.from("corrections")
  .select("status")
  .eq("persona_id", nicolas.id);
const corrCounts = {};
for (const c of corrByStatus || []) corrCounts[c.status] = (corrCounts[c.status] || 0) + 1;
console.log("by status:", corrCounts);

const { count: knowledgeCount } = await sb.from("knowledge_files")
  .select("*", { count: "exact", head: true })
  .eq("persona_id", nicolas.id);
console.log("\n--- knowledge_files ---");
console.log("total:", knowledgeCount);

const { data: convs } = await sb.from("conversations")
  .select("id, created_at")
  .eq("persona_id", nicolas.id)
  .order("created_at", { ascending: false })
  .limit(3);
console.log("\n--- recent conversations ---");
console.log("count latest 3:", convs?.length || 0);
for (const c of convs || []) console.log(`  ${c.created_at} ${c.id}`);

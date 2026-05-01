import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: nicolas } = await sb.from("personas")
  .select("id, slug, name")
  .eq("slug", "nicolas-lavall-e")
  .single();

if (!nicolas) { console.error("Nicolas not found"); process.exit(1); }
console.log("Nicolas persona id:", nicolas.id);

// 1. Find recent assistant messages containing "yo" as a standalone word
const { data: yoMessages } = await sb.from("messages")
  .select("id, conversation_id, role, content, created_at, message_type, turn_kind")
  .ilike("content", "%yo%")
  .eq("role", "assistant")
  .order("created_at", { ascending: false })
  .limit(20);

console.log("\n=== Assistant messages containing 'yo' (last 20) ===");
const candidates = [];
for (const m of yoMessages || []) {
  // Only care about Nicolas conversations
  const { data: conv } = await sb.from("conversations").select("persona_id").eq("id", m.conversation_id).single();
  if (conv?.persona_id !== nicolas.id) continue;
  // Only standalone-yo (whitespace boundaries)
  if (/(^|[\s,!?.])yo([\s,!?.]|$)/i.test(m.content)) {
    candidates.push(m);
    console.log(`\n  msg_id=${m.id}`);
    console.log(`  conv=${m.conversation_id}  type=${m.message_type}  turn=${m.turn_kind}`);
    console.log(`  ${m.created_at}`);
    console.log(`  content: ${m.content.slice(0, 200)}`);
  }
}

if (candidates.length === 0) {
  console.log("  (no standalone-yo matches found in Nicolas conversations)");
  process.exit(0);
}

// 2. For the most recent yo, dump full conversation + all events
const target = candidates[0];
console.log(`\n\n=== FULL CONTEXT for conv ${target.conversation_id} ===`);

const { data: allMsgs } = await sb.from("messages")
  .select("id, role, content, created_at, message_type, turn_kind")
  .eq("conversation_id", target.conversation_id)
  .order("created_at", { ascending: true });

console.log(`\n${allMsgs?.length || 0} messages in this conv:\n`);
for (const m of allMsgs || []) {
  const role = m.role.padEnd(9);
  const type = (m.message_type || "?").padEnd(6);
  const tk = (m.turn_kind || "?").padEnd(13);
  console.log(`[${m.created_at}] ${role} ${type} ${tk} ${m.id.slice(0, 8)}`);
  console.log(`  ${(m.content || "").slice(0, 250).replace(/\n/g, " ")}`);
}

// 3. feedback_events for this conv
const { data: fbEvents } = await sb.from("feedback_events")
  .select("id, event_type, message_id, rules_fired, learning_event_id, created_at")
  .eq("conversation_id", target.conversation_id)
  .order("created_at", { ascending: true });

console.log(`\n=== feedback_events on this conv: ${fbEvents?.length || 0} ===`);
for (const e of fbEvents || []) {
  console.log(`  ${e.created_at} ${e.event_type}  msg=${e.message_id?.slice(0, 8)}  le=${e.learning_event_id?.slice(0, 8) || "—"}`);
}

// 4. learning_events around the same time window (Nicolas, +/- 30 min)
const targetTime = new Date(target.created_at);
const before = new Date(targetTime.getTime() - 5 * 60 * 1000).toISOString();
const after = new Date(targetTime.getTime() + 60 * 60 * 1000).toISOString();

const { data: learnEvents } = await sb.from("learning_events")
  .select("id, event_type, payload, created_at")
  .eq("persona_id", nicolas.id)
  .gte("created_at", before)
  .lte("created_at", after)
  .order("created_at", { ascending: true });

console.log(`\n=== learning_events Nicolas in window [${before} → ${after}]: ${learnEvents?.length || 0} ===`);
for (const e of learnEvents || []) {
  console.log(`  ${e.created_at} ${e.event_type}`);
  console.log(`    payload: ${JSON.stringify(e.payload).slice(0, 200)}`);
}

// 5. corrections recently for Nicolas
const { data: recentCorr } = await sb.from("corrections")
  .select("id, correction, status, confidence, created_at")
  .eq("persona_id", nicolas.id)
  .gte("created_at", before)
  .order("created_at", { ascending: false })
  .limit(10);

console.log(`\n=== corrections for Nicolas since ${before}: ${recentCorr?.length || 0} ===`);
for (const c of recentCorr || []) {
  console.log(`  ${c.created_at} status=${c.status} conf=${c.confidence}`);
  console.log(`    ${(c.correction || "").slice(0, 200)}`);
}

// 6. Active protocol — what rules ARE there
const { data: doc } = await sb.from("protocol_document")
  .select("id, version, status, updated_at")
  .eq("owner_kind", "persona").eq("owner_id", nicolas.id).eq("status", "active")
  .maybeSingle();
console.log(`\n=== active protocol_document: ${doc ? "v" + doc.version + " " + doc.id : "NONE"} ===`);

if (doc) {
  const { data: artifacts } = await sb.from("protocol_artifact")
    .select("id, kind, status, content, updated_at")
    .eq("document_id", doc.id)
    .eq("status", "active");
  console.log(`active artifacts: ${artifacts?.length || 0}`);
  // Search for vouvoiement / yo / familier rules
  for (const a of artifacts || []) {
    const c = JSON.stringify(a.content).toLowerCase();
    if (c.includes("vouvoie") || c.includes("yo") || c.includes("famili") || c.includes("salut") || c.includes("tutoie")) {
      console.log(`  ★ match-rule kind=${a.kind} id=${a.id.slice(0, 8)}`);
      console.log(`    content: ${JSON.stringify(a.content).slice(0, 400)}`);
    }
  }
}

// 7. Legacy voice writingRules
const { data: personaFull } = await sb.from("personas").select("voice").eq("id", nicolas.id).single();
const wr = personaFull?.voice?.writingRules || [];
console.log(`\n=== legacy voice.writingRules: ${wr.length} ===`);
const wrJoined = JSON.stringify(wr).toLowerCase();
const hits = ["vouvoie", "yo", "famili", "salut", "tutoie"].filter(t => wrJoined.includes(t));
console.log(`  matches: ${hits.length ? hits.join(", ") : "(none)"}`);
if (hits.length) {
  for (const r of wr) {
    const s = typeof r === "string" ? r : JSON.stringify(r);
    if (hits.some(t => s.toLowerCase().includes(t))) console.log(`  ★ ${s.slice(0, 200)}`);
  }
}

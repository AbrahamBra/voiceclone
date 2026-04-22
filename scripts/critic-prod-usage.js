#!/usr/bin/env node
// Diagnostic one-shot : trafic prod réel vs synthétique dans rhythm_shadow.
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CRITIC_COMMIT_DATE = "2026-04-18T11:12:48+02:00"; // b1c0e63
const THOMAS = "ac1c4ff5-e040-4042-84e8-a7173d9b75b9";

// 1. Total rows dans rhythm_shadow
const { count: totalShadow } = await supabase.from("rhythm_shadow").select("*", { count: "exact", head: true });

// 2. Rows avec message_id (= lié à un vrai message, pas synthétique)
const { count: linkedShadow } = await supabase.from("rhythm_shadow").select("*", { count: "exact", head: true }).not("message_id", "is", null);

// 3. Rows linked APRÈS critic commit
const { count: postCommitLinked } = await supabase.from("rhythm_shadow").select("*", { count: "exact", head: true }).not("message_id", "is", null).gte("created_at", CRITIC_COMMIT_DATE);

// 4. Messages prod assistant Thomas après commit
const { count: prodMessagesAfter } = await supabase
  .from("messages").select("*, conversations!inner(persona_id)", { count: "exact", head: true })
  .eq("role", "assistant").eq("conversations.persona_id", THOMAS).gte("created_at", CRITIC_COMMIT_DATE);

// 5. Dernières 10 rows linked, breakdown par date et critic_version
const { data: recentLinked } = await supabase.from("rhythm_shadow")
  .select("id, persona_id, conversation_id, message_id, score, would_flag, critic_version, created_at")
  .not("message_id", "is", null).order("created_at", { ascending: false }).limit(10);

// 6. Breakdown par critic_version (shadow total)
const { data: byVersion } = await supabase.from("rhythm_shadow").select("critic_version").not("message_id", "is", null);
const versionCounts = (byVersion || []).reduce((a, r) => { a[r.critic_version || "null"] = (a[r.critic_version || "null"] || 0) + 1; return a; }, {});

// 7. Coverage : parmi les messages assistant Thomas post-commit, combien ont une row rhythm_shadow ?
const { data: msgsAfter } = await supabase
  .from("messages").select("id, created_at, conversations!inner(persona_id)")
  .eq("role", "assistant").eq("conversations.persona_id", THOMAS)
  .gte("created_at", CRITIC_COMMIT_DATE).order("created_at", { ascending: false }).limit(200);
const msgIds = (msgsAfter || []).map(m => m.id);
let covered = 0;
if (msgIds.length) {
  const { data: shadowFor } = await supabase.from("rhythm_shadow")
    .select("message_id").in("message_id", msgIds);
  covered = new Set((shadowFor || []).map(r => r.message_id)).size;
}

console.log(JSON.stringify({
  now: new Date().toISOString(),
  critic_commit: CRITIC_COMMIT_DATE,
  totals: {
    rhythm_shadow_total: totalShadow,
    rhythm_shadow_linked_to_message: linkedShadow,
    rhythm_shadow_linked_post_commit: postCommitLinked,
  },
  thomas_prod_messages_assistant_post_commit: prodMessagesAfter,
  thomas_coverage: {
    sampled_messages: msgIds.length,
    messages_with_shadow_row: covered,
    coverage_pct: msgIds.length ? +(100 * covered / msgIds.length).toFixed(1) : null,
  },
  linked_by_critic_version: versionCounts,
  recent_linked_rows: recentLinked,
}, null, 2));

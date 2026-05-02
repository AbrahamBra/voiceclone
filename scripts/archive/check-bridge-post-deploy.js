#!/usr/bin/env node
// One-shot: split feedback_events into pre-deploy vs post-deploy (d2993a4 @ 2026-04-24 16:49 CEST)
// to confirm the 7.1% bridging rate is just legacy, not a prod bug.
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DEPLOY_AT = "2026-04-24T14:49:50Z"; // 16:49 CEST = 14:49 UTC

const { data: fbRows } = await supabase
  .from("feedback_events")
  .select("id, event_type, learning_event_id, created_at")
  .gte("created_at", new Date(Date.now() - 30 * 86400 * 1000).toISOString())
  .order("created_at");

const pre = fbRows.filter(r => r.created_at < DEPLOY_AT);
const post = fbRows.filter(r => r.created_at >= DEPLOY_AT);

function rate(arr) {
  if (!arr.length) return "n/a";
  const linked = arr.filter(r => r.learning_event_id).length;
  return `${linked}/${arr.length} = ${((linked / arr.length) * 100).toFixed(1)}%`;
}

console.log(JSON.stringify({
  deploy_at: DEPLOY_AT,
  pre_deploy: { count: pre.length, bridging: rate(pre), events: pre.map(r => ({ t: r.event_type, linked: !!r.learning_event_id, at: r.created_at })) },
  post_deploy: { count: post.length, bridging: rate(post), events: post.map(r => ({ t: r.event_type, linked: !!r.learning_event_id, at: r.created_at })) },
}, null, 2));

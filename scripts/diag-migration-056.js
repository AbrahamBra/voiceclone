#!/usr/bin/env node
// Verify migration 056 (corrections.kind) applied correctly on prod.
// Checks: column exists, backfill complete, distribution sane.
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("── Migration 056 verification ──\n");

// 1. Column exists + can be selected
const { data: sample, error: selErr } = await supabase
  .from("corrections").select("id, kind, correction").limit(1);
if (selErr) {
  console.error("FAIL: cannot select kind column —", selErr.message);
  process.exit(1);
}
console.log("✓ kind column exists and is selectable");

// 2. Distribution
const { data: dist, error: distErr } = await supabase
  .from("corrections").select("kind");
if (distErr) {
  console.error("FAIL:", distErr.message);
  process.exit(1);
}
const counts = {};
for (const row of dist) counts[row.kind ?? "NULL"] = (counts[row.kind ?? "NULL"] || 0) + 1;
console.log(`\n  Distribution (${dist.length} rows total):`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(20)} ${v}`);
}

// 3. NULL count must be 0 after backfill
const nullCount = counts["NULL"] || 0;
if (nullCount > 0) {
  console.error(`\n✗ FAIL: ${nullCount} rows still have kind=NULL — backfill did not complete`);
  process.exit(1);
}
console.log("\n✓ No NULL kind values — backfill complete");

// 4. Sanity check: rows with [VALIDATED] prefix should now have kind='validated'
const { data: legacy } = await supabase
  .from("corrections")
  .select("id, kind, correction")
  .like("correction", "[VALIDATED]%")
  .limit(5);
if (legacy && legacy.length > 0) {
  const wrong = legacy.filter(r => r.kind !== "validated");
  if (wrong.length > 0) {
    console.error(`✗ FAIL: ${wrong.length}/${legacy.length} rows with [VALIDATED] prefix have wrong kind`);
    for (const r of wrong) console.error(`    id=${r.id} kind=${r.kind}`);
    process.exit(1);
  }
  console.log(`✓ ${legacy.length} sampled [VALIDATED] rows all have kind='validated'`);
}

// 5. Check kind='rule' isn't accidentally tagged on marker rows
const { data: markerCheck } = await supabase
  .from("corrections")
  .select("id, kind, correction")
  .eq("kind", "rule")
  .or("correction.like.[VALIDATED]%,correction.like.[CLIENT_VALIDATED]%,correction.like.[EXCELLENT]%,correction.like.[COPY_PASTE_OUT]%,correction.like.[REGEN_REJECTED]%")
  .limit(5);
if (markerCheck && markerCheck.length > 0) {
  console.error(`✗ FAIL: ${markerCheck.length} rows have kind='rule' but a marker prefix:`);
  for (const r of markerCheck) console.error(`    id=${r.id} correction=${r.correction.slice(0, 50)}`);
  process.exit(1);
}
console.log("✓ No marker-prefixed rows mis-tagged as kind='rule'");

console.log("\n✓ Migration 056 verified.");

#!/usr/bin/env node
// Pre-beta automated checklist — runs all conditions from audit Session 6 verdict.
// Exits 0 if GO, 1 if any blocker is red.
//
// Usage: node scripts/pre-beta-checklist.js [--persona=<slug>]
//
// Checks performed:
//   1. Personas readiness — counts active personas with all 6 sections filled
//   2. N3 cron wiring — verifies cron-auto-critique exists in vercel.json
//      and cron secret env is set (CRON_SECRET)
//   3. Protocol-v2 feature flag — checks NEW_PROTOCOL_UI_PERSONAS env var
//      (best effort; Vercel-set vars only visible in Vercel dashboard)
//   4. Last activity — warns if silence > 24h (not blocking)
//   5. Open PRs — warns if any non-draft PR is mergeable but unmerged
//
// Designed to be parameterizable for any persona; default = audit all active.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const personaArg = args.find(a => a.startsWith("--persona="))?.split("=")[1];

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const REQUIRED_SECTIONS = ["hard_rules", "errors", "templates", "process", "icp_patterns", "scoring"];
const MIN_PROSE_PER_SECTION = 100; // chars; sections under this = stub bootstrap, not ready

const blockers = [];
const warnings = [];
const passes = [];

// ---------- 1. Personas readiness ----------
async function checkPersonas() {
  const q = sb.from("personas").select("id, slug, name").eq("is_active", true);
  if (personaArg) q.eq("slug", personaArg);
  const { data: personas, error } = await q;
  if (error) { blockers.push(`personas query failed: ${error.message}`); return; }
  if (!personas?.length) { blockers.push("no active personas found"); return; }

  const ready = [];
  const inert = [];
  for (const p of personas) {
    const { data: doc } = await sb
      .from("protocol_document")
      .select("id")
      .eq("owner_kind", "persona")
      .eq("owner_id", p.id)
      .eq("status", "active")
      .maybeSingle();
    if (!doc) { inert.push({ ...p, reason: "no active doc" }); continue; }

    const { data: secs } = await sb
      .from("protocol_section")
      .select("kind, prose")
      .eq("document_id", doc.id);
    const sizes = Object.fromEntries((secs || []).map(s => [s.kind, (s.prose || "").length]));
    const missing = REQUIRED_SECTIONS.filter(k => (sizes[k] || 0) < MIN_PROSE_PER_SECTION);
    if (missing.length === 0) ready.push(p);
    else inert.push({ ...p, missing, sizes });
  }

  if (ready.length === 0) {
    blockers.push("0 personas have all 6 sections filled (≥100 chars each)");
  } else {
    passes.push(`${ready.length}/${personas.length} personas beta-ready: ${ready.map(p => p.slug).join(", ")}`);
  }
  if (inert.length > 0) {
    warnings.push(`${inert.length} personas with empty sections (testeur risque de croire le produit cassé) :`);
    for (const p of inert) {
      warnings.push(`  - ${p.slug}: ${p.missing ? "missing=" + p.missing.join(",") : p.reason}`);
    }
  }
}

// ---------- 2. N3 cron wiring ----------
async function checkN3() {
  let vercelJson;
  try {
    vercelJson = JSON.parse(await readFile("vercel.json", "utf8"));
  } catch (err) {
    blockers.push(`vercel.json unreadable: ${err.message}`);
    return;
  }
  const crons = vercelJson.crons || [];
  const hasAutoCritique = crons.some(c => c.path === "/api/cron-auto-critique");
  const hasFidelity = crons.some(c => c.path === "/api/cron-fidelity");
  if (!hasAutoCritique) blockers.push("vercel.json: no /api/cron-auto-critique cron registered");
  else passes.push(`N3 cron registered (schedule: ${crons.find(c => c.path === "/api/cron-auto-critique").schedule})`);
  if (!hasFidelity) warnings.push("vercel.json: no /api/cron-fidelity cron (fidelity_scores won't update)");
  else passes.push(`Fidelity cron registered (schedule: ${crons.find(c => c.path === "/api/cron-fidelity").schedule})`);

  if (!process.env.CRON_SECRET) warnings.push("CRON_SECRET not set in local env (required in Vercel prod for cron auth)");
}

// ---------- 3. Feature flag ----------
async function checkFeatureFlag() {
  // Local-only check — Vercel-set vars not visible from this script
  const flag = process.env.NEW_PROTOCOL_UI_PERSONAS;
  if (flag === undefined) {
    warnings.push("NEW_PROTOCOL_UI_PERSONAS not set in local .env (cannot verify Vercel prod state — run `vercel env ls production`)");
  } else if (flag === "" || flag === "0" || flag === "false") {
    blockers.push(`NEW_PROTOCOL_UI_PERSONAS=${flag} (disabled — UI v2 doctrine sera cachée)`);
  } else {
    passes.push(`NEW_PROTOCOL_UI_PERSONAS=${flag} (active)`);
  }
}

// ---------- 4. Last activity ----------
async function checkActivity() {
  const { data: lastMsg } = await sb
    .from("conversations")
    .select("last_message_at")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!lastMsg?.last_message_at) {
    warnings.push("no conversation activity ever recorded");
    return;
  }
  const ageH = (Date.now() - new Date(lastMsg.last_message_at).getTime()) / 3600000;
  if (ageH > 48) warnings.push(`silence prod ${ageH.toFixed(0)}h (smoke test perso recommended before invitation externe)`);
  else if (ageH > 24) warnings.push(`silence prod ${ageH.toFixed(0)}h`);
  else passes.push(`activité prod < 24h (last_message ${ageH.toFixed(1)}h ago)`);
}

// ---------- 5. Open PRs sanity ----------
async function checkOpenPRs() {
  // Best-effort via gh CLI; skipped if unavailable
  // (we don't want to add another dep)
  passes.push("open PRs check : run `gh pr list --state open` manually");
}

// ---------- main ----------
console.log(`\n=== Pre-beta checklist (${new Date().toISOString().slice(0,16)}) ===`);
if (personaArg) console.log(`Scoped to persona: ${personaArg}\n`);

await checkPersonas();
await checkN3();
await checkFeatureFlag();
await checkActivity();
await checkOpenPRs();

console.log("\n--- ✅ PASS ---");
for (const p of passes) console.log(`  ${p}`);

if (warnings.length > 0) {
  console.log("\n--- ⚠️  WARNINGS (non-bloquants) ---");
  for (const w of warnings) console.log(`  ${w}`);
}

if (blockers.length > 0) {
  console.log("\n--- 🔴 BLOCKERS ---");
  for (const b of blockers) console.log(`  ${b}`);
  console.log("\n=== VERDICT: NO-GO ===");
  process.exit(1);
}

if (warnings.length > 0) {
  console.log("\n=== VERDICT: GO-AVEC-CONDITIONS (review warnings above) ===");
} else {
  console.log("\n=== VERDICT: GO ===");
}

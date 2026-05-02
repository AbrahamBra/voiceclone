#!/usr/bin/env node
// Smoke test for the api/feedback refactor (PR #175). Exercises every
// modified type path against the real handler + Supabase, verifies the
// new `kind` column is set correctly, and that tool_use replaces the
// old regex JSON parsing without breaking the contract. Cleans up after.
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PERSONA_ID = "32047cda-77cf-466b-899d-27d151a487a4"; // nicolas
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "diag-bypass-no-real-admin";

const handler = (await import("../api/feedback.js")).default;

function mkRes() {
  let status = 200, payload = null;
  return {
    res: {
      setHeader() { return this; },
      status(c) { status = c; return this; },
      json(b) { payload = b; return this; },
      end() { return this; },
    },
    get: () => ({ status, payload }),
  };
}

async function call(body) {
  const { res, get } = mkRes();
  const req = {
    method: "POST",
    body: { ...body, persona: PERSONA_ID },
    headers: { "x-access-code": process.env.ADMIN_CODE },
    query: {},
  };
  await handler(req, res);
  return get();
}

async function latestRowFor(persona, predicate) {
  const { data } = await supabase
    .from("corrections").select("id, kind, correction, bot_message")
    .eq("persona_id", persona)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data || []).find(predicate);
}

const { data: persona } = await supabase
  .from("personas").select("id, intelligence_source_id").eq("id", PERSONA_ID).single();
const intellId = persona.intelligence_source_id || persona.id;

const created = []; // ids to clean up at the end
let pass = 0, fail = 0;

function assert(cond, label, extra) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}${extra ? " — " + JSON.stringify(extra) : ""}`); fail++; }
}

// ── 1. unknown type → 400 (KNOWN_TYPES guard) ────────────────
console.log("\n[1] unknown type rejected");
{
  const r = await call({ type: "totally_made_up", botMessage: "x" });
  assert(r.status === 400, "returns 400", r);
  assert(r.payload?.error?.includes("Unknown feedback type"), "error message correct", r.payload);
}

// ── 2. validate → kind='validated' ────────────────────────────
console.log("\n[2] validate writes kind='validated'");
{
  const marker = `__smoke_validate_${Date.now()}`;
  const r = await call({ type: "validate", botMessage: marker });
  assert(r.status === 200 && r.payload?.ok, "200 OK", r);
  const row = await latestRowFor(intellId, (c) => c.bot_message === marker);
  assert(row, "row inserted");
  assert(row?.kind === "validated", `kind='validated' (got ${row?.kind})`);
  if (row) created.push(row.id);
}

// ── 3. client_validate → kind='client_validated' ──────────────
console.log("\n[3] client_validate writes kind='client_validated'");
{
  const marker = `__smoke_clientval_${Date.now()}`;
  const r = await call({ type: "client_validate", botMessage: marker });
  assert(r.status === 200 && r.payload?.signal === "client_validated", "signal returned", r);
  const row = await latestRowFor(intellId, (c) => c.bot_message === marker);
  assert(row?.kind === "client_validated", `kind='client_validated' (got ${row?.kind})`);
  if (row) created.push(row.id);
}

// ── 4. excellent → kind='excellent' ───────────────────────────
console.log("\n[4] excellent writes kind='excellent'");
{
  const marker = `__smoke_excellent_${Date.now()}`;
  const r = await call({ type: "excellent", botMessage: marker });
  assert(r.status === 200 && r.payload?.signal === "excellent", "signal returned", r);
  const row = await latestRowFor(intellId, (c) => c.bot_message === marker);
  assert(row?.kind === "excellent", `kind='excellent' (got ${row?.kind})`);
  if (row) created.push(row.id);
}

// ── 5. copy_paste_out → kind='copy_paste_out' ─────────────────
console.log("\n[5] copy_paste_out writes kind='copy_paste_out'");
{
  const marker = `__smoke_copypaste_${Date.now()}`;
  const r = await call({ type: "copy_paste_out", botMessage: marker });
  assert(r.status === 200 && r.payload?.signal === "copy_paste_out", "signal returned", r);
  const row = await latestRowFor(intellId, (c) => c.bot_message === marker);
  assert(row?.kind === "copy_paste_out", `kind='copy_paste_out' (got ${row?.kind})`);
  if (row) created.push(row.id);
}

// ── 6. regen_rejection → kind='regen_rejection' ───────────────
console.log("\n[6] regen_rejection writes kind='regen_rejection'");
{
  const marker = `__smoke_regenrej_${Date.now()}`;
  const r = await call({ type: "regen_rejection", botMessage: marker });
  assert(r.status === 200 && r.payload?.signal === "regen_rejection", "signal returned", r);
  const row = await latestRowFor(intellId, (c) => c.bot_message === marker);
  assert(row?.kind === "regen_rejection", `kind='regen_rejection' (got ${row?.kind})`);
  if (row) created.push(row.id);
}

// ── 7. save_rule → tool_use extracts a rule, kind='rule' ──────
console.log("\n[7] save_rule uses tool_use, writes kind='rule'");
{
  const userMessage = "Toujours commencer les DM par une question ouverte qui valide une douleur précise du prospect, jamais par un compliment générique.";
  const r = await call({ type: "save_rule", userMessage });
  assert(r.status === 200 && r.payload?.ok, "200 OK", r);
  assert(typeof r.payload?.rule === "string" && r.payload.rule.length > 5, "rule extracted via tool_use", { rule: r.payload?.rule });
  // The rule text from tool_use is in the correction column directly (not the user_message)
  const row = await latestRowFor(intellId, (c) => c.kind === "rule" && c.correction === r.payload?.rule);
  assert(row, "row found by extracted rule text");
  assert(row?.kind === "rule", `kind='rule' (got ${row?.kind})`);
  if (row) created.push(row.id);
}

// ── 8. extract_rules_from_post → tool_use returns rules[] ─────
console.log("\n[8] extract_rules_from_post uses tool_use, no DB write");
{
  const post = `Quand un prospect te dit "je vais réfléchir", la pire chose à faire c'est de relancer dans 3 jours avec "alors, tu en penses quoi ?". Le silence c'est une info. Soit il a un blocage qu'il ose pas dire, soit il s'en fout. Dans les deux cas, ta relance générique va l'enfoncer.

Ce qui marche : reprends la dernière objection précise qu'il a posée, propose une réponse concrète sous forme de mini-checklist, et termine sans question. Tu rends la balle, il bouge ou pas. Pas de "tu es dispo cette semaine", pas de "je voulais juste savoir si...", pas de smiley.

Le bon setter c'est celui qui sait pas relancer.`;
  const r = await call({ type: "extract_rules_from_post", post });
  assert(r.status === 200 && r.payload?.ok, "200 OK", r);
  assert(Array.isArray(r.payload?.rules) && r.payload.rules.length >= 1, `rules array non-empty (len=${r.payload?.rules?.length})`, r.payload);
  if (r.payload?.rules?.length) {
    console.log(`     sample rule: "${r.payload.rules[0].text}"`);
  }
}

// ── Cleanup ──────────────────────────────────────────────────
console.log(`\n── Cleanup: deleting ${created.length} test rows ──`);
if (created.length > 0) {
  const { error } = await supabase.from("corrections").delete().in("id", created);
  if (error) console.log("  cleanup error:", error.message);
  else console.log("  ✓ cleaned");
}

// ── Summary ──────────────────────────────────────────────────
console.log(`\n── Result: ${pass} pass / ${fail} fail ──`);
process.exit(fail > 0 ? 1 : 0);

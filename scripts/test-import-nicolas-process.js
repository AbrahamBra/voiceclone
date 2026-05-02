#!/usr/bin/env node
/**
 * Run the import-doc pipeline on Nicolas's process-setter.md fixture
 * and report what propositions get created.
 *
 * Bypasses auth by passing stub authenticateRequest / hasPersonaAccess.
 * Writes real propositions to DB (status='pending') against Nicolas's
 * active GLOBAL protocol_document.
 *
 * Usage: node --env-file=../../../.env.local scripts/test-import-nicolas-process.js [--dry-run]
 *
 * --dry-run: skip the supabase writes, but still call router + extractors
 *            (real Anthropic calls — costs money but no DB pollution).
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../../../.env.local");
dotenv.config({ path: envPath, override: true });
import { createClient } from "@supabase/supabase-js";
import handler from "../api/v2/protocol/import-doc.js";

const NICOLAS_SLUG = "nicolas-lavall-e";
const FIXTURE_PATH = "test/fixtures/process-setter.md";

const dryRun = process.argv.includes("--dry-run");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: nicolas } = await sb
  .from("personas")
  .select("id, slug, name")
  .eq("slug", NICOLAS_SLUG)
  .single();
if (!nicolas) {
  console.error("Nicolas persona not found");
  process.exit(1);
}
console.log(`Persona: ${nicolas.name} (${nicolas.id})`);

const { data: globalDoc } = await sb
  .from("protocol_document")
  .select("id, version, updated_at")
  .eq("owner_kind", "persona")
  .eq("owner_id", nicolas.id)
  .eq("status", "active")
  .is("source_core", null)
  .maybeSingle();
if (!globalDoc) {
  console.error("No active global protocol_document for Nicolas");
  process.exit(1);
}
console.log(`Active global doc: id=${globalDoc.id} v${globalDoc.version}`);

const { count: existingPending } = await sb
  .from("proposition")
  .select("*", { count: "exact", head: true })
  .eq("document_id", globalDoc.id)
  .eq("status", "pending");
console.log(`Existing pending propositions on this doc: ${existingPending}`);

const docText = fs.readFileSync(FIXTURE_PATH, "utf8");
console.log(`\nDoc fixture: ${FIXTURE_PATH} (${docText.length} chars)\n`);

// Wrap supabase to no-op writes in dry-run
const wrappedSb = dryRun
  ? new Proxy(sb, {
      get(target, prop) {
        if (prop !== "from") return Reflect.get(target, prop);
        return (table) => {
          const real = target.from(table);
          return new Proxy(real, {
            get(rt, p) {
              if (p === "insert" || p === "update" || p === "delete" || p === "upsert") {
                // Return a chainable thenable that resolves to a fake row so
                // .insert(...).select(...).single() pattern works.
                const fake = {
                  select: () => fake,
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: `dry-${Math.random().toString(36).slice(2, 10)}`,
                        target_kind: null,
                        intent: null,
                        proposed_text: null,
                        rationale: null,
                        confidence: null,
                      },
                      error: null,
                    }),
                  eq: () => Promise.resolve({ error: null }),
                  then: (resolve) => resolve({ error: null }),
                };
                return () => fake;
              }
              return Reflect.get(rt, p);
            },
          });
        };
      },
    })
  : sb;

const stubAuth = async () => ({ client: { id: "service-role" }, isAdmin: true });
const stubAccess = async () => true;

let resolveResp;
const respPromise = new Promise((r) => (resolveResp = r));
const res = {
  status(code) {
    this._status = code;
    return this;
  },
  json(body) {
    resolveResp({ status: this._status, body });
  },
  end() {
    resolveResp({ status: this._status, body: null });
  },
};

const t0 = Date.now();
await handler(
  {
    method: "POST",
    body: { persona_id: nicolas.id, doc_text: docText, doc_filename: "process-setter.md" },
  },
  res,
  {
    authenticateRequest: stubAuth,
    hasPersonaAccess: stubAccess,
    supabase: wrappedSb,
    setCors: () => {},
  },
);
const { status, body } = await respPromise;
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== RESPONSE (${elapsed}s, status ${status}) ===\n`);
if (status !== 200) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(`chunks_processed:     ${body.chunks_processed}`);
console.log(`candidates_total:     ${body.candidates_total}`);
console.log(`propositions_created: ${body.propositions_created}`);
console.log(`propositions_merged:  ${body.propositions_merged}`);
console.log(`silenced:             ${body.silenced}`);
console.log(`batch_id:             ${body.batch_id}`);

console.log(`\n=== PROPOSITIONS BREAKDOWN BY target_kind ===`);
const byKind = {};
for (const p of body.propositions || []) {
  byKind[p.target_kind] = (byKind[p.target_kind] || 0) + 1;
}
for (const [k, n] of Object.entries(byKind)) console.log(`  ${k.padEnd(15)} ${n}`);

console.log(`\n=== EACH PROPOSITION ===`);
for (const p of body.propositions || []) {
  console.log(`\n[${p.target_kind}] confidence=${p.confidence}`);
  console.log(`  intent: ${p.intent || "—"}`);
  console.log(`  proposed_text: ${(p.proposed_text || "").slice(0, 200)}`);
  if (p.rationale) console.log(`  rationale: ${p.rationale.slice(0, 200)}`);
}

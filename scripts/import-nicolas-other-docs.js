// Import the 3 OTHER Nicolas docs via /api/v2/protocol/import-doc with the
// correct doc_kind per file :
//   - AudienceCibleNicolas → icp_audience  (icp_patterns + process extractors)
//   - PositionnementNicolas → positioning   (identity append + icp_patterns + process)
//   - BackgroundNicolas    → persona_context (identity append only)
//
// Usage : node scripts/import-nicolas-other-docs.js [--dry-run]

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import handler from "../api/v2/protocol/import-doc.js";

// override: true required because the shell env has ANTHROPIC_API_KEY="" set
// by the harness, which would otherwise prevent dotenv from loading the real
// key and cause extractFromChunk to silently skip the LLM call.
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env", override: true });

const dryRun = process.argv.includes("--dry-run");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const NICOLAS_SLUG = "nicolas-lavall-e";
const DOCS = [
  { pattern: "AudienceCibleNicolas",  doc_kind: "icp_audience",     filename: "audience-cible.odt" },
  { pattern: "PositionnementNicolas", doc_kind: "positioning",      filename: "positionnement.odt" },
  { pattern: "BackgroundNicolas",     doc_kind: "persona_context",  filename: "background.odt" },
];

const { data: nicolas } = await sb.from("personas").select("id, name").eq("slug", NICOLAS_SLUG).single();
if (!nicolas) { console.error("Nicolas not found"); process.exit(1); }
console.log(`Persona: ${nicolas.name} (${nicolas.id})\n`);

const wrappedSb = dryRun
  ? new Proxy(sb, {
      get(target, prop) {
        if (prop !== "from") return Reflect.get(target, prop);
        return (table) => {
          const real = target.from(table);
          return new Proxy(real, {
            get(rt, p) {
              if (p === "insert" || p === "update" || p === "delete" || p === "upsert") {
                return (row) => {
                  const echoed = { id: `dry-${Math.random().toString(36).slice(2, 10)}`, ...(row || {}) };
                  const fake = {
                    select: () => fake,
                    single: () => Promise.resolve({ data: echoed, error: null }),
                    eq: () => Promise.resolve({ error: null }),
                    then: (resolve) => resolve({ error: null }),
                  };
                  return fake;
                };
              }
              return Reflect.get(rt, p);
            },
          });
        };
      },
    })
  : sb;

for (const docDef of DOCS) {
  console.log(`━━━ ${docDef.pattern} (doc_kind=${docDef.doc_kind}) ━━━`);

  const { data: kfRows } = await sb.from("knowledge_files")
    .select("id, path, content")
    .eq("persona_id", nicolas.id)
    .ilike("path", `${docDef.pattern}%`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!kfRows || kfRows.length === 0) {
    console.log(`  ✗ no knowledge_file matching "${docDef.pattern}*" — skip\n`);
    continue;
  }

  const kf = kfRows[0];
  console.log(`  source: ${kf.path} (${kf.content.length} chars)`);

  let resolveResp;
  const respPromise = new Promise((r) => (resolveResp = r));
  const res = {
    status(c) { this._s = c; return this; },
    json(b) { resolveResp({ status: this._s, body: b }); },
    end() { resolveResp({ status: this._s, body: null }); },
  };

  const t0 = Date.now();
  await handler(
    {
      method: "POST",
      body: {
        persona_id: nicolas.id,
        doc_text: kf.content,
        doc_filename: docDef.filename,
        doc_kind: docDef.doc_kind,
      },
    },
    res,
    {
      authenticateRequest: async () => ({ client: { id: "service-role" }, isAdmin: true }),
      hasPersonaAccess: async () => true,
      supabase: wrappedSb,
      setCors: () => {},
    },
  );
  const { status, body } = await respPromise;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (status !== 200) {
    console.error(`  ✗ ${status}: ${JSON.stringify(body).slice(0, 200)}\n`);
    continue;
  }

  console.log(`  ✓ ${elapsed}s — chunks=${body.chunks_processed} candidates=${body.candidates_total} created=${body.propositions_created} merged=${body.propositions_merged}`);
  if (body.identity_appended) {
    console.log(`     identity_chars_added=${body.identity_chars_added}`);
  }

  // Breakdown
  if (body.propositions?.length) {
    const byKind = {};
    for (const p of body.propositions) byKind[p.target_kind] = (byKind[p.target_kind] || 0) + 1;
    const breakdown = Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(" ");
    console.log(`     breakdown: ${breakdown}`);
  }
  console.log("");
}

// Final audit
const { count: totalProps } = await sb.from("proposition")
  .select("*", { count: "exact", head: true });

const { data: docs } = await sb.from("protocol_document")
  .select("id, status").eq("owner_kind", "persona").eq("owner_id", nicolas.id);
const docIds = (docs || []).map((d) => d.id);
const { count: nicolasProps } = await sb.from("proposition")
  .select("*", { count: "exact", head: true })
  .in("document_id", docIds);

console.log(`\n=== FINAL ===`);
console.log(`Nicolas propositions total: ${nicolasProps}`);
console.log(`All propositions:           ${totalProps}`);

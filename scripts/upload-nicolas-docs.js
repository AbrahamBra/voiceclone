// Phase 0.1 — Upload 4 docs Nicolas en prod (one-shot).
//
// 3 ODT (AudienceCible/Positionnement/Background) → knowledge_files generic
// 1 PDF (Reflexion process setting + IA)          → knowledge_files operating_protocol + operating_protocols row
//
// Strict mirror of api/knowledge.js POST file path. Embedding sync via embedAndStore.
//
// Usage : node scripts/upload-nicolas-docs.js [--dry-run]

import dotenv from "dotenv";
import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chunkText, embedAndStore } from "../lib/embeddings.js";

// .env vit dans le main repo, pas dans le worktree
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });

const DRY_RUN = process.argv.includes("--dry-run");
const NICOLAS_SLUG = "nicolas-lavall-e";

const DOCS = [
  { type: "odt",  doc_type: "generic",            file: "C:/Users/abrah/Downloads/AudienceCibleNicolas.odt"        },
  { type: "odt",  doc_type: "generic",            file: "C:/Users/abrah/Downloads/PositionnementNicolas.odt"       },
  { type: "odt",  doc_type: "generic",            file: "C:/Users/abrah/Downloads/BackgroundNicolas.odt"           },
  { type: "pdf",  doc_type: "operating_protocol", file: "C:/Users/abrah/Downloads/Reflexion process setting + IA.docx.pdf" },
];

function extractOdtText(filePath) {
  // ODT = ZIP avec content.xml. unzip -p extrait sur stdout.
  // L'inplément XML d'OpenDocument ne mange que <text:p>, <text:h>, <text:tab>, <text:s>, <text:span>.
  const xml = execSync(`unzip -p "${filePath}" content.xml`, { encoding: "utf8", maxBuffer: 50_000_000 });

  // Convertir <text:p> en \n\n, <text:h> en \n\n, autres tags strip
  let text = xml
    .replace(/<\/text:p>/g, "\n\n")
    .replace(/<\/text:h>/g, "\n\n")
    .replace(/<text:tab\/?>/g, "\t")
    .replace(/<text:s\s*text:c="(\d+)"\s*\/>/g, (_, n) => " ".repeat(Number(n)))
    .replace(/<text:s\/?>/g, " ")
    .replace(/<text:line-break\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")          // tous autres tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")          // collapse spaces
    .replace(/\n{3,}/g, "\n\n")       // collapse blank lines
    .trim();

  return text;
}

async function extractPdfText(filePath) {
  // pdfjs-dist v4 legacy build pour Node ESM
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(filePath));
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.warn("⚠️  VOYAGE_API_KEY missing — embeddings will be skipped (chunk_count = 0)");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Resolve Nicolas
  const { data: nicolas, error: pErr } = await supabase
    .from("personas")
    .select("id, slug, name, intelligence_source_id, is_active")
    .eq("slug", NICOLAS_SLUG)
    .single();
  if (pErr || !nicolas) {
    console.error("Nicolas not found (slug=", NICOLAS_SLUG, ")", pErr?.message);
    process.exit(1);
  }
  const intellId = nicolas.intelligence_source_id || nicolas.id;
  console.log(`✓ Nicolas resolved: id=${nicolas.id} intellId=${intellId} active=${nicolas.is_active}\n`);

  // Process each doc
  const results = [];
  for (const doc of DOCS) {
    const filename = path.basename(doc.file);
    console.log(`---\n📄 ${filename} (${doc.type}, document_type=${doc.doc_type})`);

    let content;
    try {
      content = doc.type === "odt" ? extractOdtText(doc.file) : await extractPdfText(doc.file);
    } catch (err) {
      console.error(`  ✗ extraction failed: ${err.message}`);
      results.push({ filename, status: "extract_failed", error: err.message });
      continue;
    }

    const len = content.length;
    const preview = content.slice(0, 200).replace(/\n/g, " ↵ ");
    console.log(`  extracted: ${len} chars`);
    console.log(`  preview  : ${preview}${len > 200 ? "…" : ""}`);

    if (len < 100) {
      console.error(`  ✗ extraction too short (<100 chars) — likely scanned PDF or empty doc`);
      results.push({ filename, status: "extract_too_short", chars: len });
      continue;
    }
    if (len > 250_000) {
      console.error(`  ✗ extraction too large (>250k chars) — knowledge cap`);
      results.push({ filename, status: "extract_too_large", chars: len });
      continue;
    }

    if (DRY_RUN) {
      console.log(`  (dry-run) would INSERT knowledge_files + chunks`);
      results.push({ filename, status: "dry_run_ok", chars: len });
      continue;
    }

    // Path identique à api/knowledge.js : timestamp suffix pour unicité
    const dotIndex = filename.lastIndexOf(".");
    const ext = dotIndex >= 0 ? filename.slice(dotIndex) : "";
    const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
    const dbPath = `${base}-${Date.now()}${ext}`;

    // INSERT knowledge_files
    const { data: inserted, error: insErr } = await supabase
      .from("knowledge_files")
      .insert({
        persona_id: intellId,
        path: dbPath,
        keywords: [],
        content,
        contributed_by: null,
        extraction_status: "pending",
        extraction_attempts: 0,
        document_type: doc.doc_type,
      })
      .select("id")
      .single();

    if (insErr) {
      console.error(`  ✗ knowledge_files insert: ${insErr.message}`);
      results.push({ filename, status: "kf_insert_failed", error: insErr.message });
      continue;
    }
    console.log(`  ✓ knowledge_files inserted (id=${inserted.id}, path=${dbPath})`);

    // operating_protocol path : ajouter row dans operating_protocols
    let protocolId = null;
    if (doc.doc_type === "operating_protocol") {
      const { data: protoRow, error: protoErr } = await supabase
        .from("operating_protocols")
        .insert({
          persona_id: intellId,
          source_file_id: inserted.id,
          status: "pending",
          raw_document: content,
        })
        .select("id")
        .single();
      if (protoErr) {
        console.error(`  ✗ operating_protocols insert: ${protoErr.message}`);
      } else {
        protocolId = protoRow.id;
        console.log(`  ✓ operating_protocols inserted (id=${protocolId})`);
      }
    }

    // Embedding sync
    let chunkCount = 0;
    let embedStatus = "ok";
    try {
      const chunks = chunkText(content);
      chunkCount = await embedAndStore(supabase, chunks, intellId, "knowledge_file", dbPath);
      console.log(`  ✓ embedded ${chunkCount} chunks`);
    } catch (e) {
      embedStatus = "failed";
      console.error(`  ✗ embed_and_store: ${e.message}`);
    }

    results.push({
      filename,
      status: "ok",
      chars: len,
      chunk_count: chunkCount,
      embed_status: embedStatus,
      kf_id: inserted.id,
      protocol_id: protocolId,
    });
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    const flag = r.status === "ok" ? "✓" : r.status === "dry_run_ok" ? "→" : "✗";
    console.log(`${flag} ${r.filename.padEnd(50)} ${JSON.stringify(r).slice(0, 200)}`);
  }
  const nbOk = results.filter((r) => r.status === "ok").length;
  console.log(`\n${nbOk}/${results.length} succeeded`);
  process.exit(nbOk === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

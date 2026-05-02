// One-off bootstrap : crée un protocol_document scaffold pour Mohamed Camara
// (slug=mohamed-camara). Mohamed est is_active=false donc le script
// bootstrap-protocol-doc-existing.js ne le couvre pas. Mais comme on prépare
// son activation prochaine, autant lui scaffolder le doc dès maintenant pour
// que l'import-doc et le drain feedback puissent tourner sans erreur 404.
//
// Idempotent : skip si Mohamed a déjà un doc.
// Dry-run par défaut, --apply pour écrire.
//
// Usage : node scripts/bootstrap-protocol-doc-mohamed.js [--apply]

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });

const apply = process.argv.includes("--apply");
const SLUG = "mohamed-camara";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SECTIONS = [
  { kind: "identity",     order: 0, heading: "Identité — voix, parcours, convictions" },
  { kind: "hard_rules",   order: 1, heading: "Règles absolues" },
  { kind: "errors",       order: 2, heading: "Erreurs à éviter — préférences de formulation" },
  { kind: "process",      order: 3, heading: "Process — étapes opérationnelles" },
  { kind: "icp_patterns", order: 4, heading: "ICP patterns — taxonomie prospects" },
  { kind: "scoring",      order: 5, heading: "Scoring — axes de qualification" },
  { kind: "templates",    order: 6, heading: "Templates — skeletons par scénario" },
];

const { data: persona, error: pErr } = await sb.from("personas")
  .select("id, name, slug, is_active, created_at")
  .eq("slug", SLUG).single();
if (pErr || !persona) { console.error(`Persona ${SLUG} introuvable`); process.exit(1); }

console.log(`Persona: ${persona.name} (${persona.id}) is_active=${persona.is_active}`);

const { data: existing } = await sb.from("protocol_document")
  .select("id, status, version")
  .eq("owner_kind", "persona")
  .eq("owner_id", persona.id);

if (existing && existing.length > 0) {
  console.log(`⏭️  Mohamed a déjà ${existing.length} protocol_document(s). Skip.`);
  for (const d of existing) console.log(`   v${d.version} status=${d.status} id=${d.id}`);
  process.exit(0);
}

if (!apply) {
  console.log(`📝 (dry-run) would create active doc v1 + 7 sections for ${SLUG}`);
  process.exit(0);
}

const { data: doc, error: docErr } = await sb.from("protocol_document")
  .insert({ owner_kind: "persona", owner_id: persona.id, version: 1, status: "active" })
  .select("id").single();
if (docErr || !doc) { console.error(`✗ doc insert: ${docErr?.message}`); process.exit(2); }

console.log(`✓ doc created: ${doc.id}`);

const sections = SECTIONS.map((s) => ({
  ...s,
  document_id: doc.id,
  prose: "",
  structured: null,
  author_kind: "auto_extraction",
}));
const { error: secErr } = await sb.from("protocol_section").insert(sections);
if (secErr) { console.error(`✗ sections insert: ${secErr.message}`); process.exit(3); }

console.log(`✓ 7 sections inserted (identity + 6 standard)`);
console.log(`\n✓ Mohamed bootstrap complete — import-doc et drain feedback peuvent tourner.`);

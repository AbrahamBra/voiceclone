/**
 * Set voice.tutoiement_default = true on personas whose onboarding documents
 * explicitly state tutoiement as default register.
 *
 * Provenance : ce flag encode une préférence DOCUMENTÉE par le client lors
 * de l'onboarding. Sans signal explicite dans les docs partagés → flag absent
 * → règle B5 applique vouvoiement par défaut.
 *
 * Usage :
 *   node scripts/set-tutoiement-defaults.js                 # boucle sur TARGETS (Nicolas + Thomas)
 *   node scripts/set-tutoiement-defaults.js --persona <slug>  # ne traite que ce slug (upsert même si pas dans TARGETS)
 *   node scripts/set-tutoiement-defaults.js --dry-run         # n'écrit pas la DB, affiche ce qui serait fait
 *   node scripts/set-tutoiement-defaults.js --persona <slug> --dry-run  # combinable
 *
 * Idempotent : skip si voice.tutoiement_default est déjà true.
 *
 * Run après que la règle B5 (setterBaseline.js) soit déployée pour éviter
 * du bruit shadow injustifié sur les personas où le tutoiement est explicite.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const TARGETS = [
  { slug: "nicolas-lavall-e", reason: "playbook DM HOM : tutoiement par défaut explicite (sauf si vouvoiement initié par le prospect)" },
  { slug: "thomas-abdelhay",  reason: "doc voix Thomas : 'Tutoyer par defaut. Passer au vouvoiement uniquement si le lead vouvoie'" },
];

function parseArgs(argv) {
  const args = { persona: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--persona") args.persona = argv[++i] || null;
    else if (a.startsWith("--persona=")) args.persona = a.slice("--persona=".length);
  }
  return args;
}

const { persona: personaArg, dryRun } = parseArgs(process.argv.slice(2));
const list = personaArg
  ? [{ slug: personaArg, reason: "explicit --persona override" }]
  : TARGETS;

if (dryRun) console.log("[dry-run] no DB writes will be performed");
if (personaArg) console.log(`[scope] single persona: ${personaArg}`);

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let ok = 0, skip = 0, fail = 0;
for (const { slug, reason } of list) {
  const { data: p, error } = await sb.from("personas")
    .select("id, slug, name, voice")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) { console.error("ERROR fetching", slug, error.message); fail++; continue; }
  if (!p) { console.warn("SKIP not found:", slug); skip++; continue; }

  const voice = p.voice || {};
  if (voice.tutoiement_default === true) {
    console.log("SKIP already set:", slug);
    skip++;
    continue;
  }
  const updated = { ...voice, tutoiement_default: true };
  if (dryRun) {
    console.log("DRY-RUN would update:", slug, "—", reason);
    ok++;
    continue;
  }
  const { error: upErr } = await sb.from("personas").update({ voice: updated }).eq("id", p.id);
  if (upErr) {
    console.error("ERROR updating", slug, upErr.message);
    fail++;
  } else {
    console.log("OK", slug, "—", reason);
    ok++;
  }
}
console.log(`\nDone: ${ok} ${dryRun ? "would-update" : "updated"}, ${skip} skipped, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);

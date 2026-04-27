/**
 * Set voice.tutoiement_default = true on personas whose onboarding documents
 * explicitly state tutoiement as default register.
 *
 * Provenance : ce flag encode une préférence DOCUMENTÉE par le client lors
 * de l'onboarding. Sans signal explicite dans les docs partagés → flag absent
 * → règle B5 applique vouvoiement par défaut.
 *
 * Run once after setterBaseline.js B5 rule is deployed.
 *   node scripts/set-tutoiement-defaults.js
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TARGETS = [
  { slug: "nicolas-lavall-e", reason: "playbook DM HOM : tutoiement par défaut explicite (sauf si vouvoiement initié par le prospect)" },
  { slug: "thomas-abdelhay",  reason: "doc voix Thomas : 'Tutoyer par defaut. Passer au vouvoiement uniquement si le lead vouvoie'" },
];

let ok = 0, skip = 0, fail = 0;
for (const { slug, reason } of TARGETS) {
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
  const { error: upErr } = await sb.from("personas").update({ voice: updated }).eq("id", p.id);
  if (upErr) {
    console.error("ERROR updating", slug, upErr.message);
    fail++;
  } else {
    console.log("OK", slug, "—", reason);
    ok++;
  }
}
console.log(`\nDone: ${ok} updated, ${skip} skipped, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);

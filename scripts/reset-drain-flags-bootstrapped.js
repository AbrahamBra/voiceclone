// Reset drained flags on feedback_events + corrections for the 5 personas
// that just received a fresh protocol_document via bootstrap.
// Their existing rows were marked drained_at / proposition_drained_at yesterday
// with reason=no_active_document. Now that the doc exists, we want them to
// re-drain so the proposition queue actually fills up.
//
// Idempotent: re-running just re-resets (no harm).
// CLI: node --env-file=.env.local scripts/reset-drain-flags-bootstrapped.js [--apply]
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

// The 5 personas that received a fresh doc just now (Adrien, Ahmet, Mohamed, Mory-Fodé, Thomas).
// IDs taken from the bootstrap output.
const TARGET_PERSONAS = [
  { id: "e76af613-4d24-4022-a7c6-567f0ce81245", name: "Adrien Fernandez" },
  { id: "f193ccf6-2077-48ad-8797-01ebfb928aa6", name: "Ahmet Akyurek" },
  { id: "42ed7abb-7fc9-4335-bd7e-27ff1b1c89ac", name: "Mohamed Camara" },
  { id: "a75a042d-2f69-45bc-85dd-5aec03744ab5", name: "Mory-Fodé CISSE" },
  { id: "ac1c4ff5-e040-4042-84e8-a7173d9b75b9", name: "Thomas" },
];

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`=== Reset drain flags for 5 bootstrapped personas (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  const ids = TARGET_PERSONAS.map((p) => p.id);

  // Count what would be reset.
  const { count: feCount } = await supabase
    .from("feedback_events")
    .select("id", { count: "exact", head: true })
    .in("persona_id", ids)
    .not("drained_at", "is", null);

  const { count: coCount } = await supabase
    .from("corrections")
    .select("id", { count: "exact", head: true })
    .in("persona_id", ids)
    .not("proposition_drained_at", "is", null);

  console.log(`feedback_events.drained_at to reset      : ${feCount}`);
  console.log(`corrections.proposition_drained_at reset : ${coCount}`);

  if (!apply) {
    console.log("\nRe-run with --apply to execute.");
    return;
  }

  const { data: feUpd, error: feErr } = await supabase
    .from("feedback_events")
    .update({ drained_at: null })
    .in("persona_id", ids)
    .not("drained_at", "is", null)
    .select("id");
  if (feErr) console.error(`fe error: ${feErr.message}`);
  else console.log(`✅ feedback_events reset: ${feUpd?.length || 0}`);

  const { data: coUpd, error: coErr } = await supabase
    .from("corrections")
    .update({ proposition_drained_at: null })
    .in("persona_id", ids)
    .not("proposition_drained_at", "is", null)
    .select("id");
  if (coErr) console.error(`co error: ${coErr.message}`);
  else console.log(`✅ corrections reset: ${coUpd?.length || 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

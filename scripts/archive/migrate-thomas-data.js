// Migrate data from Thomas #1 (dd26c9a6, slug=thomas, INACTIVE)
// to Thomas keeper (ac1c4ff5, slug=thomas-abdelhay, ACTIVE).
//
// Tables touched (corrections + conversations + feedback_events).
// Messages follow via conversation_id automatically.
//
// Usage : node --env-file=.env.local scripts/migrate-thomas-data.js [--apply]
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const FROM_ID = "dd26c9a6-0f0a-4d01-9ae0-d942f71f81cb"; // slug: thomas (inactive)
const TO_ID = "ac1c4ff5-e040-4042-84e8-a7173d9b75b9";   // slug: thomas-abdelhay (active)

const apply = process.argv.includes("--apply");
const mode = apply ? "APPLY" : "DRY-RUN";

async function countOnPersona(table, fk, personaId) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(fk, personaId);
  if (error) {
    console.warn(`warn count ${table}.${fk} = ${personaId}: ${error.message}`);
    return -1;
  }
  return count || 0;
}

async function migrate(table, fk) {
  const before = await countOnPersona(table, fk, FROM_ID);
  if (before <= 0) {
    console.log(`  ${table}.${fk} : ${before === 0 ? "0 rows on FROM, skip" : "ERR"}`);
    return { table, fk, migrated: 0 };
  }
  if (!apply) {
    console.log(`  ${table}.${fk} : would migrate ${before} rows`);
    return { table, fk, migrated: 0, planned: before };
  }
  const { data, error } = await supabase
    .from(table)
    .update({ [fk]: TO_ID })
    .eq(fk, FROM_ID)
    .select("id");
  if (error) {
    console.error(`  ❌ ${table}.${fk} : ${error.message}`);
    return { table, fk, migrated: 0, error: error.message };
  }
  const moved = data?.length || 0;
  console.log(`  ✅ ${table}.${fk} : migrated ${moved} rows`);
  return { table, fk, migrated: moved };
}

async function main() {
  console.log(`=== Migrate Thomas ${FROM_ID.slice(0, 8)} → ${TO_ID.slice(0, 8)} (${mode}) ===\n`);

  // Show before-state for both rows.
  const before = {
    from_corr: await countOnPersona("corrections", "persona_id", FROM_ID),
    from_conv: await countOnPersona("conversations", "persona_id", FROM_ID),
    from_fb: await countOnPersona("feedback_events", "persona_id", FROM_ID),
    to_corr: await countOnPersona("corrections", "persona_id", TO_ID),
    to_conv: await countOnPersona("conversations", "persona_id", TO_ID),
    to_fb: await countOnPersona("feedback_events", "persona_id", TO_ID),
  };
  console.log(`AVANT :`);
  console.log(`  FROM (${FROM_ID.slice(0, 8)}) : conv=${before.from_conv} corr=${before.from_corr} fb=${before.from_fb}`);
  console.log(`  TO   (${TO_ID.slice(0, 8)}) : conv=${before.to_conv} corr=${before.to_corr} fb=${before.to_fb}`);
  console.log("");

  console.log("Migrations :");
  await migrate("corrections", "persona_id");
  await migrate("conversations", "persona_id");
  await migrate("feedback_events", "persona_id");

  if (apply) {
    console.log("\nAPRÈS :");
    const after = {
      from_corr: await countOnPersona("corrections", "persona_id", FROM_ID),
      from_conv: await countOnPersona("conversations", "persona_id", FROM_ID),
      from_fb: await countOnPersona("feedback_events", "persona_id", FROM_ID),
      to_corr: await countOnPersona("corrections", "persona_id", TO_ID),
      to_conv: await countOnPersona("conversations", "persona_id", TO_ID),
      to_fb: await countOnPersona("feedback_events", "persona_id", TO_ID),
    };
    console.log(`  FROM (${FROM_ID.slice(0, 8)}) : conv=${after.from_conv} corr=${after.from_corr} fb=${after.from_fb}`);
    console.log(`  TO   (${TO_ID.slice(0, 8)}) : conv=${after.to_conv} corr=${after.to_corr} fb=${after.to_fb}`);
  } else {
    console.log("\nRe-run with --apply to execute.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

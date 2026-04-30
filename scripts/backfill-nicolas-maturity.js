#!/usr/bin/env node
/**
 * V1.5 backfill — Nicolas est L2 (playbook DM mono-scenario : icebreaker outbound).
 *
 * Spec : docs/superpowers/specs/2026-04-27-clone-meta-rules-and-maturity.md §1
 *
 * À exécuter APRÈS application de la migration 054_persona_maturity_level.sql.
 *
 * Usage : node scripts/backfill-nicolas-maturity.js
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await sb.from("personas")
  .update({ maturity_level: "L2" })
  .eq("slug", "nicolas-lavall-e")
  .select("slug, name, maturity_level");

if (error) {
  if (error.message.includes("maturity_level") && error.message.includes("does not exist")) {
    console.error("Migration 054 not applied yet. Apply supabase/054_persona_maturity_level.sql first.");
    process.exit(1);
  }
  console.error("UPDATE failed:", error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.error("Nicolas not found (slug=nicolas-lavall-e)");
  process.exit(1);
}

console.log(`✓ Backfilled ${data[0].name}: maturity_level=${data[0].maturity_level}`);

import { strict as assert } from "node:assert";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// NOTE: This test currently skips without SUPABASE_TEST_URL. When the test DB
// is actually wired up, the .from("information_schema.tables") and
// .from("pg_extension") calls below will NOT work through PostgREST (those
// schemas aren't exposed). Switch to a direct pg client (import pg from "pg")
// keyed on DATABASE_URL, or implement a SECURITY DEFINER RPC that returns
// jsonb. Tracked for a later task in the Protocole Vivant plan.

// Uses SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY for a throwaway DB.
// This test skips if vars aren't set (allows CI without DB).
const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;

const skipIfNoTestDb = () => {
  if (!TEST_URL || !TEST_KEY) return { skip: "no test DB configured" };
  return {};
};

describe("migration 038 — protocol_v2_core", () => {
  let sb;
  before(() => {
    if (!TEST_URL || !TEST_KEY) return;
    sb = createClient(TEST_URL, TEST_KEY);
  });

  it("creates 5 new tables", skipIfNoTestDb(), async () => {
    const sql = readFileSync("supabase/038_protocol_v2_core.sql", "utf8");
    const { error } = await sb.rpc("exec_sql", { sql });
    assert.equal(error, null, `SQL exec failed: ${error?.message}`);

    const { data } = await sb
      .from("information_schema.tables")
      .select("table_name")
      .in("table_name", [
        "protocol_document",
        "protocol_section",
        "protocol_artifact",
        "proposition",
        "extractor_training_example",
      ]);
    assert.equal(data?.length, 5, `expected 5 tables, got ${data?.length}`);
  });

  it("enables pgvector extension", skipIfNoTestDb(), async () => {
    const { data } = await sb
      .from("pg_extension")
      .select("extname")
      .eq("extname", "vector");
    assert.equal(data?.length, 1, "pgvector extension not enabled");
  });
});

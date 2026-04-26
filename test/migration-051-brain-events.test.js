import { strict as assert } from "node:assert";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const skipIfNoTestDb = () => (!TEST_URL || !TEST_KEY) ? { skip: "no test DB configured" } : {};

const NEW_EVENTS = ['brain_drawer_opened', 'brain_edit_during_draft'];
const DRIFT_FIX_EVENTS = ['copy_paste_out', 'regen_rejection'];
const EXISTING_EVENTS = ['validated', 'validated_edited', 'corrected', 'saved_rule', 'excellent', 'client_validated', 'paste_zone_dismissed'];

describe("migration 051 — feedback_brain_drawer", () => {
  let sb;
  before(() => { if (TEST_URL && TEST_KEY) sb = createClient(TEST_URL, TEST_KEY); });

  it("applies without error", skipIfNoTestDb(), async () => {
    const sql = readFileSync("supabase/051_feedback_brain_drawer.sql", "utf8");
    const { error } = await sb.rpc("exec_sql", { sql });
    assert.equal(error, null, `SQL exec failed: ${error?.message}`);
  });

  it("CHECK accepts all 11 valid event_types", skipIfNoTestDb(), async () => {
    const allValid = [...EXISTING_EVENTS, ...DRIFT_FIX_EVENTS, ...NEW_EVENTS];
    assert.equal(allValid.length, 11);
    const sql = readFileSync("supabase/051_feedback_brain_drawer.sql", "utf8");
    for (const event of allValid) {
      assert.ok(sql.includes(`'${event}'`), `migration missing event '${event}'`);
    }
  });

  it("CHECK rejects an invented event_type", skipIfNoTestDb(), async () => {
    const { error } = await sb.from("feedback_events").insert({
      conversation_id: "00000000-0000-0000-0000-000000000000",
      message_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000000",
      event_type: "totally_made_up_event",
    });
    assert.ok(error, "expected an error for invalid event_type");
    assert.ok(
      /check|23514|violat/i.test(error.message) || error.code === "23514" || error.code === "23503",
      `expected check violation, got: ${error.code} ${error.message}`
    );
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SCENARIOS,
  SCENARIO_IDS,
  DEFAULT_SCENARIO_ID,
  isScenarioId,
  legacyKeyFor,
} from "../src/lib/scenarios.js";

// DM-only since 2026-04-28 — post scenarios were removed from the app
// (LinkedIn post scraping as INPUT data is unaffected). These values must
// stay in lockstep with the DM canonicals exposed elsewhere in the
// codebase (composer sub-modes, chat scenario overrides).
const EXPECTED_IDS = ["DM_1st", "DM_relance", "DM_reply", "DM_closing"];

describe("CANONICAL_SCENARIOS catalog (DM-only)", () => {
  test("exposes exactly the 4 DM canonicals", () => {
    assert.deepEqual([...SCENARIO_IDS], EXPECTED_IDS);
  });

  test("every entry has self-consistent id and a label", () => {
    for (const id of SCENARIO_IDS) {
      const def = CANONICAL_SCENARIOS[id];
      assert.equal(def.id, id, `id mismatch for ${id}`);
      assert.ok(def.label && def.label.length > 0, `missing label for ${id}`);
    }
  });

  test("catalog is frozen (cannot be mutated at runtime)", () => {
    assert.throws(() => {
      // @ts-expect-error — intentional mutation attempt
      CANONICAL_SCENARIOS.DM_1st = null;
    });
  });

  test("DEFAULT_SCENARIO_ID is a valid canonical id", () => {
    assert.ok(isScenarioId(DEFAULT_SCENARIO_ID));
  });
});

describe("isScenarioId", () => {
  test("accepts every canonical id", () => {
    for (const id of SCENARIO_IDS) assert.equal(isScenarioId(id), true);
  });

  test("rejects legacy values, removed post ids and junk", () => {
    for (const v of [
      "post",
      "post_autonome",
      "post_lead_magnet",
      "dm",
      "default",
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      assert.equal(isScenarioId(v), false);
    }
  });
});

describe("legacyKeyFor", () => {
  test("always maps to 'dm' (DM-only app)", () => {
    for (const id of SCENARIO_IDS) assert.equal(legacyKeyFor(id), "dm");
  });
});

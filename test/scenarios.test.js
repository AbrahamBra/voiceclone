import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SCENARIOS,
  SCENARIO_IDS,
  isScenarioId,
  legacyKeyFor,
  supportedCanonicalScenarios,
} from "../src/lib/scenarios.js";

// These values MUST stay in lockstep with the scenario_canonical Postgres
// enum (supabase/025_sprint0_foundation.sql). If you add/remove/rename here,
// you must ship a migration at the same time.
const EXPECTED_IDS = [
  "post_autonome",
  "post_lead_magnet",
  "post_actu",
  "post_prise_position",
  "post_framework",
  "post_cas_client",
  "post_coulisse",
  "DM_1st",
  "DM_relance",
  "DM_reply",
  "DM_closing",
];

describe("CANONICAL_SCENARIOS catalog", () => {
  test("exposes exactly the 11 canonical ids in roadmap+philosophy order", () => {
    assert.deepEqual([...SCENARIO_IDS], EXPECTED_IDS);
  });

  test("every entry has self-consistent id and a known kind", () => {
    for (const id of SCENARIO_IDS) {
      const def = CANONICAL_SCENARIOS[id];
      assert.equal(def.id, id, `id mismatch for ${id}`);
      assert.ok(def.kind === "post" || def.kind === "dm", `bad kind for ${id}`);
      assert.ok(def.label && def.label.length > 0, `missing label for ${id}`);
      assert.ok(
        def.legacyKey === "post" || def.legacyKey === "dm",
        `bad legacyKey for ${id}`
      );
    }
  });

  test("kind and legacyKey agree (post↔post, dm↔dm)", () => {
    for (const id of SCENARIO_IDS) {
      const { kind, legacyKey } = CANONICAL_SCENARIOS[id];
      assert.equal(kind, legacyKey, `kind≠legacyKey for ${id}`);
    }
  });

  test("catalog is frozen (cannot be mutated at runtime)", () => {
    assert.throws(() => {
      // @ts-expect-error — intentional mutation attempt
      CANONICAL_SCENARIOS.post_autonome = null;
    });
  });
});

describe("isScenarioId", () => {
  test("accepts every canonical id", () => {
    for (const id of SCENARIO_IDS) assert.equal(isScenarioId(id), true);
  });

  test("rejects legacy values and junk", () => {
    for (const v of ["post", "dm", "default", "", null, undefined, 42, {}]) {
      assert.equal(isScenarioId(v), false);
    }
  });
});

describe("legacyKeyFor", () => {
  test("maps post_* canonicals to 'post'", () => {
    const postIds = SCENARIO_IDS.filter((id) => id.startsWith("post_"));
    for (const id of postIds) assert.equal(legacyKeyFor(id), "post");
  });

  test("maps DM_* canonicals to 'dm'", () => {
    const dmIds = SCENARIO_IDS.filter((id) => id.startsWith("DM_"));
    for (const id of dmIds) assert.equal(legacyKeyFor(id), "dm");
  });
});

describe("supportedCanonicalScenarios", () => {
  test("type='posts' → all 7 post canonicals, no DM", () => {
    const ids = supportedCanonicalScenarios({ type: "posts" });
    assert.equal(ids.length, 7);
    assert.ok(ids.every((id) => CANONICAL_SCENARIOS[id].kind === "post"));
  });

  test("type='dm' → all 4 DM canonicals, no post", () => {
    const ids = supportedCanonicalScenarios({ type: "dm" });
    assert.equal(ids.length, 4);
    assert.ok(ids.every((id) => CANONICAL_SCENARIOS[id].kind === "dm"));
  });

  test("type='both' → all 11 canonicals", () => {
    const ids = supportedCanonicalScenarios({ type: "both" });
    assert.equal(ids.length, 11);
    assert.deepEqual([...ids].sort(), [...EXPECTED_IDS].sort());
  });

  test("legacy fallback: jsonb with 'post' key behaves like type='posts'", () => {
    const ids = supportedCanonicalScenarios({
      type: null,
      scenarios: { post: {}, default: {} },
    });
    assert.equal(ids.length, 7);
    assert.ok(ids.every((id) => CANONICAL_SCENARIOS[id].kind === "post"));
  });

  test("legacy fallback: jsonb with 'dm' key yields DM canonicals", () => {
    const ids = supportedCanonicalScenarios({
      type: null,
      scenarios: { dm: {} },
    });
    assert.equal(ids.length, 4);
    assert.ok(ids.every((id) => CANONICAL_SCENARIOS[id].kind === "dm"));
  });

  test("legacy fallback: jsonb with both 'post' and 'dm' yields all 11", () => {
    const ids = supportedCanonicalScenarios({
      type: null,
      scenarios: { post: {}, dm: {}, default: {} },
    });
    assert.equal(ids.length, 11);
  });

  test("empty persona (no type, no scenarios) → empty support set", () => {
    assert.deepEqual(supportedCanonicalScenarios({}), []);
  });

  test("legacy fallback: 'qualification' key treated as DM signal", () => {
    // Real-world case: Thomas/Paolo personas have {qualification, default}
    // as scenarios keys. Without type column, we still want DM canonicals.
    const ids = supportedCanonicalScenarios({
      type: null,
      scenarios: { qualification: {}, default: {} },
    });
    assert.equal(ids.length, 4);
    assert.ok(ids.every((id) => CANONICAL_SCENARIOS[id].kind === "dm"));
  });

  test("legacy fallback: ambiguous keys only ('default') → all 11 shown", () => {
    // "default" alone is ambiguous — both post and DM personas carry it.
    // Preferable to expose all and let user pick than to hide DM choices
    // from a DM-only persona (the bug that motivated this branch).
    const ids = supportedCanonicalScenarios({
      type: null,
      scenarios: { default: {} },
    });
    assert.equal(ids.length, 11);
  });

  test("returns a fresh array — mutating output must not affect SCENARIO_IDS", () => {
    const ids = supportedCanonicalScenarios({ type: "both" });
    ids.pop();
    assert.equal(SCENARIO_IDS.length, 11);
  });
});

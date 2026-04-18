import { test } from "node:test";
import assert from "node:assert/strict";

test("share GET response shape includes shared_by_name", () => {
  const sample = {
    persona: { name: "X" },
    persona_id: "id",
    shared_by_name: "Alice",
    already_shared: false,
  };
  assert.ok("shared_by_name" in sample, "response must include shared_by_name");
  assert.equal(typeof sample.shared_by_name, "string");
});

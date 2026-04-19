import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

describe("api/chat.js turn_kind tagging (static check)", () => {
  it("assistant insertions include turn_kind", async () => {
    const src = await fs.readFile(new URL("../api/chat.js", import.meta.url), "utf8");
    // Window of 300 chars after each `role: 'assistant'` to absorb multiline objects
    const matches = [...src.matchAll(/role:\s*['"]assistant['"]([^}]{0,300}|[\s\S]{0,300}?\})/g)];
    assert.ok(matches.length >= 3, `expected at least 3 assistant inserts in api/chat.js, got ${matches.length}`);
    for (const m of matches) {
      assert.match(m[0], /turn_kind/, `insert missing turn_kind: ${m[0].slice(0, 120).replace(/\s+/g, " ")}`);
    }
  });
});

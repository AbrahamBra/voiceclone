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

  // PostgREST normalizes columns across a batch insert: if row N has turn_kind,
  // row M gets turn_kind=null (not the DEFAULT), which violates NOT NULL and
  // drops the whole batch. Both rows in every user/assistant DB insert must
  // carry turn_kind explicitly. Regression eb923bd (2026-04-20).
  // Scoped to `{ conversation_id: ... role: "user" ... }` objects — ignores
  // in-memory prompt arrays passed to the LLM.
  it("user DB insertions include turn_kind", async () => {
    const src = await fs.readFile(new URL("../api/chat.js", import.meta.url), "utf8");
    const matches = [...src.matchAll(/\{\s*conversation_id[^}]{0,300}role:\s*['"]user['"][^}]{0,300}\}/g)];
    assert.ok(matches.length >= 3, `expected at least 3 user DB inserts in api/chat.js, got ${matches.length}`);
    for (const m of matches) {
      assert.match(m[0], /turn_kind/, `insert missing turn_kind: ${m[0].slice(0, 120).replace(/\s+/g, " ")}`);
    }
  });
});

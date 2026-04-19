import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

function makeRes() {
  let statusCode = 200, body;
  return {
    setHeader() { return this; },
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

describe("PATCH /api/conversations — dossier fields", () => {
  it("rejects PATCH without auth (before id validation)", async () => {
    const handler = (await import("../api/conversations.js")).default;
    const req = { method: "PATCH", query: {}, headers: {}, body: { prospect_name: "Marie" } };
    const res = makeRes();
    await handler(req, res);
    // Auth runs before id/body validation; expect 401 "Access code required"
    assert.equal(res.statusCode, 401);
  });

  it("handler source references prospect_name/stage/note", async () => {
    const src = await fs.readFile(new URL("../api/conversations.js", import.meta.url), "utf8");
    assert.match(src, /prospect_name/, "handler should reference prospect_name");
    assert.match(src, /\bstage\b/, "handler should reference stage");
    assert.match(src, /\bnote\b/, "handler should reference note");
  });
});

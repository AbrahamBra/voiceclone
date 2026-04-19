import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

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

describe("PATCH /api/messages", () => {
  it("rejects non-PATCH methods", async () => {
    const handler = (await import("../api/messages.js")).default;
    const req = { method: "GET", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });

  it("rejects without auth (before id validation)", async () => {
    const handler = (await import("../api/messages.js")).default;
    const req = { method: "PATCH", query: {}, headers: {}, body: { turn_kind: "toi" } };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });
});

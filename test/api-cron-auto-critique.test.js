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

describe("POST /api/cron-auto-critique", () => {
  it("returns 401 without bearer token", async () => {
    const handler = (await import("../api/cron-auto-critique.js")).default;
    const req = { method: "POST", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /unauthorized/i);
  });

  it("returns 401 with wrong bearer token", async () => {
    const handler = (await import("../api/cron-auto-critique.js")).default;
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "real-secret";
    try {
      const req = { method: "POST", query: {}, headers: { authorization: "Bearer wrong" } };
      const res = makeRes();
      await handler(req, res);
      assert.equal(res.statusCode, 401);
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  });
});

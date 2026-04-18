import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Integration tests are opt-in — only run if SUPABASE_URL and SUPABASE_SERVICE_ROLE are set.
const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);

describe("GET /api/heat", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("returns 400 when conversation_id is missing", async () => {
    const handler = (await import("../api/heat.js")).default;
    const req = { method: "GET", query: {}, headers: {} };
    let statusCode, body;
    const res = {
      setHeader() { return this; },
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; },
      end() { return this; },
    };
    await handler(req, res);
    assert.equal(statusCode, 400);
    assert.match(body.error, /conversation_id/i);
  });
});

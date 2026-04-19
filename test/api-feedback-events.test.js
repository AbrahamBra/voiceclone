import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);

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

describe("GET /api/feedback-events", () => {
  it("returns 400 when conversation id missing", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = { method: "GET", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /conversation/i);
  });

  it("returns 401 without access code", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = { method: "GET", query: { conversation: "00000000-0000-0000-0000-000000000000" }, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it("rejects unknown methods", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = { method: "PUT", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });
});

describe("POST /api/feedback-events", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("rejects invalid event_type", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = {
      method: "POST",
      query: {},
      headers: { "x-access-code": process.env.ADMIN_ACCESS_CODE || "admin" },
      body: { conversation_id: "00000000-0000-0000-0000-000000000000", message_id: "00000000-0000-0000-0000-000000000000", event_type: "nonsense" },
    };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /event_type/i);
  });

  it("accepts event_type='client_validated' (passes validation)", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = {
      method: "POST",
      query: {},
      headers: { "x-access-code": process.env.ADMIN_ACCESS_CODE || "admin" },
      body: { conversation_id: "00000000-0000-0000-0000-000000000000", message_id: "00000000-0000-0000-0000-000000000000", event_type: "client_validated" },
    };
    const res = makeRes();
    await handler(req, res);
    // Valid event_type → conversation lookup fails (fake UUID) → 404, not 400.
    assert.notEqual(res.statusCode, 400, "client_validated should not be rejected by validation");
    assert.equal(res.statusCode, 404);
  });
});

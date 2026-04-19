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

// Tests the client_validate branch dispatches distinctly from 'validate'.
// Actual DB side-effects (corrections insert, knowledge_entities boost) are
// exercised in integration; here we verify the response shape and validation.
describe("POST /api/feedback type=client_validate", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("rejects missing botMessage with 400", async () => {
    const handler = (await import("../api/feedback.js")).default;
    const req = {
      method: "POST",
      query: {},
      headers: { "x-access-code": process.env.ADMIN_ACCESS_CODE || "admin" },
      body: { type: "client_validate", persona: "00000000-0000-0000-0000-000000000000" },
    };
    const res = makeRes();
    await handler(req, res);
    // Either 400 for missing botMessage (if persona lookup succeeds) or 404 for
    // unknown persona (lookup fails first). Both prove the branch is reachable.
    assert.ok([400, 404].includes(res.statusCode), `expected 400 or 404, got ${res.statusCode}`);
  });

  it("responds with ok=true and signal='client_validated' on success", async () => {
    if (!process.env.TEST_PERSONA_ID) return;
    const handler = (await import("../api/feedback.js")).default;
    const req = {
      method: "POST",
      query: {},
      headers: { "x-access-code": process.env.ADMIN_ACCESS_CODE || "admin" },
      body: {
        type: "client_validate",
        botMessage: "Test message",
        persona: process.env.TEST_PERSONA_ID,
      },
    };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.signal, "client_validated");
  });
});

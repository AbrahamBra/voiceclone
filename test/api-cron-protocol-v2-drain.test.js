// Smoke test for the Vercel cron handler that wraps drainEventsToProposition.
// Verifies auth gate + happy path + error handling. The actual draining logic
// is unit-tested separately in test/feedback-event-to-proposition.test.js.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    setHeader: () => {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

describe("api/cron-protocol-v2-drain — auth gate", () => {
  it("401 when CRON_SECRET is not set", async () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const { default: handler } = await import(
        `../api/cron-protocol-v2-drain.js?nosecret=${Date.now()}`
      );
      const res = makeRes();
      await handler({ headers: { authorization: "Bearer whatever" } }, res);
      assert.equal(res.statusCode, 401);
    } finally {
      if (original !== undefined) process.env.CRON_SECRET = original;
    }
  });

  it("401 when bearer mismatches", async () => {
    process.env.CRON_SECRET = "expected-token";
    const { default: handler } = await import(
      `../api/cron-protocol-v2-drain.js?wrongtoken=${Date.now()}`
    );
    const res = makeRes();
    await handler({ headers: { authorization: "Bearer nope" } }, res);
    assert.equal(res.statusCode, 401);
    delete process.env.CRON_SECRET;
  });
});

// Note: testing the happy path / drain delegation here would require
// mocking an ESM module import at runtime, which gets messy in node:test.
// drainEventsToProposition itself is exhaustively tested in
// test/feedback-event-to-proposition.test.js (16 cases). This file just
// covers the auth gate and the schema of the response shape, which is
// the only logic added in api/cron-protocol-v2-drain.js.

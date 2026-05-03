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

// Wiring tests: the handler exposes a `__deps` object specifically so we can
// inject stub drains and verify both events + corrections drains are invoked.
// Without this, regression #X (corrections silently dropped) could re-occur
// without any test failing.

describe("api/cron-protocol-v2-drain — drain wiring", () => {
  async function loadHandler() {
    return await import(
      `../api/cron-protocol-v2-drain.js?wiring=${Date.now()}-${Math.random()}`
    );
  }

  function fakeSupabase() {
    return { from: () => ({ select: () => ({}) }), rpc: () => ({}) };
  }

  it("calls BOTH drainEvents and drainCorrections in default mode", async () => {
    process.env.CRON_SECRET = "tok";
    process.env.VOYAGE_API_KEY = "fake-for-availability-check";
    const mod = await loadHandler();
    const calls = { events: 0, corrections: 0, eventsArgs: null, correctionsArgs: null };
    mod.__deps.supabase = fakeSupabase();
    mod.__deps.isAvailable = () => true;
    mod.__deps.drainEvents = async (args) => {
      calls.events++;
      calls.eventsArgs = args;
      return { processed: 3, merged: 1, inserted: 1, silenced: 0, skipped: 1 };
    };
    mod.__deps.drainCorrections = async (args) => {
      calls.corrections++;
      calls.correctionsArgs = args;
      return { processed: 2, merged: 0, inserted: 1, silenced: 0, skipped: 1 };
    };

    const res = makeRes();
    await mod.default(
      { headers: { authorization: "Bearer tok" }, query: {} },
      res,
    );

    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(calls.events, 1, "drainEvents must be called");
    assert.equal(calls.corrections, 1, "drainCorrections must be called");
    // default lookback = 30 min
    assert.equal(calls.eventsArgs.lookbackMs, 30 * 60 * 1000);
    assert.equal(calls.correctionsArgs.lookbackMs, 30 * 60 * 1000);
    assert.equal(calls.eventsArgs.limit, 100);
    assert.equal(calls.correctionsArgs.limit, 100);

    // Response carries both summaries; legacy `summary` (events-only) preserved.
    assert.equal(res.body.events.processed, 3);
    assert.equal(res.body.corrections.processed, 2);
    assert.equal(res.body.summary.processed, 3);
    assert.equal(res.body.backfill, false);

    delete process.env.CRON_SECRET;
    delete process.env.VOYAGE_API_KEY;
  });

  it("widens lookback + limit when ?backfill=true", async () => {
    process.env.CRON_SECRET = "tok";
    process.env.VOYAGE_API_KEY = "fake";
    const mod = await loadHandler();
    let eventsArgs = null, correctionsArgs = null;
    mod.__deps.supabase = fakeSupabase();
    mod.__deps.isAvailable = () => true;
    mod.__deps.drainEvents = async (args) => {
      eventsArgs = args;
      return { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0 };
    };
    mod.__deps.drainCorrections = async (args) => {
      correctionsArgs = args;
      return { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0 };
    };

    const res = makeRes();
    await mod.default(
      {
        headers: { authorization: "Bearer tok" },
        query: { backfill: "true" },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.backfill, true);
    assert.equal(eventsArgs.lookbackMs, 30 * 24 * 60 * 60 * 1000);
    assert.equal(correctionsArgs.lookbackMs, 30 * 24 * 60 * 60 * 1000);
    assert.equal(eventsArgs.limit, 500);
    assert.equal(correctionsArgs.limit, 500);

    delete process.env.CRON_SECRET;
    delete process.env.VOYAGE_API_KEY;
  });

  it("backfill flag also parses from req.url querystring", async () => {
    process.env.CRON_SECRET = "tok";
    process.env.VOYAGE_API_KEY = "fake";
    const mod = await loadHandler();
    let eventsArgs = null;
    mod.__deps.supabase = fakeSupabase();
    mod.__deps.isAvailable = () => true;
    mod.__deps.drainEvents = async (args) => {
      eventsArgs = args;
      return { processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0 };
    };
    mod.__deps.drainCorrections = async () => ({
      processed: 0, merged: 0, inserted: 0, silenced: 0, skipped: 0,
    });

    const res = makeRes();
    await mod.default(
      {
        headers: { authorization: "Bearer tok" },
        url: "/api/cron-protocol-v2-drain?backfill=true",
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.backfill, true);
    assert.equal(eventsArgs.limit, 500);

    delete process.env.CRON_SECRET;
    delete process.env.VOYAGE_API_KEY;
  });
});

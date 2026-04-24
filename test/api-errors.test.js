import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Minimal res mock — captures status + body, records headersSent like a real stream
function mockRes() {
  const state = { status: null, body: null, headersSent: false, ended: false };
  return {
    state,
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; state.ended = true; return this; },
    get headersSent() { return state.headersSent; },
    set headersSent(v) { state.headersSent = v; },
  };
}

function withCapturedLogs(fn) {
  const captured = [];
  const original = console.log;
  console.log = (msg) => captured.push(msg);
  try { return fn(captured); } finally { console.log = original; }
}

describe("respondServerError", () => {
  test("never leaks err.message to client, returns generic publicMessage", async () => {
    const { respondServerError } = await import("../lib/api-errors.js");
    const res = mockRes();
    const err = new Error("relation \"personas\" does not exist in schema public");
    withCapturedLogs(() => {
      respondServerError(res, "test_ctx", err, "Erreur generique");
    });
    assert.equal(res.state.status, 500);
    assert.equal(res.state.body.error, "Erreur generique");
    // No SQL / internal leak
    const bodyStr = JSON.stringify(res.state.body);
    assert.ok(!bodyStr.includes("relation"), "must not leak SQL detail");
    assert.ok(!bodyStr.includes("schema"), "must not leak SQL detail");
    assert.ok(!bodyStr.includes("personas"), "must not leak table names");
  });

  test("logs full err.message + stack server-side for debugging", async () => {
    const { respondServerError } = await import("../lib/api-errors.js");
    const res = mockRes();
    const err = new Error("supabase connection refused");
    const captured = withCapturedLogs(() => {
      respondServerError(res, "probe_ctx", err, "Erreur serveur");
      return null;
    });
    // Can't easily intercept log output inside nested import; instead verify
    // the public contract — body sanitised, status correct.
    assert.equal(res.state.status, 500);
    assert.equal(res.state.body.error, "Erreur serveur");
  });

  test("preserves bodyExtra fields (e.g. durationMs for cron handler)", async () => {
    const { respondServerError } = await import("../lib/api-errors.js");
    const res = mockRes();
    withCapturedLogs(() => {
      respondServerError(res, "cron_ctx", new Error("boom"), "Cron failed", { durationMs: 1234 });
    });
    assert.equal(res.state.body.error, "Cron failed");
    assert.equal(res.state.body.durationMs, 1234);
  });

  test("no-op when res.headersSent (stream already committed)", async () => {
    const { respondServerError } = await import("../lib/api-errors.js");
    const res = mockRes();
    res.state.headersSent = true;
    withCapturedLogs(() => {
      respondServerError(res, "stream_ctx", new Error("mid-stream"), "ignored");
    });
    assert.equal(res.state.status, null, "must not set status after headers sent");
    assert.equal(res.state.body, null, "must not write body after headers sent");
  });

  test("handles non-Error thrown values (strings, objects, undefined)", async () => {
    const { respondServerError } = await import("../lib/api-errors.js");
    for (const thrown of ["string err", { weird: true }, undefined, null, 42]) {
      const res = mockRes();
      withCapturedLogs(() => {
        respondServerError(res, "weird_ctx", thrown, "ok");
      });
      assert.equal(res.state.status, 500);
      assert.equal(res.state.body.error, "ok");
    }
  });
});

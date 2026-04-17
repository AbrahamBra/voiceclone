import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// Capture console.log output. We reload the module per scenario so LOG_SILENT
// is picked up at import time.
function withCapturedLogs(fn) {
  const captured = [];
  const original = console.log;
  console.log = (msg) => captured.push(msg);
  try {
    return fn(captured);
  } finally {
    console.log = original;
  }
}

describe("log", () => {
  test("emits JSON with event, ts, and payload", async () => {
    const { log } = await import("../lib/log.js");
    withCapturedLogs((out) => {
      log("test_event", { persona: "p1", count: 5 });
      assert.equal(out.length, 1);
      const parsed = JSON.parse(out[0]);
      assert.equal(parsed.event, "test_event");
      assert.equal(parsed.persona, "p1");
      assert.equal(parsed.count, 5);
      assert.ok(typeof parsed.ts === "string" && parsed.ts.includes("T"));
    });
  });

  test("handles missing data arg", async () => {
    const { log } = await import("../lib/log.js");
    withCapturedLogs((out) => {
      log("naked_event");
      const parsed = JSON.parse(out[0]);
      assert.equal(parsed.event, "naked_event");
    });
  });

  test("recovers from circular payloads without throwing", async () => {
    const { log } = await import("../lib/log.js");
    const circular = {};
    circular.self = circular;
    withCapturedLogs((out) => {
      assert.doesNotThrow(() => log("circ", { circular }));
      const parsed = JSON.parse(out[0]);
      assert.equal(parsed.error, "log_serialize_failed");
    });
  });
});

describe("log silent mode", () => {
  const prev = process.env.LOG_SILENT;
  before(() => { process.env.LOG_SILENT = "1"; });
  after(() => {
    if (prev === undefined) delete process.env.LOG_SILENT;
    else process.env.LOG_SILENT = prev;
  });

  test("LOG_SILENT=1 suppresses output", async () => {
    // Fresh import so SILENT is re-read.
    const { log } = await import(`../lib/log.js?silent=${Date.now()}`);
    withCapturedLogs((out) => {
      log("should_not_appear", { x: 1 });
      assert.equal(out.length, 0);
    });
  });
});

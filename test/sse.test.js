import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { initSSE } from "../lib/sse.js";

function mockRes() {
  const headers = {};
  const events = new EventEmitter();
  const writes = [];
  return Object.assign(events, {
    setHeader: (k, v) => { headers[k] = v; },
    write: (chunk) => { writes.push(chunk); return true; },
    writableEnded: false,
    destroyed: false,
    _headers: headers,
    _writes: writes,
  });
}

// initSSE installs a 15s heartbeat setInterval cleared on res "close" / "finish".
// Tests that don't close the response leak the timer, which keeps node:test
// alive past assertions. Always emit "close" before the test ends.

test("sets SSE headers", () => {
  const res = mockRes();
  initSSE(res);
  assert.equal(res._headers["Content-Type"], "text/event-stream");
  assert.equal(res._headers["Cache-Control"], "no-cache");
  assert.equal(res._headers["Connection"], "keep-alive");
  res.emit("close");
});

test("send writes a data line; back-compat calling form works", () => {
  const res = mockRes();
  const sse = initSSE(res);
  sse("delta", { text: "hi" });
  assert.equal(res._writes[0], 'data: {"type":"delta","text":"hi"}\n\n');
  res.emit("close");
});

test("send drops writes after res.writableEnded", () => {
  const res = mockRes();
  const sse = initSSE(res);
  res.writableEnded = true;
  sse("delta", { text: "late" });
  assert.equal(res._writes.length, 0);
  res.emit("close");
});

test("signal fires when req emits 'close'", () => {
  const req = new EventEmitter();
  const res = mockRes();
  const sse = initSSE(res, req);
  assert.equal(sse.signal.aborted, false);
  req.emit("close");
  assert.equal(sse.signal.aborted, true);
  res.emit("close");
});

test("signal fires when res emits 'close'", () => {
  const req = new EventEmitter();
  const res = mockRes();
  const sse = initSSE(res, req);
  res.emit("close");
  assert.equal(sse.signal.aborted, true);
});

test("signal does not fire without req (legacy call)", () => {
  const res = mockRes();
  const sse = initSSE(res);
  assert.equal(sse.signal.aborted, false);
  res.emit("close");
});

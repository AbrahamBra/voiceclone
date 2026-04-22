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

test("sets SSE headers", () => {
  const res = mockRes();
  initSSE(res);
  assert.equal(res._headers["Content-Type"], "text/event-stream");
  assert.equal(res._headers["Cache-Control"], "no-cache");
  assert.equal(res._headers["Connection"], "keep-alive");
});

test("send writes a data line; back-compat calling form works", () => {
  const res = mockRes();
  const sse = initSSE(res);
  sse("delta", { text: "hi" });
  assert.equal(res._writes[0], 'data: {"type":"delta","text":"hi"}\n\n');
});

test("send drops writes after res.writableEnded", () => {
  const res = mockRes();
  const sse = initSSE(res);
  res.writableEnded = true;
  sse("delta", { text: "late" });
  assert.equal(res._writes.length, 0);
});

test("signal fires when req emits 'close'", () => {
  const req = new EventEmitter();
  const res = mockRes();
  const sse = initSSE(res, req);
  assert.equal(sse.signal.aborted, false);
  req.emit("close");
  assert.equal(sse.signal.aborted, true);
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
});

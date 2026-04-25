import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Dependency-injection pattern (same as test/api-v2-protocol.test.js + propositions).
// Realtime is stubbed via deps.realtimeFactory : the stub captures handlers
// passed by the endpoint and exposes them so tests can fire events manually.

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const PERSONA_ID = "pers-1";
const SECTION_ID = "sec-aaaa";
const OTHER_DOC_ID = "22222222-2222-2222-2222-222222222222";

function makeRes() {
  const chunks = [];
  const onHandlers = {};
  return {
    statusCode: 200,
    _body: null,
    chunks,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    flushHeaders() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { return this; },
    write(s) { chunks.push(s); return true; },
    on(ev, cb) { onHandlers[ev] = cb; },
    _trigger(ev, ...args) { onHandlers[ev]?.(...args); },
    output() { return chunks.join(""); },
  };
}

function makeReq(query = {}, method = "GET") {
  const onHandlers = {};
  return {
    method,
    query,
    headers: {},
    on(ev, cb) { onHandlers[ev] = cb; },
    _close() { onHandlers.close?.(); },
  };
}

function makeRealtimeStub() {
  const stub = {
    closed: false,
    handlers: null,
    sb: null,
    factory: (sb, opts) => {
      stub.sb = sb;
      stub.handlers = opts;
      return { close: () => { stub.closed = true; } };
    },
    fireArtifact(payload) { stub.handlers.onArtifactFired(payload); },
    firePropCreated(payload) { stub.handlers.onPropositionCreated(payload); },
    firePropResolved(payload) { stub.handlers.onPropositionResolved(payload); },
  };
  return stub;
}

function makeIntervalStub() {
  const stub = {
    callbacks: [],
    cleared: 0,
    setInterval: (fn) => {
      const id = stub.callbacks.length + 1;
      stub.callbacks.push({ id, fn });
      return id;
    },
    clearInterval: () => { stub.cleared += 1; },
    tick() { stub.callbacks.forEach((c) => c.fn()); },
  };
  return stub;
}

function baseDeps(overrides = {}) {
  const realtime = overrides.realtime ?? makeRealtimeStub();
  const interval = overrides.interval ?? makeIntervalStub();
  return {
    realtime,
    interval,
    deps: {
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
      hasPersonaAccess: async () => true,
      supabase: {},
      setCors: () => {},
      getDocumentPersonaId: async () => PERSONA_ID,
      listSectionIds: async () => [SECTION_ID],
      fetchInitialSnapshot: async () => [
        { kind: "artifact_fired", artifact_id: "a1", section_id: SECTION_ID, occurred_at: "2026-04-25T10:00:00Z" },
      ],
      realtimeFactory: realtime.factory,
      pingIntervalMs: 25000,
      setIntervalFn: interval.setInterval,
      clearIntervalFn: interval.clearInterval,
      ...(overrides.depOverrides || {}),
    },
  };
}

async function loadHandler() {
  const { default: handler } = await import("../api/v2/protocol/stream.js");
  return handler;
}

function lastEvent(res) {
  const out = res.output();
  const m = [...out.matchAll(/event: (\w+)\ndata: (.*?)\n\n/g)];
  return m.length ? { event: m[m.length - 1][1], data: JSON.parse(m[m.length - 1][2]) } : null;
}

function allEvents(res) {
  const out = res.output();
  return [...out.matchAll(/event: (\w+)\ndata: (.*?)\n\n/g)].map((m) => ({
    event: m[1],
    data: JSON.parse(m[2]),
  }));
}

describe("GET /api/v2/protocol/stream — request validation", () => {
  it("rejects non-GET methods with 405", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps();
    await handler(makeReq({}, "POST"), res, deps);
    assert.equal(res.statusCode, 405);
  });

  it("handles OPTIONS preflight with 200", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps();
    await handler(makeReq({}, "OPTIONS"), res, deps);
    assert.equal(res.statusCode, 200);
  });

  it("returns 400 when document is missing", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps();
    await handler(makeReq({}), res, deps);
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /document/i);
  });

  it("returns 400 when document is not a uuid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps();
    await handler(makeReq({ document: "not-a-uuid" }), res, deps);
    assert.equal(res.statusCode, 400);
  });
});

describe("GET /api/v2/protocol/stream — auth", () => {
  it("returns 401 when authenticateRequest throws status 401", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps({
      depOverrides: {
        authenticateRequest: async () => { throw { status: 401, error: "no token" }; },
      },
    });
    await handler(makeReq({ document: DOC_ID }), res, deps);
    assert.equal(res.statusCode, 401);
  });

  it("returns 403 when client lacks persona access", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps({
      depOverrides: {
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
        hasPersonaAccess: async () => false,
      },
    });
    await handler(makeReq({ document: DOC_ID }), res, deps);
    assert.equal(res.statusCode, 403);
  });

  it("returns 404 when document is not found", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const { deps } = baseDeps({
      depOverrides: { getDocumentPersonaId: async () => null },
    });
    await handler(makeReq({ document: DOC_ID }), res, deps);
    assert.equal(res.statusCode, 404);
  });
});

describe("GET /api/v2/protocol/stream — SSE stream", () => {
  it("writes SSE headers and an init event with the snapshot", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const req = makeReq({ document: DOC_ID });
    const ctx = baseDeps();
    const p = handler(req, res, ctx.deps);

    // Allow handler to write init synchronously after awaits.
    await new Promise((r) => setImmediate(r));

    assert.equal(res.headers["Content-Type"], "text/event-stream");
    assert.match(res.headers["Cache-Control"], /no-cache/);
    const events = allEvents(res);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "init");
    assert.equal(events[0].data.recent[0].artifact_id, "a1");

    req._close();
    await p;
  });

  it("emits 'ping' when the keep-alive interval fires", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const req = makeReq({ document: DOC_ID });
    const ctx = baseDeps();
    const p = handler(req, res, ctx.deps);
    await new Promise((r) => setImmediate(r));

    ctx.interval.tick();
    const last = lastEvent(res);
    assert.equal(last.event, "ping");
    assert.ok(typeof last.data.t === "number");

    req._close();
    await p;
  });

  it("emits 'artifact_fired' from the realtime channel for our document's sections", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const req = makeReq({ document: DOC_ID });
    const ctx = baseDeps();
    const p = handler(req, res, ctx.deps);
    await new Promise((r) => setImmediate(r));

    ctx.realtime.fireArtifact({
      new: {
        id: "art-1",
        source_section_id: SECTION_ID,
        stats: { last_fired_at: "2026-04-25T11:00:00Z" },
      },
    });
    // Ignored: artifact from another section.
    ctx.realtime.fireArtifact({
      new: { id: "art-2", source_section_id: "other-sec", stats: { last_fired_at: "2026-04-25T11:00:01Z" } },
    });

    const evts = allEvents(res).filter((e) => e.event === "artifact_fired");
    assert.equal(evts.length, 1);
    assert.equal(evts[0].data.artifact_id, "art-1");
    assert.equal(evts[0].data.section_id, SECTION_ID);
    assert.equal(evts[0].data.fired_at, "2026-04-25T11:00:00Z");

    req._close();
    await p;
  });

  it("emits 'proposition_created' for our document and ignores foreign documents", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const req = makeReq({ document: DOC_ID });
    const ctx = baseDeps();
    const p = handler(req, res, ctx.deps);
    await new Promise((r) => setImmediate(r));

    ctx.realtime.firePropCreated({
      new: { id: "p1", document_id: DOC_ID, target_kind: "hard_rules", count: 3 },
    });
    ctx.realtime.firePropCreated({
      new: { id: "p2", document_id: OTHER_DOC_ID, target_kind: "hard_rules", count: 1 },
    });

    const evts = allEvents(res).filter((e) => e.event === "proposition_created");
    assert.equal(evts.length, 1);
    assert.equal(evts[0].data.id, "p1");
    assert.equal(evts[0].data.target_kind, "hard_rules");
    assert.equal(evts[0].data.count, 3);

    req._close();
    await p;
  });

  it("emits 'proposition_resolved' only when status changes", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const req = makeReq({ document: DOC_ID });
    const ctx = baseDeps();
    const p = handler(req, res, ctx.deps);
    await new Promise((r) => setImmediate(r));

    // Status changed pending → accepted.
    ctx.realtime.firePropResolved({
      new: { id: "p1", document_id: DOC_ID, status: "accepted" },
      old: { id: "p1", document_id: DOC_ID, status: "pending" },
    });
    // Same status — should be ignored.
    ctx.realtime.firePropResolved({
      new: { id: "p1", document_id: DOC_ID, status: "accepted" },
      old: { id: "p1", document_id: DOC_ID, status: "accepted" },
    });
    // Different doc — ignored.
    ctx.realtime.firePropResolved({
      new: { id: "p2", document_id: OTHER_DOC_ID, status: "rejected" },
      old: { id: "p2", document_id: OTHER_DOC_ID, status: "pending" },
    });

    const evts = allEvents(res).filter((e) => e.event === "proposition_resolved");
    assert.equal(evts.length, 1);
    assert.equal(evts[0].data.id, "p1");
    assert.equal(evts[0].data.status, "accepted");

    req._close();
    await p;
  });

  it("clears the ping interval and closes the realtime channel on disconnect", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const req = makeReq({ document: DOC_ID });
    const ctx = baseDeps();
    const p = handler(req, res, ctx.deps);
    await new Promise((r) => setImmediate(r));

    assert.equal(ctx.interval.cleared, 0);
    assert.equal(ctx.realtime.closed, false);

    req._close();
    await p;

    assert.equal(ctx.interval.cleared, 1);
    assert.equal(ctx.realtime.closed, true);
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Dependency-injection pattern: the handler accepts an optional `deps` arg
// so tests can stub auth + db access. In production (Vercel), Node calls
// `handler(req, res)` with 2 args and the handler falls back to real imports.
//
// Chose this over `mock.module()` because the project test runner (`node --test`)
// does not pass `--experimental-test-module-mocks`, so `mock.module` is undefined.
// Pattern matches `lib/protocol-v2-db.js` which already takes `sb` as first arg.

function makeRes() {
  return {
    statusCode: 200,
    _body: null,
    setHeader() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { return this; },
  };
}

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    supabase: {},
    setCors: () => {},
    getActiveDocument: async () => ({ id: "d1", version: 2, status: "active" }),
    listSections: async () => [],
    listArtifacts: async () => [],
    countPendingPropositions: async () => 0,
    ...overrides,
  };
}

describe("GET /api/v2/protocol", () => {
  it("returns 400 when persona is missing", async () => {
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /persona is required/i);
  });

  it("returns 403 when access is denied", async () => {
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: { persona: "p1" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    }));
    assert.equal(res.statusCode, 403);
  });

  it("returns document + sections + artifacts for authorized persona", async () => {
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: { persona: "p1" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      getActiveDocument: async () => ({ id: "d1", version: 2, status: "active" }),
      listSections: async () => [
        { id: "s1", document_id: "d1", kind: "hard_rules", prose: "...", order: 0 },
      ],
      listArtifacts: async () => [
        { id: "a1", source_section_id: "s1", kind: "hard_check", is_active: true },
      ],
      countPendingPropositions: async () => 3,
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(res._body.document.id, "d1");
    assert.equal(res._body.sections.length, 1);
    assert.equal(res._body.sections[0].artifacts.length, 1);
    assert.equal(res._body.pendingPropositionsCount, 3);
  });

  it("returns empty shape when persona has no active document", async () => {
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: { persona: "pNew" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      getActiveDocument: async () => null,
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(res._body.document, null);
    assert.deepEqual(res._body.sections, []);
    assert.equal(res._body.pendingPropositionsCount, 0);
  });

  it("rejects non-GET methods with 405", async () => {
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "POST", query: { persona: "p1" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });
});

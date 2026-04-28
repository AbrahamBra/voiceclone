import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Same dependency-injection pattern as test/api-v2-protocol.test.js and
// test/api-v2-propositions.test.js. The handler accepts a `deps` 3rd arg so
// we can stub auth + the supabase client + the publishDraft helper.

function makeRes() {
  return {
    statusCode: 200,
    _body: null,
    _ended: false,
    setHeader() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { this._ended = true; return this; },
  };
}

function makeSupabase(config) {
  return {
    from(table) {
      const tableConfig = config[table] || {};
      const builder = {
        _filter: {},
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        async single() {
          const rows = (tableConfig.rows || []).filter((r) =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v),
          );
          const match = rows[0];
          return { data: match || null, error: match ? null : { code: "PGRST116" } };
        },
      };
      return builder;
    },
  };
}

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const ARCHIVED_ID = "22222222-2222-2222-2222-222222222222";
const PERSONA_ID = "p-1";
const CLIENT_ID = "c-1";

function baseDeps(overrides = {}) {
  const calls = { publishDraft: [] };
  const deps = {
    authenticateRequest: async () => ({ client: { id: CLIENT_ID }, isAdmin: false }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: makeSupabase({
      protocol_document: {
        rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
      },
    }),
    publishDraft: async (_sb, args) => {
      calls.publishDraft.push(args);
      return {
        document: { id: args.documentId, status: "active", version: 2 },
        archived_document_id: ARCHIVED_ID,
        stats_migrated: 3,
      };
    },
    _calls: calls,
    ...overrides,
  };
  return deps;
}

async function loadHandler() {
  const mod = await import("../api/v2/protocol/publish.js");
  return mod.default;
}

describe("POST /api/v2/protocol/publish", () => {
  it("returns 405 on GET", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET" }, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("returns 200 + ends on OPTIONS (CORS preflight)", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "OPTIONS" }, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._ended, true);
  });

  it("returns 400 when documentId missing", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "POST", body: {} }, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /documentId/i);
  });

  it("returns 400 when documentId is not a uuid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "POST", body: { documentId: "not-a-uuid" } }, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 403 from authenticateRequest failure", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      authenticateRequest: async () => { throw { status: 401, error: "no token" }; },
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 401);
  });

  it("returns 404 when document is not found", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({ protocol_document: { rows: [] } }),
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 404);
  });

  it("returns 404 when document owner_kind is not 'persona'", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "template", owner_id: "tpl-1" }],
        },
      }),
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 404);
  });

  it("returns 403 when caller has no access to the persona", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      hasPersonaAccess: async () => false,
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 403);
  });

  it("returns 200 + payload on happy path; calls publishDraft with documentId", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.document.id, DOC_ID);
    assert.equal(res._body.document.status, "active");
    assert.equal(res._body.archived_document_id, ARCHIVED_ID);
    assert.equal(res._body.stats_migrated, 3);
    // publishDraft now receives a 3-key payload (documentId, publishedBy, and a
    // bound narrator). Assert the substantive contract without pinning the
    // narrator's function reference.
    assert.equal(deps._calls.publishDraft.length, 1);
    assert.equal(deps._calls.publishDraft[0].documentId, DOC_ID);
    assert.equal(deps._calls.publishDraft[0].publishedBy, CLIENT_ID);
    assert.equal(typeof deps._calls.publishDraft[0].generateNarrative, "function");
  });

  it("admin bypasses hasPersonaAccess", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      authenticateRequest: async () => ({ client: { id: CLIENT_ID }, isAdmin: true }),
      hasPersonaAccess: async () => false,
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 200);
  });

  it("maps publishDraft NOT_A_DRAFT error to 409", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      publishDraft: async () => ({ error: "document status is not 'draft'" }),
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 409);
    assert.match(res._body.error, /draft/i);
  });

  it("maps publishDraft DRAFT_MISSING error to 404", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      publishDraft: async () => ({ error: "draft document not found" }),
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 404);
  });

  it("maps any other publishDraft error to 500", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      publishDraft: async () => ({ error: "publish failed: could not flip draft to active" }),
    });
    await handler({ method: "POST", body: { documentId: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 500);
  });
});

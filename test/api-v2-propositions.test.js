import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Dependency-injection pattern: the handler accepts an optional `deps` arg
// so tests can stub auth + the supabase client. Same pattern as
// test/api-v2-protocol.test.js (mock.module isn't available without
// --experimental-test-module-mocks, which the project runner doesn't pass).

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

// Chainable supabase stub. Each `from(table)` returns a builder that captures
// filters, then resolves via `.single()` / thenable / `.update(...).select().single()`.
// Tests pass a config keyed by table — rows to return for reads, or an update
// sink and return value for writes.
function makeSupabase(config) {
  const writes = [];
  const sb = {
    _writes: writes,
    from(table) {
      const tableConfig = config[table] || {};
      const builder = {
        _table: table,
        _filter: {},
        _pendingUpdate: null,
        _orderBy: null,
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        order(col, opts) { this._orderBy = { col, opts }; return this; },
        update(patch) { this._pendingUpdate = patch; return this; },
        _resolveRows() {
          const rows = tableConfig.rows || [];
          return rows.filter(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
        },
        async single() {
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter }, patch: this._pendingUpdate });
            const updated = tableConfig.onUpdate
              ? tableConfig.onUpdate(this._filter, this._pendingUpdate)
              : null;
            const err = tableConfig.updateError || null;
            return { data: updated, error: err };
          }
          const matches = this._resolveRows();
          const match = matches[0];
          if (!match && tableConfig.singleError) {
            return { data: null, error: tableConfig.singleError };
          }
          return { data: match || null, error: match ? null : { code: "PGRST116" } };
        },
        then(resolve) {
          const matches = this._resolveRows();
          resolve({ data: matches, error: tableConfig.listError || null });
        },
      };
      return builder;
    },
  };
  return sb;
}

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "22222222-2222-2222-2222-222222222222";
const PERSONA_ID = "pers-1";

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: makeSupabase({
      protocol_document: {
        rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
      },
      proposition: {
        rows: [
          { id: PROP_ID, document_id: DOC_ID, status: "pending",
            source: "feedback_event", intent: "add_rule", target_kind: "hard_rules",
            proposed_text: "old", confidence: 0.8 },
        ],
        onUpdate: (filter, patch) => ({
          id: filter.id, document_id: DOC_ID, ...patch,
          source: "feedback_event", intent: "add_rule", target_kind: "hard_rules",
          confidence: 0.8,
        }),
      },
    }),
    ...overrides,
  };
}

async function loadHandler() {
  const { default: handler } = await import("../api/v2/propositions.js");
  return handler;
}

describe("GET /api/v2/propositions", () => {
  it("returns 400 when document is missing", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /document/i);
  });

  it("returns 400 when document is not a uuid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: { document: "not-a-uuid" } }, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when status is not in enum", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID, status: "bogus" } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 when document does not exist", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID } },
      res,
      baseDeps({ supabase: makeSupabase({ protocol_document: { rows: [] } }) }),
    );
    assert.equal(res.statusCode, 404);
  });

  it("returns 403 when client lacks persona access", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID, status: "pending" } },
      res,
      baseDeps({
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
        hasPersonaAccess: async () => false,
      }),
    );
    assert.equal(res.statusCode, 403);
  });

  it("returns propositions filtered by document + status", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID, status: "pending" } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.propositions.length, 1);
    assert.equal(res._body.propositions[0].id, PROP_ID);
  });

  it("returns all statuses when status query is omitted", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }] },
        proposition: {
          rows: [
            { id: "p1", document_id: DOC_ID, status: "pending" },
            { id: "p2", document_id: DOC_ID, status: "accepted" },
          ],
        },
      }),
    });
    await handler({ method: "GET", query: { document: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.propositions.length, 2);
  });
});

describe("POST /api/v2/propositions", () => {
  it("returns 400 when action is invalid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "nope", id: PROP_ID } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /action/i);
  });

  it("returns 400 when id is missing or not a uuid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: "no" } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when revise lacks proposed_text", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "revise", id: PROP_ID } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /proposed_text/i);
  });

  it("returns 404 when proposition does not exist", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const missingId = "99999999-9999-9999-9999-999999999999";
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: missingId } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 404);
  });

  it("returns 403 when client lacks persona access", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      baseDeps({
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
        hasPersonaAccess: async () => false,
      }),
    );
    assert.equal(res.statusCode, 403);
  });

  it("accept sets status=accepted and resolved_at, returns updated row", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID, user_note: "ok" } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "accepted");
    assert.ok(res._body.proposition.resolved_at);
    assert.equal(res._body.proposition.user_note, "ok");

    const writes = deps.supabase._writes.filter(w => w.table === "proposition");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].patch.status, "accepted");
    assert.ok(writes[0].patch.resolved_at);
    assert.equal(writes[0].patch.user_note, "ok");
  });

  it("reject sets status=rejected and resolved_at", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "reject", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "rejected");
    assert.ok(res._body.proposition.resolved_at);

    const write = deps.supabase._writes.find(w => w.table === "proposition");
    assert.equal(write.patch.status, "rejected");
  });

  it("revise sets status=revised, updates proposed_text, sets resolved_at", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      {
        method: "POST",
        query: {},
        body: { action: "revise", id: PROP_ID, proposed_text: "  new text  ", user_note: "tweaked" },
      },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "revised");
    assert.equal(res._body.proposition.proposed_text, "new text");

    const write = deps.supabase._writes.find(w => w.table === "proposition");
    assert.equal(write.patch.status, "revised");
    assert.equal(write.patch.proposed_text, "new text");
    assert.ok(write.patch.resolved_at);
  });
});

describe("OPTIONS + method handling", () => {
  it("handles OPTIONS preflight with 200", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "OPTIONS", query: {} }, res, baseDeps());
    assert.equal(res.statusCode, 200);
  });

  it("rejects PUT with 405", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "PUT", query: {}, body: {} }, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });
});

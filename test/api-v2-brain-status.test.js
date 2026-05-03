import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/brain-status.js";

// Same DI pattern as test/api-v2-propositions.test.js, with `.is()` support
// added for the `reverted_at IS NULL` / `resolved_at IS NULL` filters that
// brain-status uses against proposition_contradiction and
// proposition_merge_history.

function makeRes() {
  return {
    statusCode: 200, _body: null,
    setHeader() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { return this; },
  };
}

function makeSupabase(config) {
  const sb = {
    from(table) {
      const tc = config[table] || {};
      const builder = {
        _filterEq: {}, _filterIs: {}, _filterIn: {},
        select() { return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        is(col, val) { this._filterIs[col] = val; return this; },
        in(col, vals) { this._filterIn[col] = vals; return this; },
        order() { return this; },
        _resolveRows() {
          const rows = tc.rows || [];
          return rows.filter(r => {
            for (const [k, v] of Object.entries(this._filterEq)) {
              if (r[k] !== v) return false;
            }
            for (const [k, v] of Object.entries(this._filterIs)) {
              if (v === null && r[k] !== null && r[k] !== undefined) return false;
            }
            for (const [k, vals] of Object.entries(this._filterIn)) {
              if (!vals.includes(r[k])) return false;
            }
            return true;
          });
        },
        async maybeSingle() {
          const m = this._resolveRows();
          return { data: m[0] || null, error: null };
        },
        async single() {
          const m = this._resolveRows();
          return m[0]
            ? { data: m[0], error: null }
            : { data: null, error: { code: "PGRST116" } };
        },
        then(resolve) {
          resolve({ data: this._resolveRows(), error: null });
        },
      };
      return builder;
    },
  };
  return sb;
}

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "22222222-2222-2222-2222-222222222222";

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    protocol_document: {
      rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active" }],
    },
    proposition: {
      rows: [
        // 3 pending doc, 2 pending chat, 1 accepted (excluded)
        { id: "p1", document_id: DOC_ID, status: "pending", source: "upload_batch" },
        { id: "p2", document_id: DOC_ID, status: "pending", source: "upload_batch" },
        { id: "p3", document_id: DOC_ID, status: "pending", source: "playbook_extraction" },
        { id: "p4", document_id: DOC_ID, status: "pending", source: "feedback_event" },
        { id: "p5", document_id: DOC_ID, status: "pending", source: "chat_rewrite" },
        { id: "p6", document_id: DOC_ID, status: "accepted", source: "upload_batch" },
      ],
    },
    proposition_contradiction: {
      rows: [
        { id: "c1", persona_id: PERSONA_ID, status: "open" },
        { id: "c2", persona_id: PERSONA_ID, status: "open" },
        { id: "c3", persona_id: PERSONA_ID, status: "resolved" },
      ],
    },
    proposition_merge_history: {
      rows: [
        { id: "m1", persona_id: PERSONA_ID, reverted_at: null },
        { id: "m2", persona_id: PERSONA_ID, reverted_at: null },
        { id: "m3", persona_id: PERSONA_ID, reverted_at: "2026-05-01T00:00:00Z" },
      ],
    },
    protocol_section: {
      rows: [
        { id: "s1", document_id: DOC_ID, kind: "identity",     prose: "lorem ipsum" },
        { id: "s2", document_id: DOC_ID, kind: "icp_patterns", prose: "patterns…" },
        { id: "s3", document_id: DOC_ID, kind: "scoring",      prose: "" },
        { id: "s4", document_id: DOC_ID, kind: "process",      prose: "" },
        { id: "s5", document_id: DOC_ID, kind: "templates",    prose: "" },
        { id: "s6", document_id: DOC_ID, kind: "hard_rules",   prose: "" },
        { id: "s7", document_id: DOC_ID, kind: "errors",       prose: "" },
      ],
    },
  });
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase,
    ...overrides,
  };
}

describe("GET /api/v2/brain-status", () => {
  it("returns 200 with all 7 counts for a valid persona", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.persona_id, PERSONA_ID);
    assert.deepEqual(res._body.counts, {
      contradictions_open: 2,
      propositions_pending: 5,
      propositions_pending_doc: 3,
      propositions_pending_chat: 2,
      auto_merged: 2,
      doctrine_sections_filled: 2,
      doctrine_sections_total: 7,
    });
  });

  it("returns 400 if persona param missing", async () => {
    const req = { method: "GET", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /persona/i);
  });

  it("returns 400 if persona is not a UUID", async () => {
    const req = { method: "GET", query: { persona: "not-a-uuid" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 403 if hasPersonaAccess returns false (non-admin)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, {
      ...baseDeps(),
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    });
    assert.equal(res.statusCode, 403);
  });

  it("returns 404 if persona has no active protocol_document", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [] },
        proposition: { rows: [] },
        proposition_contradiction: { rows: [] },
        proposition_merge_history: { rows: [] },
        protocol_section: { rows: [] },
      }),
    }));
    assert.equal(res.statusCode, 404);
  });

  it("returns zeros (not error) when tables are empty but doc exists", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active" }] },
        proposition: { rows: [] },
        proposition_contradiction: { rows: [] },
        proposition_merge_history: { rows: [] },
        protocol_section: { rows: [] },
      }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.counts.contradictions_open, 0);
    assert.equal(res._body.counts.propositions_pending, 0);
    assert.equal(res._body.counts.doctrine_sections_filled, 0);
    assert.equal(res._body.counts.doctrine_sections_total, 0);
  });

  it("returns 405 on non-GET methods", async () => {
    const req = { method: "POST", query: { persona: PERSONA_ID }, headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });
});

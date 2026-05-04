import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/propositions-distribution.js";

// Same DI pattern as test/api-v2-brain-status.test.js.
// Buckets verrouillés : 11 buckets de 1.00 → 0.50 par pas de 0.05.
// Chaque entrée [bucket_min, count_pending_with_confidence_>=_bucket_min]
// (cumulatif descendant).

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

const EXPECTED_BUCKETS = [1.00, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50];
const EXPECTED_KINDS = ["all", "identity", "icp_patterns", "scoring", "process",
                        "templates", "hard_rules", "errors", "custom"];

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    protocol_document: {
      rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active" }],
    },
    proposition: {
      rows: [
        // 5 hard_rules : 2 @ 0.95, 1 @ 0.85, 1 @ 0.70, 1 @ 0.55
        { id: "p1", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.95 },
        { id: "p2", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.95 },
        { id: "p3", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.85 },
        { id: "p4", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.70 },
        { id: "p5", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.55 },
        // 2 identity : 1 @ 0.90, 1 @ 0.65
        { id: "p6", document_id: DOC_ID, status: "pending", target_kind: "identity", confidence: 0.90 },
        { id: "p7", document_id: DOC_ID, status: "pending", target_kind: "identity", confidence: 0.65 },
        // 1 accepted (excluded from pending count)
        { id: "p8", document_id: DOC_ID, status: "accepted", target_kind: "hard_rules", confidence: 1.00 },
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

describe("GET /api/v2/propositions-distribution", () => {
  it("returns 200 with shape { all, identity, ..., custom } and 11 buckets each", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.persona_id, PERSONA_ID);
    for (const k of EXPECTED_KINDS) {
      assert.ok(Array.isArray(res._body.distribution[k]), `kind ${k} should be array`);
      assert.equal(res._body.distribution[k].length, 11, `kind ${k} should have 11 buckets`);
      // Bucket order: descending from 1.00 to 0.50
      for (let i = 0; i < 11; i++) {
        assert.equal(res._body.distribution[k][i][0], EXPECTED_BUCKETS[i],
          `kind ${k} bucket ${i} should be ${EXPECTED_BUCKETS[i]}`);
      }
    }
  });

  it("counts cumulatively : props @ 0.95 also count in 0.90, 0.85, …, 0.50 buckets", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const all = res._body.distribution.all;
    // all : 7 pending props total (5 hard_rules + 2 identity)
    // @1.00 = 0
    // @0.95 = 2 (p1, p2)
    // @0.90 = 3 (p1, p2, p6)
    // @0.85 = 4 (p1, p2, p3, p6)
    // @0.80 = 4
    // @0.75 = 4
    // @0.70 = 5 (+ p4)
    // @0.65 = 6 (+ p7)
    // @0.60 = 6
    // @0.55 = 7 (+ p5)
    // @0.50 = 7
    assert.deepEqual(all, [
      [1.00, 0], [0.95, 2], [0.90, 3], [0.85, 4],
      [0.80, 4], [0.75, 4], [0.70, 5], [0.65, 6],
      [0.60, 6], [0.55, 7], [0.50, 7],
    ]);
  });

  it("split per target_kind correctly (hard_rules vs identity)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const hr = res._body.distribution.hard_rules;
    const id = res._body.distribution.identity;
    // hard_rules : 5 props (p1@0.95, p2@0.95, p3@0.85, p4@0.70, p5@0.55)
    assert.deepEqual(hr, [
      [1.00, 0], [0.95, 2], [0.90, 2], [0.85, 3],
      [0.80, 3], [0.75, 3], [0.70, 4], [0.65, 4],
      [0.60, 4], [0.55, 5], [0.50, 5],
    ]);
    // identity : 2 props (p6@0.90, p7@0.65)
    assert.deepEqual(id, [
      [1.00, 0], [0.95, 0], [0.90, 1], [0.85, 1],
      [0.80, 1], [0.75, 1], [0.70, 1], [0.65, 2],
      [0.60, 2], [0.55, 2], [0.50, 2],
    ]);
  });

  it("returns all-zero buckets for kinds with no pending props", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const empty = res._body.distribution.scoring;
    assert.equal(empty.length, 11);
    assert.ok(empty.every(b => b[1] === 0), "scoring should be all zeros");
  });

  it("returns 400 if persona is not a UUID", async () => {
    const req = { method: "GET", query: { persona: "not-a-uuid" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 if persona has no active protocol_document", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [] },
        proposition: { rows: [] },
      }),
    }));
    assert.equal(res.statusCode, 404);
  });

  it("returns 403 for non-admin without persona access", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, {
      ...baseDeps(),
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    });
    assert.equal(res.statusCode, 403);
  });

  it("REGRESSION : ignores playbook docs (source_core != NULL), uses global doc only", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [
            { id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: null },
            { id: "pb-spyer", owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: "spyer" },
          ],
        },
        proposition: {
          rows: [
            { id: "p1", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.95 },
            // Cette prop attachée au playbook doit être IGNORÉE
            { id: "px", document_id: "pb-spyer", status: "pending", target_kind: "hard_rules", confidence: 0.95 },
          ],
        },
      }),
    }));
    assert.equal(res.statusCode, 200);
    // 1 prop dans le global doc, pas 2.
    assert.equal(res._body.distribution.all[1][1], 1); // bucket 0.95 = 1
    assert.equal(res._body.distribution.hard_rules[1][1], 1);
  });
});

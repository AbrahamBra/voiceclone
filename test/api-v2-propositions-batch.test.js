import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/propositions-batch.js";

// POST /api/v2/propositions-batch
// body: { persona, filters: { target_kind?, confidence_min }, action: 'accept'|'reject', dry_run?: true }
//
// dry_run=true   → { matched: N, sample: proposition[<=5] } sans muter
// action=reject  → bulk update status='rejected', resolved_at=now()
// action=accept  → loop séquentiel : accept chaque prop (prose patch + status)
//                  V1 simplification : on délègue chaque accept au handler
//                  single via le helper acceptOne (tested separately).

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
  const updateLog = [];
  const sb = {
    _updateLog: updateLog,
    from(table) {
      const tc = config[table] || {};
      const builder = {
        _filterEq: {}, _filterIs: {}, _filterIn: {}, _filterGte: {},
        _selected: null, _table: table,
        select(cols) { this._selected = cols; return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        is(col, val) { this._filterIs[col] = val; return this; },
        in(col, vals) { this._filterIn[col] = vals; return this; },
        gte(col, val) { this._filterGte[col] = val; return this; },
        order() { return this; },
        update(values) { this._updateValues = values; return this; },
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
            for (const [k, v] of Object.entries(this._filterGte)) {
              if (typeof r[k] !== "number" || r[k] < v) return false;
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
          return m[0] ? { data: m[0], error: null } : { data: null, error: { code: "PGRST116" } };
        },
        then(resolve) {
          if (this._updateValues) {
            const matched = this._resolveRows();
            // Apply update in-place to mock data (so subsequent fetches see new state)
            for (const row of matched) Object.assign(row, this._updateValues);
            updateLog.push({
              table: this._table,
              filterEq: this._filterEq,
              filterIn: this._filterIn,
              filterGte: this._filterGte,
              values: this._updateValues,
              affected: matched.length,
            });
            resolve({ data: this._selected ? matched : null, error: null });
            return;
          }
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

const SAMPLE_PROPS = [
  { id: "p1", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.95, proposed_text: "rule1", source: "upload_batch", source_ref: null, source_refs: [], count: 1, intent: "add_rule" },
  { id: "p2", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.88, proposed_text: "rule2", source: "upload_batch", source_ref: null, source_refs: [], count: 1, intent: "add_rule" },
  { id: "p3", document_id: DOC_ID, status: "pending", target_kind: "hard_rules", confidence: 0.65, proposed_text: "rule3", source: "upload_batch", source_ref: null, source_refs: [], count: 1, intent: "add_rule" },
  { id: "p4", document_id: DOC_ID, status: "pending", target_kind: "icp_patterns", confidence: 0.92, proposed_text: "pat1", source: "upload_batch", source_ref: null, source_refs: [], count: 1, intent: "add_paragraph" },
  { id: "p5", document_id: DOC_ID, status: "accepted", target_kind: "hard_rules", confidence: 0.99, proposed_text: "old1", source: "upload_batch", source_ref: null, source_refs: [], count: 1, intent: "add_rule" },
];

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    protocol_document: {
      rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active" }],
    },
    proposition: { rows: SAMPLE_PROPS.map(p => ({ ...p })) },
  });
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase,
    acceptOne: async () => ({ ok: true }),  // mock for batch-accept loop
    ...overrides,
  };
}

describe("POST /api/v2/propositions-batch", () => {
  it("dry_run=true returns matched count + sample without mutating", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { target_kind: "hard_rules", confidence_min: 0.85 },
        action: "reject",
        dry_run: true,
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.matched, 2);  // p1 (0.95) + p2 (0.88), both hard_rules pending
    assert.ok(Array.isArray(res._body.sample));
    assert.ok(res._body.sample.length <= 5);
    // No update should have fired in dry_run
    assert.equal(deps.supabase._updateLog.length, 0);
  });

  it("action=reject without dry_run bulk-updates status to rejected", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { target_kind: "hard_rules", confidence_min: 0.85 },
        action: "reject",
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.applied, 2);
    assert.equal(res._body.failed, 0);
    // Check the bulk update was called once with the right filter
    const updates = deps.supabase._updateLog.filter(u => u.table === "proposition");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].values.status, "rejected");
    assert.ok(updates[0].values.resolved_at);
  });

  it("returns matched=0 when no props match filters (empty result, no mutation)", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { target_kind: "templates", confidence_min: 0.99 },
        action: "reject",
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.applied, 0);
    assert.equal(deps.supabase._updateLog.length, 0);
  });

  it("filters by confidence_min only (no target_kind) matches all kinds", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { confidence_min: 0.85 },
        action: "reject",
        dry_run: true,
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    // p1 (0.95 hard_rules) + p2 (0.88 hard_rules) + p4 (0.92 icp_patterns) = 3 matches
    assert.equal(res._body.matched, 3);
  });

  it("400 when action invalid", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { confidence_min: 0.85 },
        action: "delete",
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 400);
  });

  it("400 when persona not a UUID", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: "not-uuid",
        filters: { confidence_min: 0.85 },
        action: "reject",
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 400);
  });

  it("403 if non-admin without persona access", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { confidence_min: 0.85 },
        action: "reject",
      },
    };
    const res = makeRes();
    await handler(req, res, {
      ...deps,
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    });
    assert.equal(res.statusCode, 403);
  });

  it("404 if persona has no active document", async () => {
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { confidence_min: 0.85 },
        action: "reject",
      },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [] },
        proposition: { rows: [] },
      }),
    }));
    assert.equal(res.statusCode, 404);
  });

  it("action=accept returns 501 in V1 (batch accept not implemented)", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { target_kind: "hard_rules", confidence_min: 0.85 },
        action: "accept",
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 501);
    assert.match(res._body.error, /accept/i);
  });

  it("action=accept dry_run is allowed (preview matched count)", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: {
        persona: PERSONA_ID,
        filters: { target_kind: "hard_rules", confidence_min: 0.85 },
        action: "accept",
        dry_run: true,
      },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.matched, 2);
    // Dry run safe even for accept
    assert.equal(deps.supabase._updateLog.length, 0);
  });
});

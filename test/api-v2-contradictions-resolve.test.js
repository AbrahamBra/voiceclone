import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/contradictions-resolve.js";

// POST /api/v2/contradictions-resolve
//   body: { id: <uuid>, action: keep_a|keep_b|both_false_positive|reject_both|punt, note?: string }
//
// Side effects par action :
//   keep_a : prop B → 'rejected', merge_history merge_source='user_arbitrage_keep_a',
//            contradiction → status='resolved', resolved_action, resolved_at
//   keep_b : symétrique sur A
//   both_false_positive : aucune mutation prop, contradiction → resolved
//   reject_both : a et b → 'rejected', contradiction → resolved
//   punt : aucune mutation, contradiction → 'punted' (resolved_action stays NULL)

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
  const inserts = [];
  const updates = [];
  const sb = {
    _inserts: inserts,
    _updates: updates,
    from(table) {
      const tc = config[table] || {};
      const builder = {
        _filterEq: {}, _filterIn: {},
        _selected: null, _table: table,
        _inserting: null, _updateValues: null,
        select(cols) { this._selected = cols; return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        in(col, vals) { this._filterIn[col] = vals; return this; },
        order() { return this; },
        insert(row) { this._inserting = row; return this; },
        update(values) { this._updateValues = values; return this; },
        _resolveRows() {
          const rows = tc.rows || [];
          return rows.filter(r => {
            for (const [k, v] of Object.entries(this._filterEq)) {
              if (r[k] !== v) return false;
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
          return m[0] ? { data: m[0], error: null } : { data: null, error: { code: "PGRST116" } };
        },
        then(resolve) {
          if (this._inserting) {
            inserts.push({ table: this._table, row: this._inserting });
            // Push to mock data so subsequent reads see it
            tc.rows = (tc.rows || []).concat([{ ...this._inserting, id: this._inserting.id || "new-" + inserts.length }]);
            resolve({ data: null, error: null });
            return;
          }
          if (this._updateValues) {
            const matched = this._resolveRows();
            for (const row of matched) Object.assign(row, this._updateValues);
            updates.push({
              table: this._table,
              filterEq: this._filterEq,
              filterIn: this._filterIn,
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
const CONTRA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROP_A_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROP_B_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    proposition_contradiction: {
      rows: [
        {
          id: CONTRA_ID,
          persona_id: PERSONA_ID,
          proposition_a_id: PROP_A_ID,
          proposition_b_id: PROP_B_ID,
          kind: "hard_rules",
          cosine: 0.87,
          status: "open",
          resolved_action: null,
          resolved_at: null,
          resolved_note: null,
        },
      ],
    },
    proposition: {
      rows: [
        { id: PROP_A_ID, document_id: DOC_ID, status: "pending", proposed_text: "A", target_kind: "hard_rules", count: 1, source_refs: [], provenance: null },
        { id: PROP_B_ID, document_id: DOC_ID, status: "pending", proposed_text: "B", target_kind: "hard_rules", count: 2, source_refs: ["e1"], provenance: { hint: "x" } },
      ],
    },
    protocol_document: {
      rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active" }],
    },
    proposition_merge_history: { rows: [] },
  });
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase,
    ...overrides,
  };
}

describe("POST /api/v2/contradictions-resolve", () => {
  it("keep_a → prop B status=rejected, merge_history insert, contradiction resolved", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "keep_a", note: "A is correct" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    // prop B updated to rejected
    const propUpdates = deps.supabase._updates.filter(u => u.table === "proposition");
    assert.equal(propUpdates.length, 1);
    assert.equal(propUpdates[0].filterEq.id, PROP_B_ID);
    assert.equal(propUpdates[0].values.status, "rejected");
    // merge_history inserted
    const mhInserts = deps.supabase._inserts.filter(i => i.table === "proposition_merge_history");
    assert.equal(mhInserts.length, 1);
    assert.equal(mhInserts[0].row.merge_source, "user_arbitrage_keep_a");
    assert.equal(mhInserts[0].row.kept_proposition_id, PROP_A_ID);
    assert.equal(mhInserts[0].row.merged_proposition_text, "B");
    // contradiction resolved
    const cUpdates = deps.supabase._updates.filter(u => u.table === "proposition_contradiction");
    assert.equal(cUpdates.length, 1);
    assert.equal(cUpdates[0].values.status, "resolved");
    assert.equal(cUpdates[0].values.resolved_action, "keep_a");
    assert.equal(cUpdates[0].values.resolved_note, "A is correct");
    assert.ok(cUpdates[0].values.resolved_at);
  });

  it("keep_b → prop A status=rejected, merge_history merge_source=keep_b, resolved", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "keep_b" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    const propUpdates = deps.supabase._updates.filter(u => u.table === "proposition");
    assert.equal(propUpdates[0].filterEq.id, PROP_A_ID);
    assert.equal(propUpdates[0].values.status, "rejected");
    const mh = deps.supabase._inserts.filter(i => i.table === "proposition_merge_history")[0];
    assert.equal(mh.row.merge_source, "user_arbitrage_keep_b");
    assert.equal(mh.row.kept_proposition_id, PROP_B_ID);
  });

  it("both_false_positive → no prop mutation, contradiction resolved", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "both_false_positive" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    const propUpdates = deps.supabase._updates.filter(u => u.table === "proposition");
    assert.equal(propUpdates.length, 0);
    const mhInserts = deps.supabase._inserts.filter(i => i.table === "proposition_merge_history");
    assert.equal(mhInserts.length, 0);
    const cUpdates = deps.supabase._updates.filter(u => u.table === "proposition_contradiction");
    assert.equal(cUpdates[0].values.resolved_action, "both_false_positive");
  });

  it("reject_both → both props rejected, no merge_history, resolved", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "reject_both" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    const propUpdates = deps.supabase._updates.filter(u => u.table === "proposition");
    // 1 update query with filter id IN [a, b]
    assert.equal(propUpdates.length, 1);
    assert.deepEqual(propUpdates[0].filterIn?.id?.sort?.(), [PROP_A_ID, PROP_B_ID].sort());
    assert.equal(propUpdates[0].values.status, "rejected");
    const mhInserts = deps.supabase._inserts.filter(i => i.table === "proposition_merge_history");
    assert.equal(mhInserts.length, 0);
  });

  it("punt → no mutation, contradiction status=punted, resolved_action stays NULL", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "punt" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 200);
    const propUpdates = deps.supabase._updates.filter(u => u.table === "proposition");
    assert.equal(propUpdates.length, 0);
    const cUpdates = deps.supabase._updates.filter(u => u.table === "proposition_contradiction");
    assert.equal(cUpdates[0].values.status, "punted");
    assert.equal(cUpdates[0].values.resolved_action, null);
    assert.equal(cUpdates[0].values.resolved_at, null);
  });

  it("400 if action invalid", async () => {
    const deps = baseDeps();
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "delete" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 400);
  });

  it("404 if contradiction not found", async () => {
    const deps = baseDeps({
      supabase: makeSupabase({
        proposition_contradiction: { rows: [] },
        proposition: { rows: [] },
        protocol_document: { rows: [] },
        proposition_merge_history: { rows: [] },
      }),
    });
    const req = {
      method: "POST",
      headers: {},
      query: {},
      body: { id: CONTRA_ID, action: "keep_a" },
    };
    const res = makeRes();
    await handler(req, res, deps);
    assert.equal(res.statusCode, 404);
  });
});

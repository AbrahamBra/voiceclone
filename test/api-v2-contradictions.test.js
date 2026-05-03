import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/contradictions.js";

// Same DI + extended-stub pattern as test/api-v2-brain-status.test.js.
// Adds .order() recording so we can assert sort direction.

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
    _orderCalls: [],
    from(table) {
      const tc = config[table] || {};
      const builder = {
        _filterEq: {}, _filterIn: {},
        _orderCol: null, _orderOpts: null,
        select() { return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        in(col, vals) { this._filterIn[col] = vals; return this; },
        order(col, opts) {
          this._orderCol = col; this._orderOpts = opts;
          sb._orderCalls.push({ table, col, opts });
          return this;
        },
        _resolveRows() {
          const rows = tc.rows || [];
          let r = rows.filter(row => {
            for (const [k, v] of Object.entries(this._filterEq)) {
              if (row[k] !== v) return false;
            }
            for (const [k, vals] of Object.entries(this._filterIn)) {
              if (!vals.includes(row[k])) return false;
            }
            return true;
          });
          if (this._orderCol) {
            const dir = this._orderOpts?.ascending === false ? -1 : 1;
            r = [...r].sort((a, b) => {
              if (a[this._orderCol] < b[this._orderCol]) return -1 * dir;
              if (a[this._orderCol] > b[this._orderCol]) return 1 * dir;
              return 0;
            });
          }
          return r;
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
const PROP_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const PROP_B1 = "bbbbbbbb-1111-1111-1111-111111111111";
const PROP_A2 = "aaaaaaaa-2222-2222-2222-222222222222";
const PROP_B2 = "bbbbbbbb-2222-2222-2222-222222222222";

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    proposition_contradiction: {
      rows: [
        // 2 open, 1 resolved, 1 punted
        {
          id: "c1", persona_id: PERSONA_ID, status: "open",
          kind: "hard_rules", cosine: 0.868, reason: "règle absolue vs conditionnelle",
          proposition_a_id: PROP_A1, proposition_b_id: PROP_B1,
          detected_at: "2026-05-03T10:00:00Z",
        },
        {
          id: "c2", persona_id: PERSONA_ID, status: "open",
          kind: "icp_patterns", cosine: 0.742, reason: "seuils CA chevauchent",
          proposition_a_id: PROP_A2, proposition_b_id: PROP_B2,
          detected_at: "2026-05-03T11:00:00Z",
        },
        {
          id: "c3", persona_id: PERSONA_ID, status: "resolved",
          kind: "hard_rules", cosine: 0.81,
          proposition_a_id: PROP_A1, proposition_b_id: PROP_B2,
          detected_at: "2026-05-02T10:00:00Z",
          resolved_at: "2026-05-03T08:00:00Z", resolved_action: "keep_a",
        },
        {
          id: "c4", persona_id: PERSONA_ID, status: "punted",
          kind: "process", cosine: 0.71,
          proposition_a_id: PROP_A2, proposition_b_id: PROP_B1,
          detected_at: "2026-05-03T12:00:00Z",
        },
      ],
    },
    proposition: {
      rows: [
        { id: PROP_A1, proposed_text: "Jamais mentionner l'offre…",
          count: 1, intent: "add_rule", confidence: 0.92, source: "upload_batch",
          provenance: { sources: ["Reflexion process p4"] } },
        { id: PROP_B1, proposed_text: "Ne jamais mentionner l'offre avant douleur…",
          count: 2, intent: "add_rule", confidence: 0.87, source: "upload_batch",
          provenance: { sources: ["Reflexion process p4", "PositionnementNicolas"] } },
        { id: PROP_A2, proposed_text: "Segment P2 — CA 500k-5M",
          count: 1, intent: "add_paragraph", confidence: 0.85, source: "upload_batch",
          provenance: { sources: ["PositionnementNicolas"] } },
        { id: PROP_B2, proposed_text: "P1 Infopreneur ≥5 collab CA 500k-20M",
          count: 1, intent: "add_paragraph", confidence: 0.88, source: "upload_batch",
          provenance: { sources: ["AudienceCibleNicolas"] } },
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

describe("GET /api/v2/contradictions", () => {
  it("returns 200 with open contradictions sorted by cosine DESC by default", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    const list = res._body.contradictions;
    assert.equal(list.length, 2, "default status=open returns only open");
    // Sort cosine DESC : 0.868 first, then 0.742
    assert.equal(list[0].id, "c1");
    assert.equal(list[1].id, "c2");
    assert.equal(list[0].cosine, 0.868);
  });

  it("joins proposition data into a + b shape on each contradiction", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const c1 = res._body.contradictions.find(c => c.id === "c1");
    assert.equal(c1.a.id, PROP_A1);
    assert.equal(c1.a.text, "Jamais mentionner l'offre…");
    assert.equal(c1.a.count, 1);
    assert.equal(c1.a.intent, "add_rule");
    assert.equal(c1.b.id, PROP_B1);
    assert.equal(c1.b.count, 2);
    assert.deepEqual(c1.b.sources, ["Reflexion process p4", "PositionnementNicolas"]);
  });

  it("filters by status=punted", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID, status: "punted" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.contradictions.length, 1);
    assert.equal(res._body.contradictions[0].id, "c4");
  });

  it("filters by status=resolved", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID, status: "resolved" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.contradictions.length, 1);
    assert.equal(res._body.contradictions[0].id, "c3");
    assert.equal(res._body.contradictions[0].resolved_action, "keep_a");
  });

  it("returns 400 if persona param missing or invalid", async () => {
    const r1 = makeRes();
    await handler({ method: "GET", query: {}, headers: {} }, r1, baseDeps());
    assert.equal(r1.statusCode, 400);

    const r2 = makeRes();
    await handler({ method: "GET", query: { persona: "bad" }, headers: {} }, r2, baseDeps());
    assert.equal(r2.statusCode, 400);
  });

  it("returns 400 if status is not in (open|punted|resolved)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID, status: "garbage" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 403 if non-admin and no persona access", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    }));
    assert.equal(res.statusCode, 403);
  });

  it("returns 200 with empty list when persona has no contradictions", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({ proposition_contradiction: { rows: [] }, proposition: { rows: [] } }),
    }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res._body.contradictions, []);
  });

  it("returns 405 on non-GET methods", async () => {
    const req = { method: "POST", query: { persona: PERSONA_ID }, headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("does not crash if a referenced proposition row is missing", async () => {
    // Edge case : proposition was hard-deleted but contradiction row remains.
    // Should still return the contradiction with a/b set to null entries
    // rather than 500.
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        proposition_contradiction: {
          rows: [{
            id: "c1", persona_id: PERSONA_ID, status: "open",
            kind: "hard_rules", cosine: 0.9,
            proposition_a_id: PROP_A1, proposition_b_id: PROP_B1,
            detected_at: "2026-05-03T10:00:00Z",
          }],
        },
        proposition: { rows: [] }, // both A and B missing
      }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.contradictions[0].a, null);
    assert.equal(res._body.contradictions[0].b, null);
  });
});

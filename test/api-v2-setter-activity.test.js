import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/setter-activity.js";

// GET /api/v2/setter-activity?persona=<uuid>&period=week|month
//   → { persona_id, period, since, total_corrections, propositions_generated,
//       propositions_accepted, by_setter: [{ client_id, name, corrections, last_activity }] }

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
        _filterEq: {}, _filterIn: {}, _filterGte: {},
        _selected: null,
        select(cols) { this._selected = cols; return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        in(col, vals) { this._filterIn[col] = vals; return this; },
        gte(col, val) { this._filterGte[col] = val; return this; },
        order() { return this; },
        _resolveRows() {
          return (tc.rows || []).filter(r => {
            for (const [k, v] of Object.entries(this._filterEq)) {
              if (r[k] !== v) return false;
            }
            for (const [k, vals] of Object.entries(this._filterIn)) {
              if (!vals.includes(r[k])) return false;
            }
            for (const [k, v] of Object.entries(this._filterGte)) {
              if (typeof r[k] === "string") {
                if (r[k] < v) return false;
              } else {
                if (r[k] < v) return false;
              }
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
const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CONV_1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CONV_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    feedback_events: {
      rows: [
        // 3 corrections de Alec (CLIENT_A) cette semaine
        { id: "f1", conversation_id: CONV_1, persona_id: PERSONA_ID, event_type: "corrected", created_at: "2026-05-03T10:00:00Z" },
        { id: "f2", conversation_id: CONV_1, persona_id: PERSONA_ID, event_type: "corrected", created_at: "2026-05-04T10:00:00Z" },
        { id: "f3", conversation_id: CONV_1, persona_id: PERSONA_ID, event_type: "validated_edited", created_at: "2026-05-04T11:00:00Z" },
        // 1 correction de Henry (CLIENT_B)
        { id: "f4", conversation_id: CONV_2, persona_id: PERSONA_ID, event_type: "corrected", created_at: "2026-05-02T10:00:00Z" },
        // 1 validation simple (pas une correction, à exclure)
        { id: "f5", conversation_id: CONV_1, persona_id: PERSONA_ID, event_type: "validated", created_at: "2026-05-03T12:00:00Z" },
        // 1 correction très ancienne (hors période week)
        { id: "f6", conversation_id: CONV_1, persona_id: PERSONA_ID, event_type: "corrected", created_at: "2026-04-01T10:00:00Z" },
      ],
    },
    conversations: {
      rows: [
        { id: CONV_1, client_id: CLIENT_A, persona_id: PERSONA_ID },
        { id: CONV_2, client_id: CLIENT_B, persona_id: PERSONA_ID },
      ],
    },
    clients: {
      rows: [
        { id: CLIENT_A, name: "Alec" },
        { id: CLIENT_B, name: "Henry" },
      ],
    },
    proposition: {
      rows: [
        { id: "p1", source: "feedback_event", source_ref: "f1", status: "pending", document_id: "any" },
        { id: "p2", source: "feedback_event", source_ref: "f2", status: "accepted", document_id: "any" },
      ],
    },
    protocol_document: {
      rows: [{ id: "any", owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: null }],
    },
  });
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase,
    nowIso: () => "2026-05-04T12:00:00Z",
    ...overrides,
  };
}

describe("GET /api/v2/setter-activity", () => {
  it("returns 200 with weekly aggregate by setter", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID, period: "week" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.persona_id, PERSONA_ID);
    assert.equal(res._body.period, "week");
    assert.equal(res._body.total_corrections, 4);
    assert.equal(res._body.by_setter.length, 2);
    const alec = res._body.by_setter.find(s => s.name === "Alec");
    const henry = res._body.by_setter.find(s => s.name === "Henry");
    assert.equal(alec.corrections, 3);
    assert.equal(henry.corrections, 1);
  });

  it("counts corrected + validated_edited as corrections (excludes validated, saved_rule, etc.)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.total_corrections, 4);
  });

  it("returns propositions_generated count from feedback_event source_refs", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.propositions_generated, 2);
  });

  it("returns propositions_accepted count (status='accepted')", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.propositions_accepted, 1);
  });

  it("returns 400 if persona is not a UUID", async () => {
    const req = { method: "GET", query: { persona: "not-uuid" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
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

  it("returns empty by_setter array when no corrections in period", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        feedback_events: { rows: [] },
        conversations: { rows: [] },
        clients: { rows: [] },
        proposition: { rows: [] },
        protocol_document: { rows: [{ id: "any", owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: null }] },
      }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.total_corrections, 0);
    assert.deepEqual(res._body.by_setter, []);
  });
});

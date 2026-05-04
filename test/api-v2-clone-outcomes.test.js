import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/clone-outcomes.js";

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
        _filterEq: {}, _filterGte: {},
        select() { return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        gte(col, val) { this._filterGte[col] = val; return this; },
        order() { return this; },
        _resolveRows() {
          return (tc.rows || []).filter(r => {
            for (const [k, v] of Object.entries(this._filterEq)) {
              if (r[k] !== v) return false;
            }
            for (const [k, v] of Object.entries(this._filterGte)) {
              if (r[k] < v) return false;
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
const NOW = "2026-05-04T12:00:00Z";

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    feedback_events: {
      rows: [
        // Cette semaine (3 RDV)
        { id: "r1", persona_id: PERSONA_ID, event_type: "appointment_booked", created_at: "2026-05-02T10:00:00Z" },
        { id: "r2", persona_id: PERSONA_ID, event_type: "appointment_booked", created_at: "2026-05-03T10:00:00Z" },
        { id: "r3", persona_id: PERSONA_ID, event_type: "appointment_booked", created_at: "2026-05-04T10:00:00Z" },
        // Semaine précédente (1 RDV)
        { id: "r4", persona_id: PERSONA_ID, event_type: "appointment_booked", created_at: "2026-04-26T10:00:00Z" },
        // Bruit : autres types ignorés
        { id: "x1", persona_id: PERSONA_ID, event_type: "corrected", created_at: "2026-05-04T10:00:00Z" },
      ],
    },
  });
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase,
    nowIso: () => NOW,
    ...overrides,
  };
}

describe("GET /api/v2/clone-outcomes", () => {
  it("returns 200 with rdv_count for this week", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID, period: "week" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.rdv_count, 3);
  });

  it("rdv_delta = current_week - prev_week", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.rdv_delta, 2);
  });

  it("excludes non-appointment_booked event types", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.rdv_count, 3);
  });

  it("returns 0 when no appointment_booked rows exist", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({ feedback_events: { rows: [] } }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.rdv_count, 0);
    assert.equal(res._body.rdv_delta, 0);
  });

  it("returns 400 for invalid UUID", async () => {
    const req = { method: "GET", query: { persona: "bad" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });
});

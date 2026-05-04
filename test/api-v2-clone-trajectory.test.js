import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/clone-trajectory.js";

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
        select() { return this; },
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

function makeFbEvents(weeklyCounts) {
  // weeklyCounts[0] = oldest week, weeklyCounts[N-1] = current week
  const rows = [];
  let id = 0;
  for (let weekIdx = 0; weekIdx < weeklyCounts.length; weekIdx++) {
    const weeksAgo = weeklyCounts.length - 1 - weekIdx;
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - (weeksAgo * 7) - 3);
    for (let i = 0; i < weeklyCounts[weekIdx]; i++) {
      rows.push({
        id: `fb-${id++}`,
        persona_id: PERSONA_ID,
        event_type: "corrected",
        created_at: date.toISOString(),
      });
    }
  }
  return rows;
}

function makeMessages(weeklyCounts) {
  const rows = [];
  let id = 0;
  for (let weekIdx = 0; weekIdx < weeklyCounts.length; weekIdx++) {
    const weeksAgo = weeklyCounts.length - 1 - weekIdx;
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - (weeksAgo * 7) - 3);
    for (let i = 0; i < weeklyCounts[weekIdx]; i++) {
      rows.push({
        id: `msg-${id++}`,
        role: "assistant",
        created_at: date.toISOString(),
        conversation_id: "any",
      });
    }
  }
  return rows;
}

function baseDeps(overrides = {}) {
  // Default scenario : trajectory improving over 8 weeks.
  // Corrections / week: 89, 76, 68, 60, 55, 52, 49, 47 (week -7 .. -0)
  // Messages drafted / week: 100 each (constant).
  const correctionsByWeek = [89, 76, 68, 60, 55, 52, 49, 47];
  const msgsByWeek = [100, 100, 100, 100, 100, 100, 100, 100];

  const supabase = overrides.supabase ?? makeSupabase({
    feedback_events: { rows: makeFbEvents(correctionsByWeek) },
    messages: { rows: makeMessages(msgsByWeek) },
    conversations: { rows: [{ id: "any", persona_id: PERSONA_ID }] },
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

describe("GET /api/v2/clone-trajectory", () => {
  it("returns 200 with 8-week series for correction_rate and autonomy_pct", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.persona_id, PERSONA_ID);
    assert.equal(res._body.correction_rate.series.length, 8);
    assert.equal(res._body.autonomy_pct.series.length, 8);
  });

  it("correction_rate.current_value is the last week's count", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.correction_rate.current_value, 47);
    assert.equal(res._body.correction_rate.series[7], 47);
  });

  it("correction_rate.delta = current - oldest (negative = improving)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.correction_rate.delta, -42);
  });

  it("autonomy_pct.current_value rounds to 2 decimals (e.g., 0.53)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res._body.autonomy_pct.current_value, 0.53);
  });

  it("returns 400 for invalid UUID", async () => {
    const req = { method: "GET", query: { persona: "bad" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns zeros series when no data", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        feedback_events: { rows: [] },
        messages: { rows: [] },
        conversations: { rows: [] },
      }),
    }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res._body.correction_rate.series, [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(res._body.autonomy_pct.current_value, 1);
  });
});

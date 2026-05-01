import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// DI pattern : the handler accepts `deps` so we stub auth, supabase, log.
// Mirrors api/v2/draft.test.js.

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

const PERSONA = { id: "p1", client_id: "c1" };
const API_KEY_AUTH = { persona: PERSONA, client: { id: "c1" }, keyId: "k1", isAdmin: false };

function baseDeps(overrides = {}) {
  return {
    rateLimit: async () => ({ allowed: true }),
    resolveApiKey: async () => API_KEY_AUTH,
    setCors: () => {},
    supabase: makeFakeSupabase({
      conversations: [{ id: "conv-1", persona_id: "p1", client_id: "c1", external_lead_ref: "breakcold:42" }],
      business_outcomes: [],
    }),
    log: () => {},
    ...overrides,
  };
}

describe("POST /api/v2/feedback", () => {
  it("405 on GET", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("200 on OPTIONS preflight", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = { method: "OPTIONS", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
  });

  it("401 when no x-api-key", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = { method: "POST", headers: {}, body: { external_lead_ref: "breakcold:42", outcome: "rdv_signed" } };
    const res = makeRes();
    await handler(req, res, baseDeps({ resolveApiKey: async () => null }));
    assert.equal(res.statusCode, 401);
  });

  it("429 when rate-limited", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = { method: "POST", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ rateLimit: async () => ({ allowed: false, retryAfter: 30 }) }));
    assert.equal(res.statusCode, 429);
    assert.equal(res._body.retryAfter, 30);
  });

  it("400 when external_lead_ref missing", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = { method: "POST", headers: {}, body: { outcome: "rdv_signed" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /external_lead_ref/);
  });

  it("400 when outcome missing or invalid", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_yolo" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /outcome must be one of/);
  });

  it("400 when message_id is not a uuid", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_triggered", message_id: "not-a-uuid" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /message_id must be a uuid/);
  });

  it("400 when value out of range", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_signed", value: 1e12 },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /value out of range/);
  });

  it("400 when note too long", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_signed", note: "x".repeat(501) },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /note too long/);
  });

  it("404 when external_lead_ref does not match any conversation", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:unknown", outcome: "rdv_signed" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 404);
    assert.match(res._body.error, /No conversation matches/);
  });

  it("409 when external_lead_ref belongs to a different persona", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_signed" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeFakeSupabase({
        conversations: [{ id: "conv-other", persona_id: "p-OTHER", client_id: "c1", external_lead_ref: "breakcold:42" }],
        business_outcomes: [],
      }),
    }));
    assert.equal(res.statusCode, 409);
    assert.match(res._body.error, /different persona/);
  });

  it("503 when supabase is null", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_signed" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: null }));
    assert.equal(res.statusCode, 503);
  });

  it("200 + outcome_id on fresh rdv_signed insert", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: {
        external_lead_ref: "breakcold:42",
        outcome: "rdv_signed",
        value: 1500,
        note: "Demo booked for 2026-05-15",
      },
    };
    const res = makeRes();
    const fakeSupabase = makeFakeSupabase({
      conversations: [{ id: "conv-1", persona_id: "p1", client_id: "c1", external_lead_ref: "breakcold:42" }],
      business_outcomes: [],
    });
    await handler(req, res, baseDeps({ supabase: fakeSupabase }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.duplicate, false);
    assert.equal(res._body.outcome, "rdv_signed");
    assert.equal(res._body.conversation_id, "conv-1");
    assert.ok(res._body.outcome_id, "outcome_id must be returned");
    const inserted = fakeSupabase.tables.business_outcomes[0];
    assert.equal(inserted.persona_id, "p1");
    assert.equal(inserted.client_id, "c1");
    assert.equal(inserted.outcome, "rdv_signed");
    assert.equal(inserted.value, 1500);
    assert.equal(inserted.note, "Demo booked for 2026-05-15");
  });

  it("200 + duplicate=true on idempotent re-fire (23505)", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: { external_lead_ref: "breakcold:42", outcome: "rdv_signed" },
    };
    const res = makeRes();
    // Pre-existing outcome will trigger the simulated unique-index violation.
    const fakeSupabase = makeFakeSupabase({
      conversations: [{ id: "conv-1", persona_id: "p1", client_id: "c1", external_lead_ref: "breakcold:42" }],
      business_outcomes: [{ id: "outcome-existing", conversation_id: "conv-1", outcome: "rdv_signed", created_at: "2026-05-01T10:00:00Z" }],
    });
    await handler(req, res, baseDeps({ supabase: fakeSupabase }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.duplicate, true);
    assert.equal(res._body.outcome_id, "outcome-existing");
    assert.equal(res._body.conversation_id, "conv-1");
    // No new row was inserted.
    assert.equal(fakeSupabase.tables.business_outcomes.length, 1);
  });

  it("400 on FK violation (bad message_id)", async () => {
    const { default: handler } = await import("../api/v2/feedback.js");
    const req = {
      method: "POST", headers: {},
      body: {
        external_lead_ref: "breakcold:42",
        outcome: "rdv_triggered",
        message_id: "11111111-1111-1111-1111-111111111111",
      },
    };
    const res = makeRes();
    // Fake supabase tagged to fail this insert with 23503.
    const fakeSupabase = makeFakeSupabase({
      conversations: [{ id: "conv-1", persona_id: "p1", client_id: "c1", external_lead_ref: "breakcold:42" }],
      business_outcomes: [],
      forceInsertError: { code: "23503", message: "fk violation" },
    });
    await handler(req, res, baseDeps({ supabase: fakeSupabase }));
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /Invalid message_id/);
  });

  it("validate() exported helper covers happy path", async () => {
    const { validate } = await import("../api/v2/feedback.js");
    assert.equal(validate({ external_lead_ref: "breakcold:42", outcome: "rdv_signed" }), null);
    assert.match(validate(null), /Body must/);
    assert.match(validate({}), /external_lead_ref/);
    assert.match(validate({ external_lead_ref: " " }), /external_lead_ref/);
  });

  it("OUTCOME_VALUES is the canonical set", async () => {
    const { OUTCOME_VALUES } = await import("../api/v2/feedback.js");
    assert.ok(OUTCOME_VALUES.has("rdv_triggered"));
    assert.ok(OUTCOME_VALUES.has("rdv_signed"));
    assert.ok(OUTCOME_VALUES.has("rdv_no_show"));
    assert.ok(OUTCOME_VALUES.has("rdv_lost"));
    assert.equal(OUTCOME_VALUES.size, 4);
  });
});

// ────────────────────────────────────────────────────────────────────
// Minimal in-memory fake supabase for the feedback endpoint. Implements :
//   .from(table).select(cols).eq(col, val).maybeSingle()
//   .from(table).select(cols).eq(col, val).order(...).limit(n).maybeSingle()
//   .from(table).insert(row).select(cols).single()
//
// On business_outcomes inserts, simulates the unique partial indexes on
// (conversation_id, outcome) for rdv_signed (mig 022) and rdv_triggered/
// rdv_no_show/rdv_lost (mig 061). Returns 23505 on duplicate.
//
// `forceInsertError` lets a test trigger an arbitrary insert error code
// (e.g. 23503 FK violation) without rewiring the table state.
// ────────────────────────────────────────────────────────────────────
function makeFakeSupabase(seed = {}) {
  const tables = {
    conversations: [...(seed.conversations || [])],
    business_outcomes: [...(seed.business_outcomes || [])],
  };
  const forceInsertError = seed.forceInsertError || null;
  let nextId = 1;
  function newId(prefix) { return `${prefix}-${nextId++}`; }
  const UNIQ_OUTCOMES = new Set(["rdv_signed", "rdv_triggered", "rdv_no_show", "rdv_lost"]);
  function from(table) {
    const ctx = { table, filters: [], orderBy: null, limitN: null, selectCols: "*" };
    const queryable = {
      select(cols) { ctx.selectCols = cols; return queryable; },
      eq(col, val) { ctx.filters.push({ col, val }); return queryable; },
      order(col, opts) { ctx.orderBy = { col, ascending: opts?.ascending !== false }; return queryable; },
      limit(n) { ctx.limitN = n; return queryable; },
      maybeSingle: async () => {
        const rows = applyFilters(tables[table] || [], ctx);
        return { data: rows[0] || null, error: null };
      },
      single: async () => {
        const rows = applyFilters(tables[table] || [], ctx);
        if (rows.length === 0) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: rows[0], error: null };
      },
    };
    function insertable(row) {
      const insertCtx = {
        select() {
          return {
            single: async () => {
              if (forceInsertError) return { data: null, error: forceInsertError };
              if (table === "business_outcomes" && UNIQ_OUTCOMES.has(row.outcome)) {
                const dup = tables.business_outcomes.find(
                  (b) => b.conversation_id === row.conversation_id && b.outcome === row.outcome,
                );
                if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
              }
              const id = row.id || newId(table.slice(0, 4));
              const created_at = row.created_at || new Date().toISOString();
              const stored = { id, created_at, ...row };
              tables[table].push(stored);
              return { data: { id }, error: null };
            },
          };
        },
      };
      return insertCtx;
    }
    return { ...queryable, insert: insertable };
  }
  function applyFilters(rows, ctx) {
    let out = rows;
    for (const { col, val } of ctx.filters) out = out.filter((r) => r[col] === val);
    if (ctx.orderBy) {
      out = [...out].sort((a, b) => {
        const av = a[ctx.orderBy.col]; const bv = b[ctx.orderBy.col];
        if (av < bv) return ctx.orderBy.ascending ? -1 : 1;
        if (av > bv) return ctx.orderBy.ascending ? 1 : -1;
        return 0;
      });
    }
    if (ctx.limitN != null) out = out.slice(0, ctx.limitN);
    return out;
  }
  return { from, tables };
}

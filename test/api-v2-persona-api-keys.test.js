import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

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

function makeFakeSupabase(initial = []) {
  const rows = [...initial];
  let nextId = 1;
  function from(table) {
    if (table !== "persona_api_keys") throw new Error("unexpected table " + table);
    const ctx = { filters: [], orderBy: null };
    const queryable = {
      select() { return queryable; },
      eq(col, val) { ctx.filters.push({ col, val }); return queryable; },
      order(col, opts) { ctx.orderBy = { col, ascending: opts?.ascending !== false }; return queryable; },
      maybeSingle: async () => {
        const matched = rows.filter((r) => ctx.filters.every((f) => r[f.col] === f.val));
        return { data: matched[0] || null, error: null };
      },
      then(resolve) {
        let out = rows.filter((r) => ctx.filters.every((f) => r[f.col] === f.val));
        if (ctx.orderBy) {
          out = [...out].sort((a, b) => {
            const av = a[ctx.orderBy.col]; const bv = b[ctx.orderBy.col];
            if (av < bv) return ctx.orderBy.ascending ? -1 : 1;
            if (av > bv) return ctx.orderBy.ascending ? 1 : -1;
            return 0;
          });
        }
        resolve({ data: out, error: null });
      },
    };
    function insertable(row) {
      const r = { id: `key-${nextId++}`, ...row };
      rows.push(r);
      return {
        select() {
          return {
            single: async () => ({ data: r, error: null }),
          };
        },
      };
    }
    function updatable(patch) {
      const updateCtx = {
        eq(col, val) {
          for (const row of rows) {
            if (row[col] === val) Object.assign(row, patch);
          }
          return updateCtx;
        },
        then(resolve) { resolve({ data: null, error: null }); },
      };
      return updateCtx;
    }
    return { ...queryable, insert: insertable, update: updatable };
  }
  return { from, _rows: rows };
}

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: makeFakeSupabase(),
    ...overrides,
  };
}

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
const KEY_ID = "22222222-2222-2222-2222-222222222222";

describe("CRUD /api/v2/persona-api-keys", () => {
  it("405 on PATCH", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const req = { method: "PATCH", headers: {}, query: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("403 on auth failure", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const req = { method: "GET", headers: {}, query: { persona: PERSONA_ID }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      authenticateRequest: async () => { throw { status: 403, error: "bad" }; },
    }));
    assert.equal(res.statusCode, 403);
  });

  it("GET 400 when persona missing/non-uuid", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const req = { method: "GET", headers: {}, query: { persona: "not-uuid" }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("GET 403 when client lacks access", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const req = { method: "GET", headers: {}, query: { persona: PERSONA_ID }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ hasPersonaAccess: async () => false }));
    assert.equal(res.statusCode, 403);
  });

  it("POST creates key + returns raw_key once", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const supa = makeFakeSupabase();
    const req = {
      method: "POST", headers: {}, query: {},
      body: { persona_id: PERSONA_ID, label: "breakcold-prod" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: supa }));
    assert.equal(res.statusCode, 201);
    assert.match(res._body.raw_key, /^sk_/);
    assert.equal(res._body.label, "breakcold-prod");
    assert.ok(res._body.id);
    // Hash persisted, raw_key NOT persisted.
    assert.equal(supa._rows.length, 1);
    assert.match(supa._rows[0].key_hash, /^[0-9a-f]{64}$/);
    assert.equal(supa._rows[0].raw_key, undefined);
  });

  it("POST 400 when persona_id missing", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const req = { method: "POST", headers: {}, query: {}, body: { label: "x" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("GET returns hash-free public columns only", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const supa = makeFakeSupabase([
      { id: KEY_ID, persona_id: PERSONA_ID, label: "k1", key_hash: "abc", created_at: "2026-05-01T00:00:00Z", last_used_at: null, revoked_at: null },
    ]);
    const req = { method: "GET", headers: {}, query: { persona: PERSONA_ID }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: supa }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.keys.length, 1);
    assert.equal(res._body.keys[0].id, KEY_ID);
    assert.equal(res._body.keys[0].label, "k1");
  });

  it("DELETE soft-revokes (sets revoked_at)", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const supa = makeFakeSupabase([
      { id: KEY_ID, persona_id: PERSONA_ID, label: "k1", key_hash: "abc", revoked_at: null },
    ]);
    const req = { method: "DELETE", headers: {}, query: { id: KEY_ID }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: supa }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.revoked, true);
    assert.ok(supa._rows[0].revoked_at);
  });

  it("DELETE 404 when key missing", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const req = { method: "DELETE", headers: {}, query: { id: KEY_ID }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 404);
  });

  it("DELETE idempotent on already-revoked", async () => {
    const { default: handler } = await import("../api/v2/persona-api-keys.js");
    const supa = makeFakeSupabase([
      { id: KEY_ID, persona_id: PERSONA_ID, key_hash: "abc", revoked_at: "2026-04-30T00:00:00Z" },
    ]);
    const req = { method: "DELETE", headers: {}, query: { id: KEY_ID }, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: supa }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.already_revoked, true);
  });
});

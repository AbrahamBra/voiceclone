import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import handler from "../api/account/delete.js";

const CLIENT_ID = "c-1234abcd-aaaa-bbbb-cccc-deadbeefcafe";
const ACCESS_CODE = "secret-code-zzz";

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

function makeSupabase({ personasReturn, personasError, clientsError, hardDeleteError } = {}) {
  const calls = [];
  return {
    _calls: calls,
    from(table) {
      let _filter = {};
      let _patch = null;
      let _wantsSelect = false;
      let _isDelete = false;
      const builder = {
        update(patch) { _patch = patch; return builder; },
        delete() { _isDelete = true; return builder; },
        eq(col, val) { _filter[col] = val; return builder; },
        select(cols) { _wantsSelect = true; calls.push({ table, op: "update_select", filter: { ..._filter }, patch: _patch, cols }); return Promise.resolve({ data: personasReturn || [], error: personasError || null }); },
        then(resolve) {
          if (_isDelete) {
            calls.push({ table, op: "delete", filter: { ..._filter } });
            resolve({ error: hardDeleteError || null });
          } else if (!_wantsSelect) {
            calls.push({ table, op: "update", filter: { ..._filter }, patch: _patch });
            resolve({ error: clientsError || null });
          } else {
            resolve({ error: clientsError || null });
          }
        },
      };
      return builder;
    },
  };
}

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({
      client: { id: CLIENT_ID, access_code: ACCESS_CODE, is_active: true },
      isAdmin: false,
    }),
    setCors: () => {},
    supabase: makeSupabase({
      personasReturn: [{ id: "p-1" }, { id: "p-2" }],
    }),
    ...overrides,
  };
}

describe("POST /api/account/delete", () => {
  it("405 on GET", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {} }, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("403 if auth fails", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: {} }, res, baseDeps({
      authenticateRequest: async () => { throw { status: 401, error: "Access code required" }; },
    }));
    assert.equal(res.statusCode, 401);
    assert.equal(res._body.error, "Access code required");
  });

  it("403 if admin tries to self-delete", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: { confirm_access_code: "anything" } }, res, baseDeps({
      authenticateRequest: async () => ({
        client: { id: "admin-id", access_code: "__admin__" },
        isAdmin: true,
      }),
    }));
    assert.equal(res.statusCode, 403);
    assert.match(res._body.error, /admin/i);
  });

  it("400 if confirm_access_code is missing", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: {} }, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /confirm_access_code/);
  });

  it("400 if confirm_access_code does not match", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: { confirm_access_code: "wrong" } }, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("200 + soft-deletes client + cascades on personas", async () => {
    const res = makeRes();
    const deps = baseDeps();
    await handler({ method: "POST", headers: {}, body: { confirm_access_code: ACCESS_CODE } }, res, deps);

    assert.equal(res.statusCode, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.personas_deactivated, 2);
    assert.match(res._body.deactivated_at, /^\d{4}-\d{2}-\d{2}T/);

    const calls = deps.supabase._calls;
    const personasUpdate = calls.find(c => c.table === "personas");
    const clientsUpdate = calls.find(c => c.table === "clients");

    assert.ok(personasUpdate, "personas update should fire");
    assert.deepEqual(personasUpdate.patch, { is_active: false });
    assert.equal(personasUpdate.filter.client_id, CLIENT_ID);
    assert.equal(personasUpdate.filter.is_active, true);

    assert.ok(clientsUpdate, "clients update should fire");
    assert.equal(clientsUpdate.patch.is_active, false);
    assert.equal(clientsUpdate.patch.anthropic_api_key, null);
    assert.equal(clientsUpdate.patch.scraping_api_key, null);
    assert.match(clientsUpdate.patch.name, /^\[deleted-/);
    assert.equal(clientsUpdate.filter.id, CLIENT_ID);
  });

  it("500 if personas deactivation fails", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: { confirm_access_code: ACCESS_CODE } }, res, baseDeps({
      supabase: makeSupabase({ personasError: { message: "RLS denied" } }),
    }));
    assert.equal(res.statusCode, 500);
    assert.match(res._body.error, /RLS denied/);
  });

  it("500 if client deactivation fails (personas already flipped)", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: { confirm_access_code: ACCESS_CODE } }, res, baseDeps({
      supabase: makeSupabase({
        personasReturn: [{ id: "p-1" }],
        clientsError: { message: "boom" },
      }),
    }));
    assert.equal(res.statusCode, 500);
    assert.match(res._body.error, /boom/);
  });

  it("200 with personas_deactivated=0 when client owns no personas", async () => {
    const res = makeRes();
    await handler({ method: "POST", headers: {}, body: { confirm_access_code: ACCESS_CODE } }, res, baseDeps({
      supabase: makeSupabase({ personasReturn: [] }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.personas_deactivated, 0);
  });

  it("OPTIONS returns 200 (CORS preflight)", async () => {
    const res = makeRes();
    await handler({ method: "OPTIONS", headers: {} }, res, baseDeps());
    assert.equal(res.statusCode, 200);
  });

  it("hard=true fires DELETE FROM clients and skips soft-delete updates", async () => {
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", headers: {}, body: { confirm_access_code: ACCESS_CODE, hard: true } },
      res,
      deps,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.mode, "hard");
    assert.match(res._body.deleted_at, /^\d{4}-\d{2}-\d{2}T/);

    const calls = deps.supabase._calls;
    const deleteCall = calls.find((c) => c.table === "clients" && c.op === "delete");
    assert.ok(deleteCall, "DELETE on clients should fire in hard mode");
    assert.equal(deleteCall.filter.id, CLIENT_ID);

    // Soft-delete operations must NOT fire when hard=true.
    assert.ok(
      !calls.find((c) => c.table === "personas"),
      "personas update should NOT fire in hard mode",
    );
    assert.ok(
      !calls.find((c) => c.table === "clients" && c.op === "update"),
      "clients update should NOT fire in hard mode",
    );
  });

  it("hard=true returns 500 if DELETE fails (e.g. FK violation)", async () => {
    const res = makeRes();
    await handler(
      { method: "POST", headers: {}, body: { confirm_access_code: ACCESS_CODE, hard: true } },
      res,
      baseDeps({
        supabase: makeSupabase({ hardDeleteError: { message: "FK violation" } }),
      }),
    );
    assert.equal(res.statusCode, 500);
    assert.match(res._body.error, /FK violation/);
  });

  it("hard=true still requires confirm_access_code to match", async () => {
    const res = makeRes();
    await handler(
      { method: "POST", headers: {}, body: { confirm_access_code: "wrong", hard: true } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
  });
});

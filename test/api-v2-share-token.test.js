import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Same dependency-injection pattern as other v2 endpoint tests. The handler
// accepts a `deps` 3rd arg so we can stub auth + supabase + uuid generation.

function makeRes() {
  return {
    statusCode: 200,
    _body: null,
    _ended: false,
    setHeader() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { this._ended = true; return this; },
  };
}

// Supabase stub supporting select+eq+single AND update+eq. Tracks update
// payloads on `_updates` so tests can assert what was written.
function makeSupabase(config) {
  const updates = [];
  const sb = {
    _updates: updates,
    from(table) {
      const tableConfig = config[table] || {};
      return {
        _filter: {},
        _patch: null,
        _isUpdate: false,
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        update(patch) {
          this._patch = patch;
          this._isUpdate = true;
          return this;
        },
        async single() {
          const rows = (tableConfig.rows || []).filter((r) =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v),
          );
          const match = rows[0];
          return { data: match || null, error: match ? null : { code: "PGRST116" } };
        },
        // Update path: when then() / await is hit on the builder without single().
        // The handler awaits the chain directly, so we expose .then() to make
        // the builder thenable for update operations.
        then(resolve) {
          if (this._isUpdate) {
            updates.push({ table, filter: { ...this._filter }, patch: this._patch });
            const failure = tableConfig.updateError;
            resolve(failure ? { error: failure } : { error: null });
          } else {
            resolve({ data: null, error: null });
          }
        },
      };
    },
  };
  return sb;
}

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PERSONA_ID = "22222222-2222-2222-2222-222222222222";
const TOKEN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FRESH_TOKEN = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CLIENT_ID = "c-owner";
const OTHER_CLIENT_ID = "c-other";

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({ client: { id: CLIENT_ID }, isAdmin: false }),
    setCors: () => {},
    randomUUID: () => FRESH_TOKEN,
    supabase: makeSupabase({
      personas: {
        rows: [
          {
            id: PERSONA_ID,
            client_id: CLIENT_ID,
            client_share_token: TOKEN,
            client_user_id: null,
            name: "Test Persona",
            title: "Setter",
            avatar: null,
          },
        ],
      },
    }),
    ...overrides,
  };
}

async function loadHandler() {
  const mod = await import("../api/v2/personas/share-token.js");
  return mod.default;
}

describe("api/v2/personas/share-token", () => {
  it("returns 200 + ends on OPTIONS", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "OPTIONS" }, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._ended, true);
  });

  it("returns 405 on PATCH", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "PATCH" }, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  describe("GET ?token=<uuid>", () => {
    it("400 when token missing", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler({ method: "GET", query: {} }, res, baseDeps());
      assert.equal(res.statusCode, 400);
    });

    it("400 when token is not a uuid", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler({ method: "GET", query: { token: "abc" } }, res, baseDeps());
      assert.equal(res.statusCode, 400);
    });

    it("404 when token does not match any persona", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler(
        { method: "GET", query: { token: "ffffffff-ffff-ffff-ffff-ffffffffffff" } },
        res,
        baseDeps(),
      );
      assert.equal(res.statusCode, 404);
    });

    it("200 + persona preview without auth", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps({
        // GET should not call authenticateRequest at all.
        authenticateRequest: async () => { throw new Error("must not be called"); },
      });
      await handler({ method: "GET", query: { token: TOKEN } }, res, deps);
      assert.equal(res.statusCode, 200);
      assert.equal(res._body.persona.id, PERSONA_ID);
      assert.equal(res._body.persona.name, "Test Persona");
      assert.equal(res._body.already_claimed, false);
    });

    it("flags already_claimed when client_user_id is set", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      deps.supabase = makeSupabase({
        personas: {
          rows: [{
            id: PERSONA_ID,
            client_share_token: TOKEN,
            client_user_id: "some-client",
            name: "X", title: null, avatar: null,
          }],
        },
      });
      await handler({ method: "GET", query: { token: TOKEN } }, res, deps);
      assert.equal(res.statusCode, 200);
      assert.equal(res._body.already_claimed, true);
    });
  });

  describe("POST { persona_id }", () => {
    it("400 when persona_id missing or invalid", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler({ method: "POST", body: { persona_id: "x" } }, res, baseDeps());
      assert.equal(res.statusCode, 400);
    });

    it("404 when persona not found", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      deps.supabase = makeSupabase({ personas: { rows: [] } });
      await handler({ method: "POST", body: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 404);
    });

    it("403 when caller is not the persona owner", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps({
        authenticateRequest: async () => ({ client: { id: OTHER_CLIENT_ID }, isAdmin: false }),
      });
      await handler({ method: "POST", body: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 403);
    });

    it("admin can generate even when not the owner", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps({
        authenticateRequest: async () => ({ client: null, isAdmin: true }),
      });
      await handler({ method: "POST", body: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 200);
      assert.equal(res._body.token, FRESH_TOKEN);
    });

    it("200 + new token + train_url; writes update with new token", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      await handler({ method: "POST", body: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 200);
      assert.equal(res._body.token, FRESH_TOKEN);
      assert.match(res._body.train_url, /\/train\//);
      assert.equal(deps.supabase._updates.length, 1);
      assert.deepEqual(deps.supabase._updates[0].patch, { client_share_token: FRESH_TOKEN });
      assert.equal(deps.supabase._updates[0].filter.id, PERSONA_ID);
    });
  });

  describe("PUT ?token=<uuid> (claim)", () => {
    it("400 when token missing or invalid", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler({ method: "PUT", query: {} }, res, baseDeps());
      assert.equal(res.statusCode, 400);
    });

    it("401 when authenticated client is null", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps({
        authenticateRequest: async () => ({ client: null, isAdmin: false }),
      });
      await handler({ method: "PUT", query: { token: TOKEN } }, res, deps);
      assert.equal(res.statusCode, 401);
    });

    it("404 when token does not match", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler(
        { method: "PUT", query: { token: "ffffffff-ffff-ffff-ffff-ffffffffffff" } },
        res,
        baseDeps(),
      );
      assert.equal(res.statusCode, 404);
    });

    it("409 when persona already claimed by another client", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      deps.supabase = makeSupabase({
        personas: {
          rows: [{ id: OTHER_PERSONA_ID, client_share_token: TOKEN, client_user_id: OTHER_CLIENT_ID }],
        },
      });
      await handler({ method: "PUT", query: { token: TOKEN } }, res, deps);
      assert.equal(res.statusCode, 409);
    });

    it("200 + sets client_user_id when first claim", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      await handler({ method: "PUT", query: { token: TOKEN } }, res, deps);
      assert.equal(res.statusCode, 200);
      assert.equal(res._body.persona_id, PERSONA_ID);
      assert.equal(deps.supabase._updates.length, 1);
      assert.deepEqual(deps.supabase._updates[0].patch, { client_user_id: CLIENT_ID });
    });

    it("200 + idempotent when same client re-claims", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      deps.supabase = makeSupabase({
        personas: {
          rows: [{ id: PERSONA_ID, client_share_token: TOKEN, client_user_id: CLIENT_ID }],
        },
      });
      await handler({ method: "PUT", query: { token: TOKEN } }, res, deps);
      assert.equal(res.statusCode, 200);
      // No update needed — already linked.
      assert.equal(deps.supabase._updates.length, 0);
    });
  });

  describe("DELETE ?persona_id=<uuid> (revoke)", () => {
    it("400 when persona_id missing or invalid", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      await handler({ method: "DELETE", query: {} }, res, baseDeps());
      assert.equal(res.statusCode, 400);
    });

    it("404 when persona not found", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      deps.supabase = makeSupabase({ personas: { rows: [] } });
      await handler({ method: "DELETE", query: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 404);
    });

    it("403 when caller is not the owner", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps({
        authenticateRequest: async () => ({ client: { id: OTHER_CLIENT_ID }, isAdmin: false }),
      });
      await handler({ method: "DELETE", query: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 403);
    });

    it("200 + nullifies client_share_token (preserves client_user_id)", async () => {
      const handler = await loadHandler();
      const res = makeRes();
      const deps = baseDeps();
      await handler({ method: "DELETE", query: { persona_id: PERSONA_ID } }, res, deps);
      assert.equal(res.statusCode, 200);
      assert.equal(res._body.ok, true);
      assert.equal(deps.supabase._updates.length, 1);
      assert.deepEqual(deps.supabase._updates[0].patch, { client_share_token: null });
      // Important: client_user_id MUST NOT be touched (audit invariant).
      assert.equal("client_user_id" in deps.supabase._updates[0].patch, false);
    });
  });
});

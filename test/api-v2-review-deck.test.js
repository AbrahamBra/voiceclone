import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "c-1";

function makeRes() {
  return {
    statusCode: 200,
    _headers: {},
    _body: null,
    _ended: false,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    send(b) { this._body = b; return this; },
    end() { this._ended = true; return this; },
  };
}

function baseDeps(overrides = {}) {
  const calls = { buildReviewDeck: [] };
  return {
    authenticateRequest: async () => ({ client: { id: CLIENT_ID }, isAdmin: false }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: {},
    buildReviewDeck: async (_sb, personaId) => {
      calls.buildReviewDeck.push(personaId);
      return { flavor: "ongoing", markdown: "# Protocole Thomas\n" };
    },
    _calls: calls,
    ...overrides,
  };
}

async function loadHandler() {
  const mod = await import("../api/v2/review-deck.js");
  return mod.default;
}

describe("GET /api/v2/review-deck", () => {
  it("returns 200 + text/markdown on nominal case", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._headers["content-type"], "text/markdown; charset=utf-8");
    assert.match(res._body, /^# Protocole Thomas/);
  });

  it("returns 405 on POST", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "POST", query: { persona_id: PERSONA_ID } }, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("handles OPTIONS (CORS preflight)", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "OPTIONS" }, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._ended, true);
  });

  it("returns 400 if persona_id missing", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /persona_id/);
  });

  it("returns 400 if persona_id is not a UUID", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: { persona_id: "not-a-uuid" } }, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 401/403 on auth failure", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      authenticateRequest: async () => {
        const e = new Error("auth");
        e.status = 401;
        e.error = "Unauthorized";
        throw e;
      },
    });
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, deps);
    assert.equal(res.statusCode, 401);
  });

  it("returns 403 when client lacks persona access (non-admin)", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({ hasPersonaAccess: async () => false });
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, deps);
    assert.equal(res.statusCode, 403);
  });

  it("admin bypasses hasPersonaAccess check", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    let accessChecked = false;
    const deps = baseDeps({
      authenticateRequest: async () => ({ client: { id: CLIENT_ID }, isAdmin: true }),
      hasPersonaAccess: async () => { accessChecked = true; return false; },
    });
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(accessChecked, false);
  });

  it("returns 404 when persona not found", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      buildReviewDeck: async () => {
        const e = new Error("persona not found");
        e.code = "NOT_FOUND_PERSONA";
        throw e;
      },
    });
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, deps);
    assert.equal(res.statusCode, 404);
    assert.match(res._body.error, /n'existe pas/);
  });

  it("returns 404 when persona has no protocol", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      buildReviewDeck: async () => {
        const e = new Error("persona has no protocol");
        e.code = "NOT_FOUND_PROTOCOL";
        throw e;
      },
    });
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, deps);
    assert.equal(res.statusCode, 404);
    assert.match(res._body.error, /pas encore de protocole/);
  });

  it("returns 500 on unexpected error", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      buildReviewDeck: async () => { throw new Error("boom"); },
    });
    await handler({ method: "GET", query: { persona_id: PERSONA_ID } }, res, deps);
    assert.equal(res.statusCode, 500);
  });
});

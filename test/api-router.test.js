import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import router from "../api/[...path].js";

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.end = () => res;
  res.setHeader = () => res;
  return res;
}

describe("api router", () => {
  it("routes a nested path via the rewrite query (__path) and strips routing keys", async () => {
    const req = {
      method: "OPTIONS",
      url: "/api/[...path]?__path=v2/persona-settings&persona=x",
      query: { __path: "v2/persona-settings", persona: "x" },
      headers: {},
    };
    const res = mockRes();
    await router(req, res);
    // persona-settings répond 200 aux preflight OPTIONS (setCors) — preuve que le bon handler a été appelé
    assert.equal(res.statusCode, 200);
    assert.deepEqual(req.query, { persona: "x" });
  });

  it("routes via Vercel's generated single-segment query (...path as array)", async () => {
    const req = { method: "OPTIONS", url: "/api/personas", query: { "...path": ["personas"] }, headers: {} };
    const res = mockRes();
    await router(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(req.query, {});
  });

  it("falls back to the URL pathname when no routing key is present", async () => {
    const req = { method: "OPTIONS", url: "/api/v2/protocol/extract?x=1", query: { x: "1" }, headers: {} };
    const res = mockRes();
    await router(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(req.query, { x: "1" });
  });

  it("returns 404 JSON for an unknown route", async () => {
    const req = { method: "GET", url: "/api/nope", query: { __path: "nope" }, headers: {} };
    const res = mockRes();
    await router(req, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Not found" });
  });
});

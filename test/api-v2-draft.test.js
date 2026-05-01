import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// DI pattern : the handler accepts an optional `deps` 3rd arg so tests can
// stub auth, DB, persona, prompt, generation. Mirrors api/v2/protocol.test.js.

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

const PERSONA = {
  id: "p1",
  client_id: "c1",
  voice: { forbiddenWords: ["synergie"], writingRules: ["Court"] },
  scenarios: { default: { slug: "default" } },
};

function baseDeps(overrides = {}) {
  return {
    rateLimit: async () => ({ allowed: true }),
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
    checkBudget: () => ({ allowed: true, remaining_cents: 1000 }),
    getApiKey: () => "test-key",
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: {},
    logUsage: async () => {},
    getPersonaFromDb: async () => PERSONA,
    loadScenarioFromDb: async () => "scenario content",
    getCorrectionsFromDb: async () => null,
    findRelevantEntities: async () => ({ entities: [], relations: [], boostTerms: [] }),
    getActiveHardRules: async () => [],
    getActiveArtifactsForPersona: async () => [],
    buildSystemPrompt: () => ({
      prompt: "system",
      detectedPages: [],
      injectedEntities: [],
      injectedCorrectionsCount: 0,
    }),
    checkResponse: () => ({ violations: [], passed: true, shouldRewrite: false }),
    inlineFidelityCheck: async () => null,
    selectModel: () => ({ model: "claude-haiku-4-5-20251001", score: 0, reason: "test" }),
    isScenarioId: () => false,
    log: () => {},
    generate: async () => ({
      content: [{ type: "text", text: "Salut, j'ai vu ton post sur l'IA. T'es en exploration ou déjà en prod ?" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    }),
    ...overrides,
  };
}

describe("POST /api/v2/draft", () => {
  it("405 on GET", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "GET", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("200 on OPTIONS preflight", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "OPTIONS", headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
  });

  it("429 when rate-limited", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx ctx ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      rateLimit: async () => ({ allowed: false, retryAfter: 30 }),
    }));
    assert.equal(res.statusCode, 429);
    assert.equal(res._body.retryAfter, 30);
  });

  it("403 on auth failure", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      authenticateRequest: async () => { throw { status: 403, error: "bad" }; },
    }));
    assert.equal(res.statusCode, 403);
  });

  it("402 on budget exceeded", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      checkBudget: () => ({ allowed: false, remaining_cents: 0 }),
    }));
    assert.equal(res.statusCode, 402);
  });

  it("400 when personaId missing", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /personaId/);
  });

  it("400 when prospectContext missing", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /prospectContext/);
  });

  it("400 when prospectContext too long", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospectContext: "x".repeat(10001) },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /too long/);
  });

  it("400 when history has bad role", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: {
        personaId: "p1", prospectContext: "ok",
        history: [{ role: "system", content: "bad" }],
      },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("404 when persona missing", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "missing", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({ getPersonaFromDb: async () => null }));
    assert.equal(res.statusCode, 404);
  });

  it("403 when persona belongs to another client and access denied", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      authenticateRequest: async () => ({ client: { id: "OTHER" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    }));
    assert.equal(res.statusCode, 403);
  });

  it("200 + draft + confidence=1 on clean generation", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "Alex DG PME 50p, post sur IA" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.ok(res._body.draft.length > 0);
    assert.equal(res._body.confidence, 1.0);
    assert.equal(res._body.rewritten, false);
    assert.equal(res._body.violations.length, 0);
    assert.equal(res._body.tokens.input, 1500);
    assert.equal(res._body.tokens.output, 50);
    assert.ok(res._body.ms >= 0);
  });

  it("confidence drops on violations", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      checkResponse: () => ({
        violations: [{ type: "forbidden_word", severity: "hard", detail: "synergie" }],
        passed: false, shouldRewrite: true,
      }),
    }));
    assert.equal(res.statusCode, 200);
    // 1 hard => 1.0 - 0.4 = 0.6
    assert.equal(res._body.confidence, 0.6);
    assert.equal(res._body.violations.length, 1);
    // rewrite=false by default => no rewrite triggered
    assert.equal(res._body.rewritten, false);
  });

  it("rewrites when rewrite=true and hard violation present", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospectContext: "ctx", rewrite: true },
    };
    const res = makeRes();
    let calls = 0;
    let firstChecksDone = false;
    await handler(req, res, baseDeps({
      generate: async () => {
        calls++;
        return {
          content: [{ type: "text", text: calls === 1 ? "synergie" : "version corrigée propre" }],
          usage: { input_tokens: 100, output_tokens: 10 },
        };
      },
      checkResponse: () => {
        // First call: hard violation. Subsequent recheck: clean.
        if (!firstChecksDone) {
          firstChecksDone = true;
          return {
            violations: [{ type: "forbidden_word", severity: "hard", detail: "synergie" }],
            passed: false, shouldRewrite: true,
          };
        }
        return { violations: [], passed: true, shouldRewrite: false };
      },
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2, "generate called twice (initial + rewrite)");
    assert.equal(res._body.rewritten, true);
    assert.equal(res._body.draft, "version corrigée propre");
    assert.equal(res._body.violations.length, 0);
    assert.equal(res._body.confidence, 1.0);
  });

  it("502 when generate throws", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      generate: async () => { throw new Error("anthropic 500"); },
    }));
    assert.equal(res.statusCode, 502);
    assert.match(res._body.error, /Generation failed/);
  });

  it("survives partial DB failures (corrections + entities)", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      getCorrectionsFromDb: async () => { throw new Error("db down"); },
      findRelevantEntities: async () => { throw new Error("voyage 503"); },
    }));
    assert.equal(res.statusCode, 200, "best-effort loaders must not 5xx");
  });

  it("computeConfidence math", async () => {
    const { computeConfidence } = await import("../api/v2/draft.js");
    assert.equal(computeConfidence([], null), 1.0);
    assert.equal(computeConfidence([{ severity: "hard" }], null), 0.6);
    assert.equal(computeConfidence([{ severity: "strong" }], null), 0.85);
    assert.equal(computeConfidence([{ severity: "light" }], null), 0.95);
    assert.equal(computeConfidence([], { drifted: true }), 0.75);
    assert.equal(computeConfidence([{ severity: "hard" }], { drifted: true }), 0.35);
  });
});

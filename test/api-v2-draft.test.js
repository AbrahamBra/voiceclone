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
    resolveApiKey: async () => null,
    checkBudget: () => ({ allowed: true, remaining_cents: 1000 }),
    getApiKey: () => "test-key",
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: null,
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
    scrapeLinkedInProfile: async () => null,
    formatScrapeAsContextBlock: () => "",
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

  it("503 + fallback_message when generate throws", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      generate: async () => { throw new Error("anthropic 500"); },
    }));
    assert.equal(res.statusCode, 503);
    assert.match(res._body.error, /Generation failed/);
    assert.match(res._body.fallback_message, /VoiceClone unavailable/);
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

  // ── V3.6.5 — qualification envelope ──────────────────────────
  it("parseQualificationEnvelope returns null + raw text on plain text", async () => {
    const { parseQualificationEnvelope } = await import("../api/v2/draft.js");
    const r = parseQualificationEnvelope("Salut, simple message");
    assert.equal(r.qualification, null);
    assert.equal(r.draft, "Salut, simple message");
  });

  it("parseQualificationEnvelope parses clean JSON envelope", async () => {
    const { parseQualificationEnvelope } = await import("../api/v2/draft.js");
    const json = JSON.stringify({
      qualification: { verdict: "in", reason: "Founder PME 50p", confidence: 0.85 },
      draft: "Salut Alex, vu ton post sur l'IA.",
    });
    const r = parseQualificationEnvelope(json);
    assert.equal(r.qualification.verdict, "in");
    assert.equal(r.qualification.reason, "Founder PME 50p");
    assert.equal(r.qualification.confidence, 0.85);
    assert.equal(r.draft, "Salut Alex, vu ton post sur l'IA.");
  });

  it("parseQualificationEnvelope strips ```json fences", async () => {
    const { parseQualificationEnvelope } = await import("../api/v2/draft.js");
    const fenced = '```json\n{"qualification":{"verdict":"out","reason":"Early stage","confidence":0.2},"draft":"skip"}\n```';
    const r = parseQualificationEnvelope(fenced);
    assert.equal(r.qualification.verdict, "out");
    assert.equal(r.draft, "skip");
  });

  it("parseQualificationEnvelope normalizes bad verdict to uncertain", async () => {
    const { parseQualificationEnvelope } = await import("../api/v2/draft.js");
    const json = JSON.stringify({
      qualification: { verdict: "MAYBE", reason: "x", confidence: 0.5 },
      draft: "ok",
    });
    const r = parseQualificationEnvelope(json);
    assert.equal(r.qualification.verdict, "uncertain");
  });

  it("parseQualificationEnvelope clamps confidence to [0,1]", async () => {
    const { parseQualificationEnvelope } = await import("../api/v2/draft.js");
    const high = parseQualificationEnvelope(JSON.stringify({
      qualification: { verdict: "in", reason: "x", confidence: 1.5 }, draft: "d",
    }));
    assert.equal(high.qualification.confidence, 1);
    const low = parseQualificationEnvelope(JSON.stringify({
      qualification: { verdict: "in", reason: "x", confidence: -0.3 }, draft: "d",
    }));
    assert.equal(low.qualification.confidence, 0);
  });

  it("response includes parsed qualification when generate emits envelope", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx" } };
    const res = makeRes();
    const envelope = JSON.stringify({
      qualification: { verdict: "in", reason: "PME 50p", confidence: 0.9 },
      draft: "Salut Alex.",
    });
    await handler(req, res, baseDeps({
      generate: async () => ({ content: [{ type: "text", text: envelope }], usage: { input_tokens: 100, output_tokens: 30 } }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.draft, "Salut Alex.");
    assert.equal(res._body.qualification.verdict, "in");
    assert.equal(res._body.qualification.confidence, 0.9);
  });

  // ── V3.6.5 — body shape v2 (snake_case + prospect_data) ──────
  it("accepts persona_id + prospect_data shape", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: { persona_id: "p1", prospect_data: { context: "Alex DG PME" } },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.ok(res._body.draft.length > 0);
  });

  it("warnings includes notice when source_core absent", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = { method: "POST", headers: {}, body: { personaId: "p1", prospectContext: "ctx ctx" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res._body.warnings));
    assert.match(res._body.warnings[0], /source_core/);
  });

  it("no source_core warning when valid value provided", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospectContext: "ctx", source_core: "visite_profil" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.warnings, undefined);
  });

  // ── V3.6.5 — auto-scrape from linkedin_url ──────────────────
  it("auto-scrape fires when linkedin_url + no inline context", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: {
        personaId: "p1",
        prospect_data: { linkedin_url: "https://linkedin.com/in/alexdg" },
      },
    };
    const res = makeRes();
    let scrapeCalled = false;
    await handler(req, res, baseDeps({
      scrapeLinkedInProfile: async (url) => {
        scrapeCalled = true;
        assert.match(url, /alexdg/);
        return { profile: { name: "Alex DG", headline: "Founder", text: "Profile body" }, posts: [], postCount: 0 };
      },
      formatScrapeAsContextBlock: (s) => `[Contexte lead — ${s.profile.name}]\n${s.profile.headline}`,
    }));
    assert.equal(res.statusCode, 200);
    assert.ok(scrapeCalled, "scrapeLinkedInProfile should have been called");
  });

  it("auto-scrape skipped when prospectContext already has [Contexte lead] block", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: {
        personaId: "p1",
        prospect_data: {
          linkedin_url: "https://linkedin.com/in/alexdg",
          context: "[Contexte lead — Alex DG]\nFounder of X",
        },
      },
    };
    const res = makeRes();
    let scrapeCalled = false;
    await handler(req, res, baseDeps({
      scrapeLinkedInProfile: async () => { scrapeCalled = true; return null; },
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(scrapeCalled, false, "scrape skipped when block already present");
  });

  it("503 when scrape fails AND no manual context provided", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospect_data: { linkedin_url: "https://linkedin.com/in/x" } },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      scrapeLinkedInProfile: async () => null,
    }));
    assert.equal(res.statusCode, 503);
    assert.match(res._body.error, /scrape failed/);
    assert.match(res._body.fallback_message, /VoiceClone unavailable/);
  });

  // ── V3.6.5 — idempotency via external_lead_ref ──────────────
  it("idempotency: returns existing conv when external_lead_ref maps to one", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    let generateCalled = false;
    const fakeSupabase = makeFakeSupabase({
      conversations: [{ id: "conv-existing", persona_id: "p1", external_lead_ref: "breakcold:abc" }],
      messages: [{ id: "msg-existing", conversation_id: "conv-existing", role: "assistant", content: "Salut Alex (existing).", created_at: "2026-05-01T10:00:00Z" }],
    });
    const req = {
      method: "POST", headers: {},
      body: {
        personaId: "p1",
        prospectContext: "ctx",
        external_lead_ref: "breakcold:abc",
      },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: fakeSupabase,
      generate: async () => { generateCalled = true; return { content: [{ type: "text", text: "shouldnotcall" }], usage: {} }; },
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.idempotent, true);
    assert.equal(res._body.conversation_id, "conv-existing");
    assert.equal(res._body.draft_id, "msg-existing");
    assert.equal(res._body.draft, "Salut Alex (existing).");
    assert.equal(res._body.persona_id, "p1", "persona_id required for n8n deep link template");
    assert.equal(generateCalled, false, "generate must NOT be called on idempotent hit");
  });

  it("idempotency: 409 when external_lead_ref maps to a different persona", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const fakeSupabase = makeFakeSupabase({
      conversations: [{ id: "conv-other", persona_id: "p-OTHER", external_lead_ref: "breakcold:abc" }],
      messages: [],
    });
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospectContext: "ctx", external_lead_ref: "breakcold:abc" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: fakeSupabase }));
    assert.equal(res.statusCode, 409);
    assert.match(res._body.error, /different persona/);
  });

  // ── V3.6.5 — conv creation when external_lead_ref + no existing ──
  it("creates conv with lifecycle_state='awaiting_send' when external_lead_ref new", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const fakeSupabase = makeFakeSupabase({ conversations: [], messages: [] });
    const req = {
      method: "POST", headers: {},
      body: {
        personaId: "p1",
        prospectContext: "Alex DG PME 50p",
        external_lead_ref: "breakcold:newlead",
        source_core: "visite_profil",
      },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: fakeSupabase }));
    assert.equal(res.statusCode, 200);
    assert.ok(res._body.conversation_id, "conversation_id must be returned");
    assert.ok(res._body.draft_id, "draft_id (assistant message id) must be returned");
    assert.equal(res._body.persona_id, "p1", "persona_id required for n8n deep link template");
    const inserted = fakeSupabase.tables.conversations[0];
    assert.equal(inserted.external_lead_ref, "breakcold:newlead");
    assert.equal(inserted.lifecycle_state, "awaiting_send");
    assert.equal(inserted.source_core, "visite_profil");
    assert.equal(inserted.persona_id, "p1");
  });

  it("response includes persona_id on stateless path (no external_lead_ref)", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospectContext: "Alex DG PME 50p" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.persona_id, "p1", "persona_id required for n8n deep link template");
  });

  // ── V3.6.5 — API key auth path ──────────────────────────────
  it("API key auth pins persona; rejects mismatched personaId", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const apiKeyPersona = { ...PERSONA, id: "p-fromkey" };
    const req = {
      method: "POST", headers: { "x-api-key": "sk_test" },
      body: { personaId: "p1", prospectContext: "ctx" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      resolveApiKey: async () => ({ persona: apiKeyPersona, client: { id: "c1" }, keyId: "k1", isAdmin: false }),
    }));
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /persona pinned by the API key/);
  });

  it("API key auth: aligned personaId proceeds normally", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    const req = {
      method: "POST", headers: { "x-api-key": "sk_test" },
      body: { personaId: "p1", prospectContext: "ctx" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      resolveApiKey: async () => ({ persona: PERSONA, client: { id: "c1" }, keyId: "k1", isAdmin: false }),
    }));
    assert.equal(res.statusCode, 200);
  });

  it("API key auth: body without persona_id proceeds (key pins the persona)", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    // Reproduces the n8n / Breakcold call shape : x-api-key header, body
    // carries prospect_data + source_core + external_lead_ref but NO
    // persona_id. The key alone resolves the persona.
    const req = {
      method: "POST", headers: { "x-api-key": "sk_test" },
      body: {
        prospect_data: { context: "Alex DG PME 50p, post sur IA" },
        source_core: "interaction_contenu",
        external_lead_ref: "breakcold:42",
      },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      resolveApiKey: async () => ({ persona: PERSONA, client: { id: "c1" }, keyId: "k1", isAdmin: false }),
    }));
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res._body)}`);
    assert.equal(res._body.persona_id, "p1");
    assert.ok(res._body.draft.length > 0);
  });

  it("validate(): personaId still required without API key context", async () => {
    const { validate } = await import("../api/v2/draft.js");
    assert.match(validate({ prospectContext: "x" }), /personaId is required/);
    assert.equal(validate({ prospect_data: { context: "x" } }, { apiKeyPinsPersona: true }), null);
  });

  it("hard-fails 500 + fallback_draft when API key persona has no client_id", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    // API key resolves the persona but client=null (persona.client_id was null).
    // Without external_lead_ref the legacy stateless path proceeds — so we
    // also pass external_lead_ref to enter the persistence branch.
    const fakeSupabase = makeFakeSupabase({ conversations: [], messages: [] });
    const req = {
      method: "POST", headers: { "x-api-key": "sk_test" },
      body: { prospect_data: { context: "ctx" }, external_lead_ref: "breakcold:noclient" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: fakeSupabase,
      resolveApiKey: async () => ({ persona: PERSONA, client: null, keyId: "k1", isAdmin: false }),
    }));
    assert.equal(res.statusCode, 500);
    assert.equal(res._body.code, "no_client_id");
    assert.match(res._body.error, /no owning client/);
    assert.ok(res._body.fallback_draft, "fallback_draft must be returned for n8n note");
  });

  it("hard-fails 500 + fallback_draft on conv insert error (non-23505)", async () => {
    const { default: handler } = await import("../api/v2/draft.js");
    // Coerce fake supabase to error on insert (simulate FK / NOT NULL).
    const fakeSupabase = makeFakeSupabase({ conversations: [], messages: [] });
    const realFrom = fakeSupabase.from.bind(fakeSupabase);
    fakeSupabase.from = (table) => {
      const ref = realFrom(table);
      if (table === "conversations") {
        return { ...ref, insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23502", message: "null value in column client_id" } }) }) }) };
      }
      return ref;
    };
    const req = {
      method: "POST", headers: {},
      body: { personaId: "p1", prospectContext: "ctx", external_lead_ref: "breakcold:hardfail" },
    };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: fakeSupabase }));
    assert.equal(res.statusCode, 500);
    assert.equal(res._body.code, "23502");
    assert.match(res._body.error, /Failed to persist conversation/);
    assert.ok(res._body.fallback_draft, "fallback_draft must be returned for n8n note");
  });
});

// ────────────────────────────────────────────────────────────────────
// Minimal in-memory fake supabase for the tests that exercise the conv-
// creation path. Implements just the chain used by the handler :
//   .from(table).select(cols).eq(col, val).maybeSingle()
//   .from(table).insert(row).select(cols).single()
//   .from(table).insert(rows).select(cols)
//   .from(table).update(patch).eq(col, val) / .then()
// Returns { data, error } shapes that match @supabase/supabase-js.
// ────────────────────────────────────────────────────────────────────
function makeFakeSupabase(seed = {}) {
  const tables = {
    conversations: [...(seed.conversations || [])],
    messages: [...(seed.messages || [])],
  };
  let nextId = 1;
  function newId(prefix) { return `${prefix}-${nextId++}`; }
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
      // Fallback : when chain ends without single/maybeSingle, used by the
      // "select many" inserted messages path.
      then(resolve) {
        const rows = applyFilters(tables[table] || [], ctx);
        resolve({ data: rows, error: null });
      },
    };
    function insertable(rows) {
      const inputs = Array.isArray(rows) ? rows : [rows];
      const inserted = inputs.map((r) => {
        // Idempotency: simulate the unique partial index on external_lead_ref.
        if (table === "conversations" && r.external_lead_ref) {
          const dup = tables.conversations.find((c) => c.external_lead_ref === r.external_lead_ref);
          if (dup) return null;
        }
        const id = r.id || newId(table.slice(0, 4));
        const row = { id, created_at: new Date().toISOString(), ...r };
        tables[table].push(row);
        return row;
      });
      const allOk = inserted.every(Boolean);
      const insertCtx = {
        select(cols) {
          const back = {
            single: async () => {
              if (!allOk) return { data: null, error: { code: "23505", message: "duplicate" } };
              return { data: inserted[0], error: null };
            },
            then(resolve) {
              if (!allOk) return resolve({ data: null, error: { code: "23505", message: "duplicate" } });
              resolve({ data: inserted, error: null });
            },
          };
          return back;
        },
        then(resolve) {
          if (!allOk) return resolve({ data: null, error: { code: "23505", message: "duplicate" } });
          resolve({ data: inserted, error: null });
        },
      };
      return insertCtx;
    }
    function updatable(patch) {
      const updateCtx = {
        eq(col, val) {
          for (const row of tables[table]) {
            if (row[col] === val) Object.assign(row, patch);
          }
          updateCtx._ran = true;
          return updateCtx;
        },
        then(resolve) { resolve({ data: null, error: null }); },
      };
      return updateCtx;
    }
    return {
      ...queryable,
      insert: insertable,
      update: updatable,
    };
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

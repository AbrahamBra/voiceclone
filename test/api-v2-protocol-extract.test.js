import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/protocol/extract.js";

const VALID_UUID_DOC = "00000000-0000-0000-0000-000000000001";
const VALID_UUID_SECTION = "00000000-0000-0000-0000-000000000002";

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    setHeader: () => {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

function makeSupabase({
  document = { id: VALID_UUID_DOC, owner_kind: "persona", owner_id: "persona-1" },
  section = { id: VALID_UUID_SECTION, document_id: VALID_UUID_DOC, kind: "hard_rules", heading: "Règles" },
  saveError = null,
} = {}) {
  return {
    updates: [],
    from(table) {
      if (table === "protocol_document") {
        return {
          select() { return this; },
          eq() { return this; },
          single: () => Promise.resolve(
            document
              ? { data: document, error: null }
              : { data: null, error: { message: "not found" } },
          ),
        };
      }
      if (table === "protocol_section") {
        return {
          select() { return this; },
          eq(col, val) { this._lastEq = { col, val }; return this; },
          single: () => Promise.resolve(
            section
              ? { data: section, error: null }
              : { data: null, error: { message: "not found" } },
          ),
          update: (payload) => {
            this.updates ||= [];
            return {
              eq: (col, val) => {
                if (this._upd_payload === undefined) this._upd_payload = payload;
                return Promise.resolve(saveError ? { error: { message: saveError } } : { error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseDeps = {
  authenticateRequest: async () => ({ client: { id: "user-1" }, isAdmin: false }),
  hasPersonaAccess: async () => true,
  setCors: () => {},
  routeAndExtract: async () => [],
};

const sampleProse =
  "Jamais plus de deux questions par message. Toujours mentionner un signal concret du profil.";

describe("api/v2/protocol/extract — guards", () => {
  it("405 on non-POST", async () => {
    const res = makeRes();
    await handler({ method: "GET", body: {} }, res, baseDeps);
    assert.equal(res.statusCode, 405);
  });

  it("200 on OPTIONS preflight", async () => {
    const res = makeRes();
    await handler({ method: "OPTIONS", body: {} }, res, baseDeps);
    assert.equal(res.statusCode, 200);
  });

  it("400 when document_id missing or invalid", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: {} }, res, baseDeps);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /document_id/);

    const res2 = makeRes();
    await handler({ method: "POST", body: { document_id: "nope" } }, res2, baseDeps);
    assert.equal(res2.statusCode, 400);
  });

  it("400 when section_id missing or invalid", async () => {
    const res = makeRes();
    await handler(
      { method: "POST", body: { document_id: VALID_UUID_DOC } },
      res,
      baseDeps,
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /section_id/);
  });

  it("400 when prose is missing or wrong type", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: 42 },
      },
      res,
      baseDeps,
    );
    assert.equal(res.statusCode, 400);
  });

  it("400 when prose is too long", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: {
          document_id: VALID_UUID_DOC,
          section_id: VALID_UUID_SECTION,
          prose: "x".repeat(30000),
        },
      },
      res,
      { ...baseDeps, supabase: makeSupabase() },
    );
    assert.equal(res.statusCode, 400);
  });
});

describe("api/v2/protocol/extract — auth", () => {
  it("403 when authenticateRequest throws", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: "..." },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase(),
        authenticateRequest: async () => {
          const e = new Error("no");
          e.status = 401;
          e.error = "no token";
          throw e;
        },
      },
    );
    assert.equal(res.statusCode, 401);
  });

  it("403 when persona access denied", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      { ...baseDeps, supabase: makeSupabase(), hasPersonaAccess: async () => false },
    );
    assert.equal(res.statusCode, 403);
  });

  it("404 when document not found", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      { ...baseDeps, supabase: makeSupabase({ document: null }) },
    );
    assert.equal(res.statusCode, 404);
  });

  it("404 when section not found", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      { ...baseDeps, supabase: makeSupabase({ section: null }) },
    );
    assert.equal(res.statusCode, 404);
  });

  it("403 when section belongs to a different document", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase({
          section: {
            id: VALID_UUID_SECTION,
            document_id: "other-doc-id",
            kind: "hard_rules",
            heading: "Wrong",
          },
        }),
      },
    );
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /document/);
  });
});

describe("api/v2/protocol/extract — happy paths", () => {
  it("saves prose and returns extracted candidates", async () => {
    const res = makeRes();
    let extractCalls = 0;
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase(),
        routeAndExtract: async (signal) => {
          extractCalls++;
          assert.equal(signal.source_type, "prose_edit");
          assert.equal(signal.context.section_kind, "hard_rules");
          return [
            {
              target_kind: "hard_rules",
              proposal: {
                intent: "add_rule",
                target_kind: "hard_rules",
                proposed_text: "Max 2 questions par message.",
                rationale: "from prose",
                confidence: 0.9,
              },
            },
          ];
        },
      },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.saved, true);
    assert.equal(res.body.candidates.length, 1);
    assert.equal(res.body.candidates[0].target_kind, "hard_rules");
    assert.equal(res.body.candidates[0].confidence, 0.9);
    assert.equal(extractCalls, 1);
  });

  it("kill-switch off → saves prose, returns empty candidates, no extractor call", async () => {
    const res = makeRes();
    let extractCalls = 0;
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase(),
        killSwitch: "off",
        routeAndExtract: async () => {
          extractCalls++;
          return [];
        },
      },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.saved, true);
    assert.deepEqual(res.body.candidates, []);
    assert.equal(extractCalls, 0);
  });

  it("returns empty candidates when extraction times out (still saves prose)", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase(),
        routeAndExtract: () => new Promise(() => {}), // hang
        extractionTimeoutMs: 50,
      },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.saved, true);
    assert.deepEqual(res.body.candidates, []);
    assert.match(res.body.extraction_error, /timeout/);
  });

  it("returns empty candidates when extractor throws (still saves prose)", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase(),
        routeAndExtract: async () => {
          throw new Error("router blew up");
        },
      },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.saved, true);
    assert.deepEqual(res.body.candidates, []);
    assert.match(res.body.extraction_error, /blew up|router|failed/);
  });

  it("500 when prose save fails", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      { ...baseDeps, supabase: makeSupabase({ saveError: "db down" }) },
    );
    assert.equal(res.statusCode, 500);
  });

  it("trims candidate fields to public shape (no embedding leak)", async () => {
    const res = makeRes();
    await handler(
      {
        method: "POST",
        body: { document_id: VALID_UUID_DOC, section_id: VALID_UUID_SECTION, prose: sampleProse },
      },
      res,
      {
        ...baseDeps,
        supabase: makeSupabase(),
        routeAndExtract: async () => [
          {
            target_kind: "hard_rules",
            proposal: {
              intent: "add_rule",
              target_kind: "hard_rules",
              proposed_text: "Max 2 questions par message.",
              rationale: "...",
              confidence: 0.9,
              embedding: new Array(1024).fill(0.01), // would-be leak
              internal_debug: "secret",
            },
          },
        ],
      },
    );
    assert.equal(res.statusCode, 200);
    const c = res.body.candidates[0];
    assert.equal(c.embedding, undefined);
    assert.equal(c.internal_debug, undefined);
    assert.deepEqual(Object.keys(c).sort(), [
      "confidence",
      "intent",
      "proposed_text",
      "rationale",
      "target_kind",
    ]);
  });
});

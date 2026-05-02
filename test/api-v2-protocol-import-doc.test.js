import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler, { chunkDoc } from "../api/v2/protocol/import-doc.js";

const VALID_PERSONA = "00000000-0000-0000-0000-000000000010";
const VALID_DOC = "00000000-0000-0000-0000-000000000020";

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
  document = { id: VALID_DOC },
  insertResult = (row) => ({
    data: {
      id: `prop-${Math.random().toString(36).slice(2, 8)}`,
      target_kind: row.target_kind,
      intent: row.intent,
      proposed_text: row.proposed_text,
      rationale: row.rationale,
      confidence: row.confidence,
    },
    error: null,
  }),
  updateError = null,
} = {}) {
  const inserts = [];
  const updates = [];
  return {
    inserts,
    updates,
    from(table) {
      if (table === "protocol_document") {
        return {
          select() { return this; },
          eq() { return this; },
          is() { return this; },
          limit() { return this; },
          maybeSingle: () => Promise.resolve(
            document
              ? { data: document, error: null }
              : { data: null, error: null },
          ),
        };
      }
      if (table === "proposition") {
        const builder = {
          _filter: {},
          insert(row) {
            inserts.push(row);
            return {
              select: () => ({
                single: () => Promise.resolve(insertResult(row)),
              }),
            };
          },
          update(payload) {
            return {
              eq: (col, val) => {
                updates.push({ payload, [col]: val });
                return Promise.resolve(
                  updateError ? { error: { message: updateError } } : { error: null },
                );
              },
            };
          },
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseDeps = (overrides = {}) => ({
  authenticateRequest: async () => ({ client: { id: "user-1" }, isAdmin: false }),
  hasPersonaAccess: async () => true,
  setCors: () => {},
  routeAndExtract: async () => [],
  embedForProposition: async () => [0.1, 0.2, 0.3],
  findSimilarProposition: async () => [],
  ...overrides,
});

describe("chunkDoc", () => {
  it("returns [] for empty / non-string input", () => {
    assert.deepEqual(chunkDoc(""), []);
    assert.deepEqual(chunkDoc(null), []);
    assert.deepEqual(chunkDoc(undefined), []);
  });

  it("drops paragraphs shorter than MIN_CHUNK_LEN (likely headings)", () => {
    const text = "Title\n\nThis is a much longer paragraph that exceeds the minimum chunk length threshold so it should be kept in the output array.";
    const chunks = chunkDoc(text);
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /much longer paragraph/);
    assert.doesNotMatch(chunks[0], /^Title/);
  });

  it("merges adjacent small paragraphs without exceeding MAX_CHUNK_LEN", () => {
    const para = "Paragraphe assez long pour passer le minimum, ".repeat(3); // ~144 chars
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkDoc(text);
    assert.equal(chunks.length, 1);
    assert(chunks[0].length <= 3500);
  });

  it("hard-splits paragraphs longer than MAX_CHUNK_LEN at sentence boundaries", () => {
    const sentence = "Une phrase de longueur moyenne pour tester le découpage. ";
    const huge = sentence.repeat(80); // ~4500 chars, single para
    const chunks = chunkDoc(huge);
    assert(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
    for (const c of chunks) assert(c.length <= 3500, `chunk too long: ${c.length}`);
  });
});

describe("POST /api/v2/protocol/import-doc — validation", () => {
  it("405 on GET", async () => {
    const req = { method: "GET", body: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });

  it("400 on missing persona_id", async () => {
    const req = { method: "POST", body: { doc_text: "x".repeat(200) } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /persona_id/);
  });

  it("400 on invalid persona_id", async () => {
    const req = { method: "POST", body: { persona_id: "not-a-uuid", doc_text: "x".repeat(200) } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("400 on empty doc_text", async () => {
    const req = { method: "POST", body: { persona_id: VALID_PERSONA, doc_text: "   " } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("400 on doc_text too long", async () => {
    const req = { method: "POST", body: { persona_id: VALID_PERSONA, doc_text: "x".repeat(100_001) } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /too long/);
  });

  it("403 when hasPersonaAccess denies", async () => {
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, doc_text: "Une prose suffisamment longue pour passer le minimum, plusieurs phrases de matière exploitable." },
    };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({ hasPersonaAccess: async () => false }),
    );
    assert.equal(res.statusCode, 403);
  });

  it("404 when persona has no active protocol_document", async () => {
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, doc_text: "Une prose suffisamment longue pour passer le minimum, plusieurs phrases de matière exploitable." },
    };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({ supabase: makeSupabase({ document: null }) }),
    );
    assert.equal(res.statusCode, 404);
  });
});

describe("POST /api/v2/protocol/import-doc — happy path", () => {
  const longProse =
    "Jamais plus de deux questions par message, c'est une règle absolue dans nos DM LinkedIn. " +
    "Notre ICP est un dirigeant entrepreneur de 35 à 55 ans qui plafonne à cause de la structure organisationnelle. " +
    "Le scoring se fait sur trois axes principaux pour qualifier la maturité du prospect avant tout pitch.";

  it("inserts propositions for each candidate above threshold", async () => {
    const supabase = makeSupabase();
    const candidates = [
      {
        target_kind: "hard_rules",
        proposal: {
          intent: "add_rule",
          proposed_text: "Jamais plus de deux questions par message.",
          rationale: "Règle explicite du doc.",
          confidence: 0.9,
        },
      },
      {
        target_kind: "icp_patterns",
        proposal: {
          intent: "add_paragraph",
          proposed_text: "ICP : dirigeant 35-55 ans plafonnant.",
          rationale: "Décrit explicitement.",
          confidence: 0.8,
        },
      },
    ];
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, doc_text: longProse },
    };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({
        supabase,
        routeAndExtract: async () => candidates,
      }),
    );
    assert.equal(res.statusCode, 200, `body: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.propositions_created, 2);
    assert.equal(res.body.propositions_merged, 0);
    assert.equal(supabase.inserts.length, 2);
    assert.equal(supabase.inserts[0].source, "upload_batch");
    assert.equal(supabase.inserts[0].source_refs.length, 1);
    assert.equal(supabase.inserts[0].source_refs[0], res.body.batch_id);
    assert.equal(supabase.inserts[0].status, "pending");
  });

  it("merges into existing similar proposition (no insert)", async () => {
    const supabase = makeSupabase();
    const candidates = [
      {
        target_kind: "hard_rules",
        proposal: {
          intent: "add_rule",
          proposed_text: "Jamais plus de deux questions par message.",
          rationale: "OK",
          confidence: 0.9,
        },
      },
    ];
    const existingProposition = {
      id: "00000000-0000-0000-0000-000000000099",
      source_refs: ["00000000-0000-0000-0000-000000000aaa"],
      count: 1,
    };
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, doc_text: longProse },
    };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({
        supabase,
        routeAndExtract: async () => candidates,
        findSimilarProposition: async () => [existingProposition],
      }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.propositions_created, 0);
    assert.equal(res.body.propositions_merged, 1);
    assert.equal(supabase.inserts.length, 0);
    assert.equal(supabase.updates.length, 1);
    assert.equal(supabase.updates[0].payload.count, 2);
    assert.equal(supabase.updates[0].payload.source_refs.length, 2);
  });

  it("silences candidates below MIN_CONFIDENCE_INSERT", async () => {
    const supabase = makeSupabase();
    const candidates = [
      {
        target_kind: "icp_patterns",
        proposal: {
          intent: "add_paragraph",
          proposed_text: "Pattern faiblement attesté.",
          rationale: "low signal",
          confidence: 0.3,
        },
      },
    ];
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, doc_text: longProse },
    };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({
        supabase,
        routeAndExtract: async () => candidates,
      }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.propositions_created, 0);
    assert.equal(res.body.silenced, 1);
    assert.equal(supabase.inserts.length, 0);
  });

  it("survives partial chunk extraction failures (Promise.allSettled)", async () => {
    const supabase = makeSupabase();
    let callCount = 0;
    // Each paragraph ≥1900 chars → forces 3 separate chunks (cur+next > 3500
    // triggers a flush at each boundary, see chunkDoc logic).
    const bigPara = (longProse + " ").repeat(7);
    const req = {
      method: "POST",
      body: {
        persona_id: VALID_PERSONA,
        doc_text: `${bigPara}\n\n${bigPara}\n\n${bigPara}`,
      },
    };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({
        supabase,
        routeAndExtract: async () => {
          callCount++;
          if (callCount === 2) throw new Error("simulated extractor failure");
          return [
            {
              target_kind: "hard_rules",
              proposal: {
                intent: "add_rule",
                proposed_text: `Règle ${callCount} extraite.`,
                rationale: "ok",
                confidence: 0.8,
              },
            },
          ];
        },
      }),
    );
    assert.equal(res.statusCode, 200);
    // 1 chunk failed, 2 succeeded with 1 candidate each.
    assert.equal(res.body.propositions_created, 2);
  });

  it("returns 400 if doc has no extractable content (all paragraphs too short)", async () => {
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, doc_text: "Hi.\n\nOK.\n\nNo." },
    };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /no extractable/);
  });
});

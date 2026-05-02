import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/protocol/import-batches.js";

const VALID_PERSONA = "00000000-0000-0000-0000-000000000010";
const DOC_ID = "00000000-0000-0000-0000-000000000020";
const BATCH_A = "00000000-0000-0000-0000-0000000000aa";
const BATCH_B = "00000000-0000-0000-0000-0000000000bb";

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    setHeader: () => {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  return res;
}

function makeSb({ doc = { id: DOC_ID }, batches = [], propositions = [] } = {}) {
  return {
    from(table) {
      if (table === "protocol_document") {
        return {
          select() { return this; },
          eq() { return this; },
          is() { return this; },
          limit() { return this; },
          maybeSingle: () => Promise.resolve(
            doc ? { data: doc, error: null } : { data: null, error: null },
          ),
        };
      }
      if (table === "protocol_import_batch") {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          limit: () => Promise.resolve({ data: batches, error: null }),
        };
      }
      if (table === "proposition") {
        return {
          select() { return this; },
          eq() { return this; },
          in: () => Promise.resolve({ data: propositions, error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseDeps = (overrides = {}) => ({
  authenticateRequest: async () => ({ client: { id: "user-1" }, isAdmin: false }),
  hasPersonaAccess: async () => true,
  setCors: () => {},
  ...overrides,
});

describe("GET /api/v2/protocol/import-batches", () => {
  it("405 on POST", async () => {
    const req = { method: "POST", query: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: makeSb() }));
    assert.equal(res.statusCode, 405);
  });

  it("400 when persona is missing", async () => {
    const req = { method: "GET", query: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: makeSb() }));
    assert.equal(res.statusCode, 400);
  });

  it("403 when hasPersonaAccess denies", async () => {
    const req = { method: "GET", query: { persona: VALID_PERSONA } };
    const res = makeRes();
    await handler(
      req,
      res,
      baseDeps({ supabase: makeSb(), hasPersonaAccess: async () => false }),
    );
    assert.equal(res.statusCode, 403);
  });

  it("returns empty list when persona has no protocol_document", async () => {
    const req = { method: "GET", query: { persona: VALID_PERSONA } };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: makeSb({ doc: null }) }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { batches: [] });
  });

  it("returns batches enriched with proposition status counts", async () => {
    const batches = [
      {
        id: BATCH_A,
        document_id: DOC_ID,
        doc_filename: "background.odt",
        doc_kind: "persona_context",
        identity_appended: true,
        identity_chars_added: 1234,
        chunks_processed: 3,
        candidates_total: 0,
        propositions_created: 0,
        propositions_merged: 0,
        silenced: 0,
        created_at: "2026-05-02T12:00:00Z",
      },
    ];
    const propositions = [
      { id: "p1", source_ref: BATCH_A, source_refs: [BATCH_A], status: "pending", target_kind: "icp_patterns" },
      { id: "p2", source_ref: BATCH_A, source_refs: [BATCH_A], status: "accepted", target_kind: "process" },
      { id: "p3", source_ref: BATCH_A, source_refs: [BATCH_A], status: "rejected", target_kind: "hard_rules" },
    ];
    const req = { method: "GET", query: { persona: VALID_PERSONA } };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: makeSb({ batches, propositions }) }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.batches.length, 1);
    const b = res.body.batches[0];
    assert.equal(b.pending_count, 1);
    assert.equal(b.accepted_count, 1);
    assert.equal(b.rejected_count, 1);
    assert.deepEqual(b.overlap_with, []);
    assert.equal(b.identity_appended, true);
  });

  it("detects overlap_with when a proposition's source_refs include another batch id", async () => {
    const batches = [
      { id: BATCH_A, document_id: DOC_ID, doc_filename: "audience.odt", doc_kind: "icp_audience", created_at: "2026-05-02T12:01:00Z" },
      { id: BATCH_B, document_id: DOC_ID, doc_filename: "playbook.pdf", doc_kind: "operational_playbook", created_at: "2026-05-02T12:00:00Z" },
    ];
    // Proposition came from BATCH_B, then a re-import from BATCH_A merged into it.
    const propositions = [
      { id: "p1", source_ref: BATCH_B, source_refs: [BATCH_B, BATCH_A], status: "pending", target_kind: "icp_patterns" },
    ];
    const req = { method: "GET", query: { persona: VALID_PERSONA } };
    const res = makeRes();
    await handler(req, res, baseDeps({ supabase: makeSb({ batches, propositions }) }));
    assert.equal(res.statusCode, 200);
    const bA = res.body.batches.find((b) => b.id === BATCH_A);
    const bB = res.body.batches.find((b) => b.id === BATCH_B);
    // BATCH_B is the canonical source_ref → it has 1 pending. BATCH_A's
    // overlap is detected via source_refs membership.
    assert.equal(bB.pending_count, 1);
    assert.deepEqual(bB.overlap_with, [BATCH_A]);
    // BATCH_A doesn't own this proposition (source_ref ≠ A) so it has 0
    // pending of its own — but we don't surface its inclusion in B as
    // its own overlap (overlap is computed from B's perspective, the
    // owner). This keeps the semantics : "this batch's props overlap
    // with X" rather than "this batch was overlapped by X".
    assert.equal(bA.pending_count, 0);
    assert.deepEqual(bA.overlap_with, []);
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Dependency-injection pattern: the handler accepts an optional `deps` arg
// so tests can stub auth + the supabase client. Same pattern as
// test/api-v2-protocol.test.js (mock.module isn't available without
// --experimental-test-module-mocks, which the project runner doesn't pass).

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

// Chainable supabase stub. Each `from(table)` returns a builder that captures
// filters, then resolves via `.single()` / thenable / `.update(...).select().single()`.
// Tests pass a config keyed by table — rows to return for reads, or an update
// sink and return value for writes.
function makeSupabase(config) {
  const writes = [];
  const inserts = [];
  const sb = {
    _writes: writes,
    _inserts: inserts,
    from(table) {
      const tableConfig = config[table] || {};
      const builder = {
        _table: table,
        _filter: {},
        _pendingUpdate: null,
        _pendingInsert: null,
        _orderBy: null,
        _limit: null,
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        order(col, opts) { this._orderBy = { col, opts }; return this; },
        limit(n) { this._limit = n; return this; },
        update(patch) { this._pendingUpdate = patch; return this; },
        insert(row) { this._pendingInsert = row; return this; },
        _resolveRows() {
          const rows = tableConfig.rows || [];
          return rows.filter(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
        },
        async single() {
          if (this._pendingInsert) {
            inserts.push({ table, row: this._pendingInsert });
            const inserted = tableConfig.onInsert
              ? tableConfig.onInsert(this._pendingInsert)
              : { ...this._pendingInsert, id: tableConfig.generatedId || "gen-id" };
            const err = tableConfig.insertError || null;
            return { data: inserted, error: err };
          }
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter }, patch: this._pendingUpdate });
            const updated = tableConfig.onUpdate
              ? tableConfig.onUpdate(this._filter, this._pendingUpdate)
              : null;
            const err = tableConfig.updateError || null;
            return { data: updated, error: err };
          }
          const matches = this._resolveRows();
          const match = matches[0];
          if (!match && tableConfig.singleError) {
            return { data: null, error: tableConfig.singleError };
          }
          return { data: match || null, error: match ? null : { code: "PGRST116" } };
        },
        async maybeSingle() {
          // Same as single but returns { data: null, error: null } when no match.
          if (this._pendingUpdate || this._pendingInsert) {
            return this.single();
          }
          const matches = this._resolveRows();
          return { data: matches[0] || null, error: null };
        },
        then(resolve) {
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter }, patch: this._pendingUpdate });
            const updated = tableConfig.onUpdate
              ? tableConfig.onUpdate(this._filter, this._pendingUpdate)
              : null;
            resolve({ data: updated, error: tableConfig.updateError || null });
            return;
          }
          const matches = this._resolveRows();
          resolve({ data: matches, error: tableConfig.listError || null });
        },
      };
      return builder;
    },
  };
  return sb;
}

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "22222222-2222-2222-2222-222222222222";
const SECTION_ID = "33333333-3333-3333-3333-333333333333";
const PERSONA_ID = "pers-1";

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase: makeSupabase({
      protocol_document: {
        rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
      },
      proposition: {
        rows: [
          {
            id: PROP_ID, document_id: DOC_ID, status: "pending",
            source: "feedback_event", source_ref: "evt-1", source_refs: ["evt-1"],
            count: 1, intent: "add_rule", target_kind: "hard_rules",
            target_section_id: SECTION_ID,
            proposed_text: "Max 2 questions par message.",
            rationale: "user corrected", confidence: 0.92,
          },
        ],
        onUpdate: (filter, patch) => ({
          id: filter.id, document_id: DOC_ID, ...patch,
          source: "feedback_event", intent: "add_rule", target_kind: "hard_rules",
          confidence: 0.92,
        }),
      },
      protocol_section: {
        rows: [
          {
            id: SECTION_ID, document_id: DOC_ID, kind: "hard_rules",
            prose: "Existing rules paragraph.",
          },
        ],
        onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
      },
      extractor_training_example: {
        rows: [],
        generatedId: "training-1",
        onInsert: (row) => ({ ...row, id: "training-1" }),
      },
    }),
    ...overrides,
  };
}

async function loadHandler() {
  const { default: handler } = await import("../api/v2/propositions.js");
  return handler;
}

describe("GET /api/v2/propositions", () => {
  it("returns 400 when document is missing", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /document/i);
  });

  it("returns 400 when document is not a uuid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", query: { document: "not-a-uuid" } }, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when status is not in enum", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID, status: "bogus" } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 when document does not exist", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID } },
      res,
      baseDeps({ supabase: makeSupabase({ protocol_document: { rows: [] } }) }),
    );
    assert.equal(res.statusCode, 404);
  });

  it("returns 403 when client lacks persona access", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID, status: "pending" } },
      res,
      baseDeps({
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
        hasPersonaAccess: async () => false,
      }),
    );
    assert.equal(res.statusCode, 403);
  });

  it("returns propositions filtered by document + status", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "GET", query: { document: DOC_ID, status: "pending" } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.propositions.length, 1);
    assert.equal(res._body.propositions[0].id, PROP_ID);
  });

  it("returns all statuses when status query is omitted", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }] },
        proposition: {
          rows: [
            { id: "p1", document_id: DOC_ID, status: "pending" },
            { id: "p2", document_id: DOC_ID, status: "accepted" },
          ],
        },
      }),
    });
    await handler({ method: "GET", query: { document: DOC_ID } }, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.propositions.length, 2);
  });
});

describe("POST /api/v2/propositions", () => {
  it("returns 400 when action is invalid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "nope", id: PROP_ID } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /action/i);
  });

  it("returns 400 when id is missing or not a uuid", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: "no" } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when revise lacks proposed_text", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "revise", id: PROP_ID } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /proposed_text/i);
  });

  it("returns 404 when proposition does not exist", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const missingId = "99999999-9999-9999-9999-999999999999";
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: missingId } },
      res,
      baseDeps(),
    );
    assert.equal(res.statusCode, 404);
  });

  it("returns 403 when client lacks persona access", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      baseDeps({
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
        hasPersonaAccess: async () => false,
      }),
    );
    assert.equal(res.statusCode, 403);
  });

  it("accept sets status=accepted and resolved_at, returns updated row", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID, user_note: "ok" } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "accepted");
    assert.ok(res._body.proposition.resolved_at);
    assert.equal(res._body.proposition.user_note, "ok");

    const writes = deps.supabase._writes.filter(w => w.table === "proposition");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].patch.status, "accepted");
    assert.ok(writes[0].patch.resolved_at);
    assert.equal(writes[0].patch.user_note, "ok");
  });

  it("reject sets status=rejected and resolved_at", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "reject", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "rejected");
    assert.ok(res._body.proposition.resolved_at);

    const write = deps.supabase._writes.find(w => w.table === "proposition");
    assert.equal(write.patch.status, "rejected");
  });

  it("revise sets status=revised, updates proposed_text, sets resolved_at", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      {
        method: "POST",
        query: {},
        body: { action: "revise", id: PROP_ID, proposed_text: "  new text  ", user_note: "tweaked" },
      },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "revised");
    assert.equal(res._body.proposition.proposed_text, "new text");

    const write = deps.supabase._writes.find(w => w.table === "proposition");
    assert.equal(write.patch.status, "revised");
    assert.equal(write.patch.proposed_text, "new text");
    assert.ok(write.patch.resolved_at);
  });
});

describe("Task 4.3 — accept patches prose", () => {
  it("appends proposed_text to target section prose (target_section_id set)", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const sectionWrite = deps.supabase._writes.find((w) => w.table === "protocol_section");
    assert.ok(sectionWrite, "section should be patched");
    assert.equal(sectionWrite.filter.id, SECTION_ID);
    assert.match(sectionWrite.patch.prose, /Existing rules paragraph\./);
    assert.match(sectionWrite.patch.prose, /Max 2 questions par message\./);
    assert.equal(sectionWrite.patch.author_kind, "proposition_accepted");
    assert.equal(res._body.section.id, SECTION_ID);
  });

  it("falls back to kind match when target_section_id is null", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    // Use a stub where the proposition has no target_section_id, but a section
    // with matching kind exists.
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", source_ref: "evt-1", source_refs: ["evt-1"],
              count: 1, intent: "add_rule", target_kind: "hard_rules",
              target_section_id: null,
              proposed_text: "Quelque chose.",
              rationale: "...", confidence: 0.9,
            },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, document_id: DOC_ID, ...patch }),
        },
        protocol_section: {
          rows: [
            { id: SECTION_ID, document_id: DOC_ID, kind: "hard_rules", prose: "" },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
        },
        extractor_training_example: {
          rows: [], onInsert: (row) => ({ ...row, id: "training-1" }),
        },
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const sectionWrite = deps.supabase._writes.find((w) => w.table === "protocol_section");
    assert.ok(sectionWrite);
    assert.equal(sectionWrite.filter.id, SECTION_ID);
  });

  it("returns 422 when no matching section exists for target_kind", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", intent: "add_rule", target_kind: "hard_rules",
              target_section_id: null,
              proposed_text: "X.", confidence: 0.9,
            },
          ],
        },
        protocol_section: { rows: [] }, // no sections
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 422);
    assert.match(res._body.error, /no target section/i);
  });

  it("amend_paragraph intent prepends [amend_paragraph] tag in patched prose", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", intent: "amend_paragraph", target_kind: "errors",
              target_section_id: SECTION_ID,
              proposed_text: "Évite 'X' — préfère 'Y'.",
              confidence: 0.85,
            },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, document_id: DOC_ID, ...patch }),
        },
        protocol_section: {
          rows: [{ id: SECTION_ID, document_id: DOC_ID, kind: "errors", prose: "Existing." }],
          onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
        },
        extractor_training_example: { rows: [], onInsert: (r) => ({ ...r, id: "t-1" }) },
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const sectionWrite = deps.supabase._writes.find((w) => w.table === "protocol_section");
    assert.match(sectionWrite.patch.prose, /\[amend_paragraph\]/);
  });
});

describe("Chantier 2 — accept materializes protocol_artifact", () => {
  it("add_rule accept inserts protocol_artifact with kind=hard_check, severity=hard", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "protocol_artifact");
    assert.ok(insert, "should insert protocol_artifact");
    assert.equal(insert.row.kind, "hard_check");
    assert.equal(insert.row.severity, "hard");
    assert.equal(insert.row.source_section_id, SECTION_ID);
    assert.equal(insert.row.content.text, "Max 2 questions par message.");
    assert.equal(insert.row.content.intent, "add_rule");
    assert.equal(insert.row.content.source_proposition_id, PROP_ID);
    assert.equal(insert.row.content.source_kind, "hard_rules");
    assert.match(insert.row.content_hash, /^[0-9a-f]{64}$/);
    assert.equal(res._body.artifact_id, "gen-id");
  });

  it("add_paragraph accept inserts protocol_artifact with kind=pattern, severity=light", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", intent: "add_paragraph", target_kind: "process",
              target_section_id: SECTION_ID,
              proposed_text: "Étape 'qualification' — prérequis: lead a répondu.",
              rationale: "from corrections", confidence: 0.84,
            },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, document_id: DOC_ID, ...patch }),
        },
        protocol_section: {
          rows: [{ id: SECTION_ID, document_id: DOC_ID, kind: "process", prose: "" }],
          onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
        },
        extractor_training_example: { rows: [], onInsert: (r) => ({ ...r, id: "t-1" }) },
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "protocol_artifact");
    assert.ok(insert);
    assert.equal(insert.row.kind, "pattern");
    assert.equal(insert.row.severity, "light");
    assert.equal(insert.row.content.intent, "add_paragraph");
  });

  it("amend_paragraph accept does NOT insert artifact (only patches prose)", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", intent: "amend_paragraph", target_kind: "errors",
              target_section_id: SECTION_ID,
              proposed_text: "Évite 'visio' — préfère 'visioconférence'.",
              confidence: 0.78,
            },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, document_id: DOC_ID, ...patch }),
        },
        protocol_section: {
          rows: [{ id: SECTION_ID, document_id: DOC_ID, kind: "errors", prose: "Existing." }],
          onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
        },
        extractor_training_example: { rows: [], onInsert: (r) => ({ ...r, id: "t-1" }) },
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "protocol_artifact");
    assert.equal(insert, undefined, "amend_paragraph should not produce artifact");
    assert.equal(res._body.artifact_id, null);
  });

  it("returns 200 with artifact_id=null if artifact insert errors", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", intent: "add_rule", target_kind: "hard_rules",
              target_section_id: SECTION_ID,
              proposed_text: "Some rule.", confidence: 0.9,
            },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, document_id: DOC_ID, ...patch }),
        },
        protocol_section: {
          rows: [{ id: SECTION_ID, document_id: DOC_ID, kind: "hard_rules", prose: "" }],
          onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
        },
        extractor_training_example: { rows: [], onInsert: (r) => ({ ...r, id: "t-1" }) },
        protocol_artifact: { rows: [], insertError: { message: "boom" } },
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.proposition.status, "accepted");
    assert.equal(res._body.artifact_id, null);
  });

  it("content_hash is stable for semantically identical text (case + punctuation)", async () => {
    const { computeArtifactHash } = await import("../lib/protocol-v2-db.js");
    const a = computeArtifactHash("Max 2 questions par message.");
    const b = computeArtifactHash("MAX 2 questions, par message !");
    const c = computeArtifactHash("Max 1 question par message.");
    assert.equal(a, b, "case+punctuation should not change hash");
    assert.notEqual(a, c, "different content must produce different hash");
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("computeArtifactHash returns null on empty/whitespace input", async () => {
    const { computeArtifactHash } = await import("../lib/protocol-v2-db.js");
    assert.equal(computeArtifactHash(""), null);
    assert.equal(computeArtifactHash("   "), null);
    assert.equal(computeArtifactHash(null), null);
    assert.equal(computeArtifactHash(undefined), null);
  });

  it("reject does NOT create an artifact", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "reject", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "protocol_artifact");
    assert.equal(insert, undefined, "reject path must not materialize artifacts");
  });
});

describe("Task 4.3 — training examples", () => {
  it("accept logs extractor_training_example with outcome=accepted", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID, user_note: "ok" } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "extractor_training_example");
    assert.ok(insert, "should insert training example");
    assert.equal(insert.row.outcome, "accepted");
    assert.equal(insert.row.scope, "persona");
    assert.equal(insert.row.scope_id, PERSONA_ID);
    assert.equal(insert.row.extractor_kind, "hard_rules");
    assert.equal(insert.row.user_note, "ok");
    assert.equal(insert.row.input_signal.proposition_id, PROP_ID);
    assert.equal(res._body.training_example_id, "training-1");
  });

  it("reject logs extractor_training_example with outcome=rejected", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      { method: "POST", query: {}, body: { action: "reject", id: PROP_ID, user_note: "bof" } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "extractor_training_example");
    assert.ok(insert);
    assert.equal(insert.row.outcome, "rejected");
    assert.equal(insert.row.user_note, "bof");
  });

  it("revise logs extractor_training_example with outcome=revised + revised_text", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps();
    await handler(
      {
        method: "POST", query: {},
        body: { action: "revise", id: PROP_ID, proposed_text: "  Max 1 question par message. " },
      },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200);
    const insert = deps.supabase._inserts.find((i) => i.table === "extractor_training_example");
    assert.ok(insert);
    assert.equal(insert.row.outcome, "revised");
    assert.equal(insert.row.revised_text, "Max 1 question par message.");
  });

  it("returns the proposition even if training_example insert fails", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    const deps = baseDeps({
      supabase: makeSupabase({
        protocol_document: {
          rows: [{ id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID }],
        },
        proposition: {
          rows: [
            {
              id: PROP_ID, document_id: DOC_ID, status: "pending",
              source: "feedback_event", intent: "add_rule", target_kind: "hard_rules",
              target_section_id: SECTION_ID,
              proposed_text: "Max 2 q.", confidence: 0.9,
            },
          ],
          onUpdate: (filter, patch) => ({ id: filter.id, document_id: DOC_ID, ...patch }),
        },
        protocol_section: {
          rows: [{ id: SECTION_ID, document_id: DOC_ID, kind: "hard_rules", prose: "" }],
          onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
        },
        extractor_training_example: {
          rows: [],
          insertError: { message: "training table down" },
        },
      }),
    });
    await handler(
      { method: "POST", query: {}, body: { action: "accept", id: PROP_ID } },
      res,
      deps,
    );
    assert.equal(res.statusCode, 200, "accept still succeeds");
    assert.equal(res._body.proposition.status, "accepted");
    assert.equal(res._body.training_example_id, null);
  });
});

describe("patchProse — pure function", () => {
  let patchProse;
  it("loads the export", async () => {
    const mod = await import("../api/v2/propositions.js");
    patchProse = mod.patchProse;
    assert.equal(typeof patchProse, "function");
  });

  it("appends to non-empty prose with double newline", () => {
    const out = patchProse("Existing.", { proposed_text: "New rule.", intent: "add_rule" });
    assert.equal(out, "Existing.\n\nNew rule.");
  });

  it("appends raw to empty prose without leading separator", () => {
    const out = patchProse("", { proposed_text: "New rule.", intent: "add_rule" });
    assert.equal(out, "New rule.");
  });

  it("prepends [amend_paragraph] tag for amend intent", () => {
    const out = patchProse("Existing.", {
      proposed_text: "Évite 'X' — préfère 'Y'.",
      intent: "amend_paragraph",
    });
    assert.match(out, /\[amend_paragraph\] Évite/);
  });

  it("prepends [refine_pattern] for refine intent", () => {
    const out = patchProse("Existing.", {
      proposed_text: "Pattern X.",
      intent: "refine_pattern",
    });
    assert.match(out, /\[refine_pattern\] Pattern/);
  });

  it("returns prose unchanged when proposed_text is empty/missing", () => {
    assert.equal(patchProse("Hello.", { proposed_text: "" }), "Hello.");
    assert.equal(patchProse("Hello.", {}), "Hello.");
    assert.equal(patchProse("Hello.", { proposed_text: "   " }), "Hello.");
  });
});

describe("OPTIONS + method handling", () => {
  it("handles OPTIONS preflight with 200", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "OPTIONS", query: {} }, res, baseDeps());
    assert.equal(res.statusCode, 200);
  });

  it("rejects PUT with 405", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "PUT", query: {}, body: {} }, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });
});

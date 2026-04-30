import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Tests for api/v2/protocol/source-playbooks.js — V2 upload UX backend.
// Same DI pattern as api-v2-protocol.test.js : handler accepts a `deps` arg.

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

// ── Supabase stub that records inserts + delegates query results ──
// Tracks .from(table).insert/delete/select calls and lets each test pre-load
// canned responses keyed by table.
function makeSupabase({
  // existing rows (per-table) — used to model unique-existence checks
  existingByTable = {},
  // canned select results (per-table) — used to satisfy GET list queries
  selectByTable = {},
} = {}) {
  const inserts = { protocol_document: [], protocol_section: [], proposition: [], protocol_artifact: [] };
  const deletes = { protocol_document: [] };

  return {
    inserts,
    deletes,
    from(table) {
      let _rows = selectByTable[table] || [];
      let _filter = {};
      let _isFilter = {};
      let _notFilter = {};
      let _inFilter = null;
      const builder = {
        select() { return this; },
        eq(col, val) { _filter[col] = val; return this; },
        is(col, val) { _isFilter[col] = val; return this; },
        not(col, op, val) {
          // .not("source_core", "is", null) → keep rows where col is not null
          if (op === "is" && val === null) _notFilter[col] = "notnull";
          return this;
        },
        in(col, values) { _inFilter = { col, values }; return this; },
        order() { return this; },
        match() { return this; },
        _matches() {
          let m = _rows;
          for (const [k, v] of Object.entries(_filter)) m = m.filter(r => r[k] === v);
          for (const [k, v] of Object.entries(_isFilter)) {
            if (v === null) m = m.filter(r => r[k] === null || r[k] === undefined);
            else m = m.filter(r => r[k] === v);
          }
          for (const [k, mode] of Object.entries(_notFilter)) {
            if (mode === "notnull") m = m.filter(r => r[k] !== null && r[k] !== undefined);
          }
          if (_inFilter) m = m.filter(r => _inFilter.values.includes(r[_inFilter.col]));
          return m;
        },
        single() { return Promise.resolve({ data: this._matches()[0] || null, error: null }); },
        maybeSingle() {
          // Existence checks (unique active doc per (persona, source_core)) :
          // walk existingByTable for this combo of filters.
          if (table === "protocol_document" && _filter.source_core && existingByTable[table]) {
            const hit = existingByTable[table].find(r =>
              r.owner_kind === _filter.owner_kind &&
              r.owner_id === _filter.owner_id &&
              r.status === _filter.status &&
              r.source_core === _filter.source_core
            );
            return Promise.resolve({ data: hit || null, error: null });
          }
          return Promise.resolve({ data: this._matches()[0] || null, error: null });
        },
        then(resolve) { resolve({ data: this._matches(), error: null }); },
        insert(rows) {
          const arr = Array.isArray(rows) ? rows : [rows];
          (inserts[table] = inserts[table] || []).push(...arr);
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          return {
            eq: (col, val) => {
              (deletes[table] = deletes[table] || []).push({ col, val });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return builder;
    },
  };
}

function baseDeps(overrides = {}) {
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    supabase: makeSupabase(),
    setCors: () => {},
    routeAndExtract: async () => [],
    extractionTimeoutMs: 5000,
    killSwitch: undefined,
    ...overrides,
  };
}

const VALID_PERSONA = "11111111-2222-3333-4444-555555555555";

describe("POST /api/v2/protocol/source-playbooks — validation", () => {
  it("rejects missing persona_id", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "POST", body: { source_core: "visite_profil", prose: "x" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /persona_id/);
  });

  it("rejects invalid source_core", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "POST", body: { persona_id: VALID_PERSONA, source_core: "bogus", prose: "x" } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /source_core must be one of/);
  });

  it("rejects empty prose", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "POST", body: { persona_id: VALID_PERSONA, source_core: "visite_profil", prose: "   " } };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /prose/);
  });

  it("rejects access denied for non-admin without persona access", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "POST", body: { persona_id: VALID_PERSONA, source_core: "visite_profil", prose: "abc" } };
    const res = makeRes();
    await handler(req, res, baseDeps({
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    }));
    assert.equal(res.statusCode, 403);
  });
});

describe("POST /api/v2/protocol/source-playbooks — happy path", () => {
  it("returns 409 if persona already has an active playbook for this source_core", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, source_core: "visite_profil", prose: "abc" },
    };
    const res = makeRes();
    const supabase = makeSupabase({
      existingByTable: {
        protocol_document: [{
          id: "existing-doc",
          owner_kind: "persona",
          owner_id: VALID_PERSONA,
          status: "active",
          source_core: "visite_profil",
        }],
      },
    });
    await handler(req, res, baseDeps({ supabase }));
    assert.equal(res.statusCode, 409);
    assert.equal(res._body.document_id, "existing-doc");
  });

  it("creates doc + section + materializes high-confidence artifacts on extraction", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = {
      method: "POST",
      body: {
        persona_id: VALID_PERSONA,
        source_core: "visite_profil",
        prose: "Stratégie curiosité-symétrique. Cadence J+2/J+4 max 3 touches.",
      },
    };
    const res = makeRes();
    const supabase = makeSupabase();
    const candidates = [
      {
        target_kind: "hard_rules",
        proposal: {
          intent: "add_rule",
          proposed_text: "MAX 3 touches sur 5-7 jours",
          rationale: "explicitly stated cadence rule",
          confidence: 0.92,
        },
      },
      {
        target_kind: "icp_patterns",
        proposal: {
          intent: "add_paragraph",
          proposed_text: "Stratégie curiosité-symétrique",
          rationale: "approach to first message",
          confidence: 0.85,
        },
      },
      {
        target_kind: "errors",
        proposal: {
          intent: "add_rule",
          proposed_text: "low conf candidate",
          confidence: 0.5, // below threshold — should be dropped
        },
      },
    ];
    await handler(req, res, baseDeps({
      supabase,
      routeAndExtract: async () => candidates,
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res._body.candidates_total, 3);
    assert.equal(res._body.artifacts_created, 2, "2 high-conf candidates materialized");
    assert.equal(res._body.low_confidence_dropped, 1, "1 low-conf dropped");
    assert.equal(supabase.inserts.protocol_document.length, 1);
    assert.equal(supabase.inserts.protocol_document[0].source_core, "visite_profil");
    assert.equal(supabase.inserts.protocol_document[0].status, "active");
    assert.equal(supabase.inserts.protocol_section.length, 1);
    assert.equal(supabase.inserts.protocol_section[0].kind, "custom");
    assert.ok(supabase.inserts.protocol_section[0].prose.includes("curiosité"));
    assert.equal(supabase.inserts.proposition.length, 2);
    assert.equal(supabase.inserts.protocol_artifact.length, 2);
    assert.equal(supabase.inserts.protocol_artifact[0].severity, "hard"); // hard_rules → hard_check
    assert.equal(supabase.inserts.protocol_artifact[1].severity, "strong"); // icp_patterns → pattern strong
  });

  it("succeeds with extraction killed off — returns extraction_skipped flag", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, source_core: "spyer", prose: "Suivi audience Alec Henry" },
    };
    const res = makeRes();
    const supabase = makeSupabase();
    await handler(req, res, baseDeps({
      supabase,
      killSwitch: "off",
      routeAndExtract: async () => { throw new Error("should not be called"); },
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res._body.extraction_skipped, true);
    assert.equal(res._body.artifacts_created, 0);
    assert.equal(supabase.inserts.protocol_document.length, 1);
    assert.equal(supabase.inserts.protocol_section.length, 1);
    assert.equal(supabase.inserts.protocol_artifact.length, 0);
  });

  it("survives extraction errors gracefully (doc + section persist, no artifacts)", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = {
      method: "POST",
      body: { persona_id: VALID_PERSONA, source_core: "dr_recue", prose: "..." },
    };
    const res = makeRes();
    const supabase = makeSupabase();
    await handler(req, res, baseDeps({
      supabase,
      routeAndExtract: async () => { throw new Error("Anthropic 503"); },
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res._body.artifacts_created, 0);
    assert.equal(res._body.extraction_error, "Anthropic 503");
    assert.equal(supabase.inserts.protocol_document.length, 1);
    assert.equal(supabase.inserts.protocol_section.length, 1);
  });
});

describe("GET /api/v2/protocol/source-playbooks — list", () => {
  it("rejects missing persona param", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "GET", query: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns empty list when persona has no source playbooks", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "GET", query: { persona: VALID_PERSONA } };
    const res = makeRes();
    const supabase = makeSupabase({
      selectByTable: { protocol_document: [] },
    });
    await handler(req, res, baseDeps({ supabase }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res._body.playbooks, []);
  });
});

describe("Method dispatch", () => {
  it("returns 405 for unsupported methods", async () => {
    const { default: handler } = await import("../api/v2/protocol/source-playbooks.js");
    const req = { method: "DELETE" };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 405);
  });
});

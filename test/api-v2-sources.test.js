import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import handler from "../api/v2/sources.js";

// GET /api/v2/sources?persona=<uuid>
//   → { persona_id, docs: [...], playbooks: [...] }
//
// docs : protocol_import_batch rows pour le document actif du persona
//        (filename, doc_kind, chunks/propositions/identity counts, imported_at)
// playbooks : protocol_document rows owner_id=<persona> AND source_core IS NOT NULL
//             (1 persona peut avoir N playbooks source-specific)

function makeRes() {
  return {
    statusCode: 200, _body: null,
    setHeader() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { return this; },
  };
}

function makeSupabase(config) {
  const sb = {
    from(table) {
      const tc = config[table] || {};
      const builder = {
        _filterEq: {}, _filterIs: {}, _filterNot: {},
        _orderCol: null, _orderDesc: false,
        select() { return this; },
        eq(col, val) { this._filterEq[col] = val; return this; },
        is(col, val) { this._filterIs[col] = val; return this; },
        not(col, op, val) { this._filterNot[col] = { op, val }; return this; },
        order(col, opts) {
          this._orderCol = col;
          this._orderDesc = opts?.ascending === false;
          return this;
        },
        _resolveRows() {
          let rows = (tc.rows || []).filter(r => {
            for (const [k, v] of Object.entries(this._filterEq)) {
              if (r[k] !== v) return false;
            }
            for (const [k, v] of Object.entries(this._filterIs)) {
              if (v === null && r[k] !== null && r[k] !== undefined) return false;
              if (v !== null && r[k] !== v) return false;
            }
            for (const [k, n] of Object.entries(this._filterNot)) {
              if (n.op === "is" && n.val === null && (r[k] === null || r[k] === undefined)) return false;
            }
            return true;
          });
          if (this._orderCol) {
            rows = rows.slice().sort((a, b) => {
              const av = a[this._orderCol], bv = b[this._orderCol];
              if (av === bv) return 0;
              const cmp = av > bv ? 1 : -1;
              return this._orderDesc ? -cmp : cmp;
            });
          }
          return rows;
        },
        async maybeSingle() {
          const m = this._resolveRows();
          return { data: m[0] || null, error: null };
        },
        then(resolve) {
          resolve({ data: this._resolveRows(), error: null });
        },
      };
      return builder;
    },
  };
  return sb;
}

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "22222222-2222-2222-2222-222222222222";
const PB_ID_1 = "33333333-3333-3333-3333-333333333333";
const PB_ID_2 = "44444444-4444-4444-4444-444444444444";

function baseDeps(overrides = {}) {
  const supabase = overrides.supabase ?? makeSupabase({
    protocol_document: {
      rows: [
        { id: DOC_ID, owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: null, version: 3 },
        { id: PB_ID_1, owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: "visite_profil", version: 1 },
        { id: PB_ID_2, owner_kind: "persona", owner_id: PERSONA_ID, status: "active", source_core: "dr_recue", version: 1 },
      ],
    },
    protocol_import_batch: {
      rows: [
        {
          id: "b1",
          document_id: DOC_ID,
          doc_filename: "Reflexion process setting + IA.docx.pdf",
          doc_kind: "operational_playbook",
          chunks_processed: 4,
          candidates_total: 50,
          propositions_created: 177,
          propositions_merged: 12,
          identity_appended: false,
          identity_chars_added: 0,
          created_at: "2026-05-03T10:00:00Z",
        },
        {
          id: "b2",
          document_id: DOC_ID,
          doc_filename: "AudienceCible.pdf",
          doc_kind: "icp_audience",
          chunks_processed: 2,
          candidates_total: 30,
          propositions_created: 51,
          propositions_merged: 0,
          identity_appended: true,
          identity_chars_added: 1200,
          created_at: "2026-05-02T14:00:00Z",
        },
      ],
    },
  });
  return {
    authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
    supabase,
    ...overrides,
  };
}

describe("GET /api/v2/sources", () => {
  it("returns 200 with docs + playbooks for a valid persona", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.persona_id, PERSONA_ID);
    assert.ok(Array.isArray(res._body.docs));
    assert.ok(Array.isArray(res._body.playbooks));
    assert.equal(res._body.docs.length, 2);
    assert.equal(res._body.playbooks.length, 2);
  });

  it("docs sorted by imported_at desc (most recent first)", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const docs = res._body.docs;
    assert.equal(docs[0].filename, "Reflexion process setting + IA.docx.pdf");
    assert.equal(docs[1].filename, "AudienceCible.pdf");
  });

  it("doc shape includes filename, doc_kind, counts, identity, imported_at", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const doc = res._body.docs[0];
    assert.equal(doc.filename, "Reflexion process setting + IA.docx.pdf");
    assert.equal(doc.doc_kind, "operational_playbook");
    assert.equal(doc.chunks_processed, 4);
    assert.equal(doc.propositions_created, 177);
    assert.equal(doc.identity_chars_added, 0);
    assert.equal(doc.imported_at, "2026-05-03T10:00:00Z");
  });

  it("playbook shape includes name (source_core), status (active), version", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    const pbs = res._body.playbooks;
    const pbNames = pbs.map(p => p.name).sort();
    assert.deepEqual(pbNames, ["dr_recue", "visite_profil"]);
    for (const pb of pbs) {
      assert.equal(pb.status, "active");
      assert.ok("version" in pb);
    }
  });

  it("returns 400 if persona not a UUID", async () => {
    const req = { method: "GET", query: { persona: "not-uuid" }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps());
    assert.equal(res.statusCode, 400);
  });

  it("returns 200 with empty docs/playbooks when persona has nothing", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, baseDeps({
      supabase: makeSupabase({
        protocol_document: { rows: [] },
        protocol_import_batch: { rows: [] },
      }),
    }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res._body.docs, []);
    assert.deepEqual(res._body.playbooks, []);
  });

  it("returns 403 if non-admin without persona access", async () => {
    const req = { method: "GET", query: { persona: PERSONA_ID }, headers: {} };
    const res = makeRes();
    await handler(req, res, {
      ...baseDeps(),
      authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
      hasPersonaAccess: async () => false,
    });
    assert.equal(res.statusCode, 403);
  });
});

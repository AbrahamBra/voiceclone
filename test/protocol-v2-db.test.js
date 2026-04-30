import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  getActiveDocument,
  getActivePlaybookForSource,
  listSections,
  listArtifacts,
  getActiveArtifactsForPersona,
} from "../lib/protocol-v2-db.js";

// Stub supabase: returns configurable data.
// Supports: select, eq, in, is, order, limit, single, maybeSingle, then.
// .is(col, null) matches rows where the column is null OR the column is missing.
function makeStub(rows) {
  return {
    from(table) {
      return {
        _rows: rows[table] || [],
        _filter: {},          // { col: val } via eq
        _isFilter: {},        // { col: val } via is (null-aware)
        _inFilter: null,      // { col, values } via in
        _limit: null,
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        is(col, val) { this._isFilter[col] = val; return this; },
        in(col, values) { this._inFilter = { col, values }; return this; },
        order() { return this; },
        limit(n) { this._limit = n; return this; },
        _matches() {
          let m = this._rows.filter(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
          for (const [k, v] of Object.entries(this._isFilter)) {
            if (v === null) {
              m = m.filter(r => r[k] === null || r[k] === undefined);
            } else {
              m = m.filter(r => r[k] === v);
            }
          }
          if (this._inFilter) {
            m = m.filter(r => this._inFilter.values.includes(r[this._inFilter.col]));
          }
          if (this._limit != null) m = m.slice(0, this._limit);
          return m;
        },
        single() {
          return Promise.resolve({ data: this._matches()[0] || null, error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: this._matches()[0] || null, error: null });
        },
        then(resolve) {
          resolve({ data: this._matches(), error: null });
        },
      };
    },
  };
}

describe("protocol-v2-db", () => {
  it("getActiveDocument returns the active doc for a persona", async () => {
    const sb = makeStub({
      protocol_document: [
        { id: "d1", owner_kind: "persona", owner_id: "p1", status: "archived", version: 1 },
        { id: "d2", owner_kind: "persona", owner_id: "p1", status: "active", version: 2 },
      ],
    });
    const doc = await getActiveDocument(sb, "p1");
    assert.equal(doc?.id, "d2");
    assert.equal(doc?.version, 2);
  });

  it("getActiveDocument returns null when persona has no document", async () => {
    const sb = makeStub({ protocol_document: [] });
    const doc = await getActiveDocument(sb, "pX");
    assert.equal(doc, null);
  });

  it("listSections returns sections filtered by document_id", async () => {
    const sb = makeStub({
      protocol_section: [
        { id: "s1", document_id: "d1", order: 1, kind: "identity", prose: "..." },
        { id: "s2", document_id: "d1", order: 0, kind: "hard_rules", prose: "..." },
      ],
    });
    const sections = await listSections(sb, "d1");
    assert.equal(sections.length, 2);
    assert.ok(sections.every(s => s.document_id === "d1"));
  });

  it("listArtifacts returns only active by default", async () => {
    const sb = makeStub({
      protocol_artifact: [
        { id: "a1", source_section_id: "s1", is_active: true, kind: "hard_check" },
        { id: "a2", source_section_id: "s1", is_active: false, kind: "hard_check" },
      ],
    });
    const arts = await listArtifacts(sb, "s1", { activeOnly: true });
    assert.equal(arts.length, 1);
    assert.equal(arts[0].id, "a1");
  });

  describe("getActiveArtifactsForPersona (Chantier 2bis)", () => {
    it("returns active artifacts of all sections of the persona's active doc", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "d1", owner_kind: "persona", owner_id: "p1", status: "active", version: 1 },
        ],
        protocol_section: [
          { id: "s1", document_id: "d1" },
          { id: "s2", document_id: "d1" },
          { id: "sX", document_id: "dOther" },
        ],
        protocol_artifact: [
          { id: "a1", source_section_id: "s1", is_active: true, kind: "hard_check", content: { text: "rule 1" }, severity: "hard" },
          { id: "a2", source_section_id: "s2", is_active: true, kind: "pattern", content: { text: "pattern 1" }, severity: "light" },
          { id: "a3", source_section_id: "s1", is_active: false, kind: "hard_check", content: { text: "retired" }, severity: "hard" },
          { id: "aX", source_section_id: "sX", is_active: true, kind: "hard_check", content: { text: "other doc" }, severity: "hard" },
        ],
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1");
      const ids = arts.map(a => a.id).sort();
      assert.deepEqual(ids, ["a1", "a2"]);
    });

    it("returns [] when persona has no active doc", async () => {
      const sb = makeStub({ protocol_document: [], protocol_section: [], protocol_artifact: [] });
      const arts = await getActiveArtifactsForPersona(sb, "p1");
      assert.deepEqual(arts, []);
    });

    it("returns [] when active doc has no sections", async () => {
      const sb = makeStub({
        protocol_document: [{ id: "d1", owner_kind: "persona", owner_id: "p1", status: "active", version: 1 }],
        protocol_section: [],
        protocol_artifact: [],
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1");
      assert.deepEqual(arts, []);
    });

    it("respects limit option", async () => {
      const sections = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, document_id: "d1" }));
      const artifacts = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`, source_section_id: `s${i % 3}`, is_active: true,
        kind: "hard_check", content: { text: `rule ${i}` }, severity: "hard",
      }));
      const sb = makeStub({
        protocol_document: [{ id: "d1", owner_kind: "persona", owner_id: "p1", status: "active", version: 1 }],
        protocol_section: sections,
        protocol_artifact: artifacts,
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1", { limit: 4 });
      assert.equal(arts.length, 4);
    });
  });

  describe("source_core dimension (migration 055)", () => {
    it("getActiveDocument returns only the GLOBAL doc (source_core IS NULL), ignoring source-specific playbooks", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dGlobal", owner_kind: "persona", owner_id: "p1", status: "active", source_core: null, version: 3 },
          { id: "dPlaybook", owner_kind: "persona", owner_id: "p1", status: "active", source_core: "visite_profil", version: 1 },
        ],
      });
      const doc = await getActiveDocument(sb, "p1");
      assert.equal(doc?.id, "dGlobal");
      assert.equal(doc?.source_core, null);
    });

    it("getActivePlaybookForSource returns the matching source-specific doc", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dGlobal", owner_kind: "persona", owner_id: "p1", status: "active", source_core: null, version: 3 },
          { id: "dPlaybook", owner_kind: "persona", owner_id: "p1", status: "active", source_core: "visite_profil", version: 1 },
          { id: "dOtherSource", owner_kind: "persona", owner_id: "p1", status: "active", source_core: "spyer", version: 1 },
        ],
      });
      const doc = await getActivePlaybookForSource(sb, "p1", "visite_profil");
      assert.equal(doc?.id, "dPlaybook");
      assert.equal(doc?.source_core, "visite_profil");
    });

    it("getActivePlaybookForSource returns null when no matching playbook exists", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dGlobal", owner_kind: "persona", owner_id: "p1", status: "active", source_core: null, version: 1 },
        ],
      });
      const doc = await getActivePlaybookForSource(sb, "p1", "visite_profil");
      assert.equal(doc, null);
    });

    it("getActivePlaybookForSource returns null when sourceCore is falsy", async () => {
      const sb = makeStub({ protocol_document: [] });
      assert.equal(await getActivePlaybookForSource(sb, "p1", null), null);
      assert.equal(await getActivePlaybookForSource(sb, "p1", ""), null);
      assert.equal(await getActivePlaybookForSource(sb, "p1", undefined), null);
    });

    it("getActiveArtifactsForPersona MERGES global + source-specific artifacts when sourceCore is set", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dGlobal", owner_kind: "persona", owner_id: "p1", status: "active", source_core: null, version: 1 },
          { id: "dPlaybook", owner_kind: "persona", owner_id: "p1", status: "active", source_core: "visite_profil", version: 1 },
        ],
        protocol_section: [
          { id: "sG", document_id: "dGlobal" },
          { id: "sP", document_id: "dPlaybook" },
        ],
        protocol_artifact: [
          { id: "aGlobal", source_section_id: "sG", is_active: true, kind: "hard_check", content: { text: "voice rule" }, severity: "hard" },
          { id: "aPlaybook", source_section_id: "sP", is_active: true, kind: "pattern", content: { text: "curiosité symétrique" }, severity: "strong" },
        ],
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1", { sourceCore: "visite_profil" });
      const ids = arts.map(a => a.id).sort();
      assert.deepEqual(ids, ["aGlobal", "aPlaybook"]);
    });

    it("getActiveArtifactsForPersona without sourceCore returns ONLY global artifacts (backward compat)", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dGlobal", owner_kind: "persona", owner_id: "p1", status: "active", source_core: null, version: 1 },
          { id: "dPlaybook", owner_kind: "persona", owner_id: "p1", status: "active", source_core: "visite_profil", version: 1 },
        ],
        protocol_section: [
          { id: "sG", document_id: "dGlobal" },
          { id: "sP", document_id: "dPlaybook" },
        ],
        protocol_artifact: [
          { id: "aGlobal", source_section_id: "sG", is_active: true, kind: "hard_check", content: { text: "voice rule" }, severity: "hard" },
          { id: "aPlaybook", source_section_id: "sP", is_active: true, kind: "pattern", content: { text: "curiosité symétrique" }, severity: "strong" },
        ],
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1");
      const ids = arts.map(a => a.id);
      assert.deepEqual(ids, ["aGlobal"]);
    });

    it("getActiveArtifactsForPersona with sourceCore but no matching playbook returns global only (graceful fallback)", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dGlobal", owner_kind: "persona", owner_id: "p1", status: "active", source_core: null, version: 1 },
        ],
        protocol_section: [
          { id: "sG", document_id: "dGlobal" },
        ],
        protocol_artifact: [
          { id: "aGlobal", source_section_id: "sG", is_active: true, kind: "hard_check", content: { text: "voice rule" }, severity: "hard" },
        ],
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1", { sourceCore: "visite_profil" });
      const ids = arts.map(a => a.id);
      assert.deepEqual(ids, ["aGlobal"]);
    });

    it("getActiveArtifactsForPersona with sourceCore but no global doc returns playbook only", async () => {
      const sb = makeStub({
        protocol_document: [
          { id: "dPlaybook", owner_kind: "persona", owner_id: "p1", status: "active", source_core: "visite_profil", version: 1 },
        ],
        protocol_section: [
          { id: "sP", document_id: "dPlaybook" },
        ],
        protocol_artifact: [
          { id: "aPlaybook", source_section_id: "sP", is_active: true, kind: "pattern", content: { text: "curiosité symétrique" }, severity: "strong" },
        ],
      });
      const arts = await getActiveArtifactsForPersona(sb, "p1", { sourceCore: "visite_profil" });
      const ids = arts.map(a => a.id);
      assert.deepEqual(ids, ["aPlaybook"]);
    });
  });
});

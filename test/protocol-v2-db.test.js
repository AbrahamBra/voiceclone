import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  getActiveDocument,
  listSections,
  listArtifacts,
} from "../lib/protocol-v2-db.js";

// Stub supabase: returns configurable data.
function makeStub(rows) {
  return {
    from(table) {
      return {
        _rows: rows[table] || [],
        _filter: {},
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        order() { return this; },
        single() {
          const match = this._rows.find(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: match || null, error: null });
        },
        then(resolve) {
          const matches = this._rows.filter(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
          resolve({ data: matches, error: null });
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
});

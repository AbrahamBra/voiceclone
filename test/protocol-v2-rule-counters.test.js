import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  recordFiring,
  resolveFirings,
} from "../lib/protocol-v2-rule-counters.js";

// Minimal chainable supabase stub. Each test seeds rows + collects writes,
// then asserts on what landed where.
function makeStub({ pendingFirings = [], artifacts = [], onInsertError = null } = {}) {
  const writes = [];
  const inserts = [];
  return {
    _writes: writes,
    _inserts: inserts,
    from(table) {
      const builder = {
        _table: table,
        _filter: {},
        _inFilter: null,
        _pendingUpdate: null,
        _pendingInsert: null,
        select() { return this; },
        insert(rows) { this._pendingInsert = rows; return this; },
        update(patch) { this._pendingUpdate = patch; return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        in(col, values) { this._inFilter = { col, values }; return this; },
        async maybeSingle() { return this._resolveSingle(); },
        async single() { return this._resolveSingle(); },
        _matches() {
          let rows = [];
          if (table === "protocol_rule_firing") rows = pendingFirings;
          if (table === "protocol_artifact") rows = artifacts;
          let out = rows.filter(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
          if (this._inFilter) {
            out = out.filter(r => this._inFilter.values.includes(r[this._inFilter.col]));
          }
          return out;
        },
        _resolveSingle() {
          if (this._pendingInsert) {
            inserts.push({ table, rows: this._pendingInsert });
            const inserted = Array.isArray(this._pendingInsert)
              ? this._pendingInsert.map((r, i) => ({ ...r, id: `gen-${i}` }))
              : { ...this._pendingInsert, id: "gen-0" };
            return Promise.resolve({ data: inserted, error: onInsertError });
          }
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter, ...(this._inFilter ? { in: this._inFilter } : {}) }, patch: this._pendingUpdate });
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: this._matches()[0] || null, error: null });
        },
        then(resolve) {
          if (this._pendingInsert) {
            inserts.push({ table, rows: this._pendingInsert });
            const inserted = Array.isArray(this._pendingInsert)
              ? this._pendingInsert.map((r, i) => ({ ...r, id: `gen-${i}` }))
              : { ...this._pendingInsert, id: "gen-0" };
            resolve({ data: inserted, error: onInsertError });
            return;
          }
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter, ...(this._inFilter ? { in: this._inFilter } : {}) }, patch: this._pendingUpdate });
            resolve({ data: null, error: null });
            return;
          }
          resolve({ data: this._matches(), error: null });
        },
      };
      return builder;
    },
  };
}

describe("recordFiring", () => {
  it("inserts one row per artifactId with outcome='pending'", async () => {
    const sb = makeStub();
    const result = await recordFiring({
      supabase: sb,
      artifactIds: ["a1", "a2", "a3"],
      messageId: "m1",
      conversationId: "c1",
      personaId: "p1",
    });
    assert.equal(result.inserted, 3);
    assert.equal(sb._inserts.length, 1);
    assert.equal(sb._inserts[0].table, "protocol_rule_firing");
    assert.equal(sb._inserts[0].rows.length, 3);
    for (const row of sb._inserts[0].rows) {
      assert.equal(row.outcome, "pending");
      assert.equal(row.message_id, "m1");
      assert.equal(row.conversation_id, "c1");
      assert.equal(row.persona_id, "p1");
    }
  });

  it("returns {inserted: 0} when artifactIds is empty", async () => {
    const sb = makeStub();
    const result = await recordFiring({ supabase: sb, artifactIds: [], messageId: "m1" });
    assert.equal(result.inserted, 0);
    assert.equal(sb._inserts.length, 0);
  });

  it("throws when supabase missing", async () => {
    await assert.rejects(
      () => recordFiring({ artifactIds: ["a1"], messageId: "m1" }),
      /supabase/i,
    );
  });
});

describe("resolveFirings (Chantier 3.1 closes the loop)", () => {
  it("bulk-updates pending firings to outcome='helpful' and bumps counters", async () => {
    const sb = makeStub({
      pendingFirings: [
        { id: "f1", artifact_id: "a1", message_id: "m1", outcome: "pending" },
        { id: "f2", artifact_id: "a1", message_id: "m1", outcome: "pending" },
        { id: "f3", artifact_id: "a2", message_id: "m1", outcome: "pending" },
      ],
      artifacts: [
        { id: "a1", stats: { fires_total: 5, helpful_count: 2, harmful_count: 1 } },
        { id: "a2", stats: { fires_total: 3, helpful_count: 0, harmful_count: 0 } },
      ],
    });
    const result = await resolveFirings({ supabase: sb, messageId: "m1", outcome: "helpful" });
    assert.equal(result.resolved, 3);
    assert.equal(result.artifactsUpdated, 2);

    const firingUpdate = sb._writes.find(w => w.table === "protocol_rule_firing");
    assert.equal(firingUpdate.patch.outcome, "helpful");
    assert.ok(firingUpdate.patch.resolved_at);

    // Counter writes — a1 had 2 firings, a2 had 1.
    const artifactWrites = sb._writes.filter(w => w.table === "protocol_artifact");
    assert.equal(artifactWrites.length, 2);
    const a1Write = artifactWrites.find(w => w.filter.id === "a1");
    assert.equal(a1Write.patch.stats.helpful_count, 4); // 2 + 2
    assert.equal(a1Write.patch.stats.fires_total, 7);   // 5 + 2
    const a2Write = artifactWrites.find(w => w.filter.id === "a2");
    assert.equal(a2Write.patch.stats.helpful_count, 1); // 0 + 1
  });

  it("updates harmful_count when outcome='harmful'", async () => {
    const sb = makeStub({
      pendingFirings: [{ id: "f1", artifact_id: "a1", message_id: "m1", outcome: "pending" }],
      artifacts: [{ id: "a1", stats: { fires_total: 0, helpful_count: 0, harmful_count: 0 } }],
    });
    await resolveFirings({ supabase: sb, messageId: "m1", outcome: "harmful" });
    const a1Write = sb._writes.find(w => w.table === "protocol_artifact" && w.filter.id === "a1");
    assert.equal(a1Write.patch.stats.harmful_count, 1);
    assert.equal(a1Write.patch.stats.helpful_count, 0);
  });

  it("only bumps fires_total (not helpful/harmful) when outcome='unrelated'", async () => {
    const sb = makeStub({
      pendingFirings: [{ id: "f1", artifact_id: "a1", message_id: "m1", outcome: "pending" }],
      artifacts: [{ id: "a1", stats: { fires_total: 5, helpful_count: 2, harmful_count: 1 } }],
    });
    await resolveFirings({ supabase: sb, messageId: "m1", outcome: "unrelated" });
    const a1Write = sb._writes.find(w => w.table === "protocol_artifact" && w.filter.id === "a1");
    assert.equal(a1Write.patch.stats.fires_total, 6);
    assert.equal(a1Write.patch.stats.helpful_count, 2); // unchanged
    assert.equal(a1Write.patch.stats.harmful_count, 1); // unchanged
  });

  it("returns 0/0 when no pending firings exist for the message", async () => {
    const sb = makeStub({ pendingFirings: [], artifacts: [] });
    const result = await resolveFirings({ supabase: sb, messageId: "m_unknown", outcome: "helpful" });
    assert.equal(result.resolved, 0);
    assert.equal(result.artifactsUpdated, 0);
  });

  it("rejects invalid outcome", async () => {
    const sb = makeStub();
    await assert.rejects(
      () => resolveFirings({ supabase: sb, messageId: "m1", outcome: "bogus" }),
      /invalid outcome/i,
    );
  });
});

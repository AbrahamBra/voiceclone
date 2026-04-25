import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { publishDraft } from "../lib/protocol-v2-versioning.js";

// E2E versioning scenario (Task 4.8) — exercises the chain
//   "édit prose → publish → stats préservées pour artifacts inchangés"
// with a realistic multi-section, multi-artifact state.
//
// We do NOT invoke the prose-edit endpoint (api/v2/protocol/extract) here :
// that path needs LLM stubbing and its own integration tests already exist.
// Instead we pre-seed the post-edit state (draft doc + new artifacts) and
// validate that publishing carries `stats` over only for the artifacts whose
// content_hash matches the previous active version.
//
// Two scenarios :
//   1. publishDraft directly (lib level)
//   2. POST /api/v2/protocol/publish handler (HTTP level)

// ─── Supabase fake (chainable, in-memory) ─────────────────────────────────

function makeSupabase(initial) {
  // Deep-clone fixture rows so writes don't mutate the test setup helpers.
  const rows = {};
  for (const [table, list] of Object.entries(initial)) {
    rows[table] = list.map((r) => structuredClone(r));
  }
  const writes = [];

  function makeBuilder(table) {
    return {
      _filter: {},
      _pendingUpdate: null,
      _pendingInsert: null,
      select() { return this; },
      eq(col, val) { this._filter[col] = val; return this; },
      in(col, vals) { this._filter[col] = { __in: vals }; return this; },
      update(patch) { this._pendingUpdate = patch; return this; },
      insert(row) { this._pendingInsert = row; return this; },
      _matches(row) {
        return Object.entries(this._filter).every(([k, v]) => {
          if (v && typeof v === "object" && Array.isArray(v.__in)) return v.__in.includes(row[k]);
          return row[k] === v;
        });
      },
      _applyWrite() {
        const matched = (rows[table] || []).filter((r) => this._matches(r));
        for (const row of matched) Object.assign(row, this._pendingUpdate);
        writes.push({ table, filter: { ...this._filter }, patch: this._pendingUpdate });
        return matched[0] || null;
      },
      _applyInsert() {
        const newRow = { id: `inserted-${writes.length}`, ...this._pendingInsert };
        if (!rows[table]) rows[table] = [];
        rows[table].push(newRow);
        writes.push({ table, insert: this._pendingInsert });
        return newRow;
      },
      async single() {
        if (this._pendingInsert) {
          const inserted = this._applyInsert();
          return { data: inserted, error: null };
        }
        if (this._pendingUpdate) {
          const updated = this._applyWrite();
          return { data: updated, error: null };
        }
        const matched = (rows[table] || []).filter((r) => this._matches(r));
        const m = matched[0];
        return { data: m || null, error: m ? null : { code: "PGRST116" } };
      },
      async maybeSingle() {
        if (this._pendingInsert || this._pendingUpdate) return this.single();
        const matched = (rows[table] || []).filter((r) => this._matches(r));
        return { data: matched[0] || null, error: null };
      },
      then(resolve) {
        if (this._pendingInsert) {
          this._applyInsert();
          resolve({ data: null, error: null });
          return;
        }
        if (this._pendingUpdate) {
          this._applyWrite();
          resolve({ data: null, error: null });
          return;
        }
        const matched = (rows[table] || []).filter((r) => this._matches(r));
        resolve({ data: matched, error: null });
      },
    };
  }

  return {
    _rows: rows,
    _writes: writes,
    from(table) { return makeBuilder(table); },
  };
}

// ─── Realistic fixture builder ────────────────────────────────────────────

const PERSONA = "11111111-aaaa-aaaa-aaaa-111111111111";
const DOC_V1 = "11111111-1111-1111-1111-111111111111";
const DOC_V2 = "22222222-2222-2222-2222-222222222222";

const SEC_V1_HARD = "v1-sec-hard";
const SEC_V1_ERRORS = "v1-sec-errors";
const SEC_V2_HARD = "v2-sec-hard";
const SEC_V2_ERRORS = "v2-sec-errors";

// Hashes : letter = "kept", digit = "new/reformulated"
const H_QUESTIONS = "h-questions-kept"; // present in v1 + v2 (rule unchanged)
const H_EXCLAM    = "h-exclam-only-v1"; // present in v1 only (reformulated, lost stats)
const H_JARGON    = "h-jargon-kept";    // present in v1 + v2
const H_TONE      = "h-tone-only-v2";   // new in v2
const H_VAGUE     = "h-vague-only-v2";  // new in v2

function fixture() {
  return {
    protocol_document: [
      { id: DOC_V1, status: "active", version: 1, owner_kind: "persona", owner_id: PERSONA, updated_at: "2026-04-01T00:00:00Z" },
      { id: DOC_V2, status: "draft",  version: 2, owner_kind: "persona", owner_id: PERSONA, updated_at: "2026-04-25T00:00:00Z" },
    ],
    protocol_section: [
      { id: SEC_V1_HARD,    document_id: DOC_V1, kind: "hard_rules" },
      { id: SEC_V1_ERRORS,  document_id: DOC_V1, kind: "errors" },
      { id: SEC_V2_HARD,    document_id: DOC_V2, kind: "hard_rules" },
      { id: SEC_V2_ERRORS,  document_id: DOC_V2, kind: "errors" },
    ],
    protocol_artifact: [
      // v1 — has live stats from weeks of usage
      { id: "v1-art-questions", source_section_id: SEC_V1_HARD,    content_hash: H_QUESTIONS, stats: { fires: 15, last_fired_at: "2026-04-20T10:00:00Z", accuracy: 0.93 } },
      { id: "v1-art-exclam",    source_section_id: SEC_V1_HARD,    content_hash: H_EXCLAM,    stats: { fires: 8,  last_fired_at: "2026-04-18T08:00:00Z", accuracy: 0.81 } },
      { id: "v1-art-jargon",    source_section_id: SEC_V1_ERRORS,  content_hash: H_JARGON,    stats: { fires: 3,  last_fired_at: "2026-04-15T16:00:00Z", accuracy: 0.7  } },
      // v2 — fresh draft, all stats default to zero before publish
      { id: "v2-art-questions", source_section_id: SEC_V2_HARD,    content_hash: H_QUESTIONS, stats: { fires: 0, last_fired_at: null, accuracy: null } },
      { id: "v2-art-tone",      source_section_id: SEC_V2_HARD,    content_hash: H_TONE,      stats: { fires: 0, last_fired_at: null, accuracy: null } },
      { id: "v2-art-jargon",    source_section_id: SEC_V2_ERRORS,  content_hash: H_JARGON,    stats: { fires: 0, last_fired_at: null, accuracy: null } },
      { id: "v2-art-vague",     source_section_id: SEC_V2_ERRORS,  content_hash: H_VAGUE,     stats: { fires: 0, last_fired_at: null, accuracy: null } },
    ],
  };
}

// ─── Scenario 1 : publishDraft (lib chain) ────────────────────────────────

describe("E2E versioning — publishDraft preserves stats for unchanged artifacts", () => {
  it("flips draft→active, archives v1, migrates exactly the matching hashes", async () => {
    const sb = makeSupabase(fixture());
    const out = await publishDraft(sb, { documentId: DOC_V2 });

    assert.equal(out.error, undefined);
    assert.equal(out.document.status, "active");
    assert.equal(out.archived_document_id, DOC_V1);
    assert.equal(out.stats_migrated, 2,
      "exactly 2 artifacts should have a content_hash match (questions, jargon)");

    // Documents reflect the new state.
    const docV1 = sb._rows.protocol_document.find((d) => d.id === DOC_V1);
    const docV2 = sb._rows.protocol_document.find((d) => d.id === DOC_V2);
    assert.equal(docV1.status, "archived");
    assert.equal(docV2.status, "active");
  });

  it("matched artifacts inherit the previous version's stats verbatim", async () => {
    const sb = makeSupabase(fixture());
    await publishDraft(sb, { documentId: DOC_V2 });

    const v2Questions = sb._rows.protocol_artifact.find((a) => a.id === "v2-art-questions");
    const v2Jargon    = sb._rows.protocol_artifact.find((a) => a.id === "v2-art-jargon");

    // questions : kept hash → fires=15 carried from v1
    assert.equal(v2Questions.stats.fires, 15);
    assert.equal(v2Questions.stats.last_fired_at, "2026-04-20T10:00:00Z");
    assert.equal(v2Questions.stats.accuracy, 0.93);

    // jargon : kept hash → fires=3 carried from v1
    assert.equal(v2Jargon.stats.fires, 3);
    assert.equal(v2Jargon.stats.last_fired_at, "2026-04-15T16:00:00Z");
  });

  it("new artifacts (no hash match) keep their default stats", async () => {
    const sb = makeSupabase(fixture());
    await publishDraft(sb, { documentId: DOC_V2 });

    const v2Tone  = sb._rows.protocol_artifact.find((a) => a.id === "v2-art-tone");
    const v2Vague = sb._rows.protocol_artifact.find((a) => a.id === "v2-art-vague");

    assert.equal(v2Tone.stats.fires, 0);
    assert.equal(v2Tone.stats.last_fired_at, null);
    assert.equal(v2Vague.stats.fires, 0);
  });

  it("artifacts of the previous version remain unchanged (history preserved)", async () => {
    const sb = makeSupabase(fixture());
    await publishDraft(sb, { documentId: DOC_V2 });

    // The archived doc still owns its artifacts with original stats — we don't
    // delete or rewrite them. Useful for audit / rollback.
    const v1Questions = sb._rows.protocol_artifact.find((a) => a.id === "v1-art-questions");
    const v1Exclam    = sb._rows.protocol_artifact.find((a) => a.id === "v1-art-exclam");
    assert.equal(v1Questions.stats.fires, 15);
    assert.equal(v1Exclam.stats.fires, 8);
  });

  it("write order: stats migration → draft activation → previous archive", async () => {
    const sb = makeSupabase(fixture());
    await publishDraft(sb, { documentId: DOC_V2 });

    // Build a coarse signature of what was written and in what order.
    const order = sb._writes.map((w) => {
      if (w.table === "protocol_artifact") return "stats";
      if (w.table === "protocol_document" && w.patch.status === "active") return "activate";
      if (w.table === "protocol_document" && w.patch.status === "archived") return "archive";
      return "other";
    });

    // 2 stats writes, then activate, then archive.
    const firstActivate = order.indexOf("activate");
    const firstArchive  = order.indexOf("archive");
    const lastStats     = order.lastIndexOf("stats");

    assert.ok(lastStats >= 0 && lastStats < firstActivate,
      "stats writes must precede the draft→active flip");
    assert.ok(firstActivate < firstArchive,
      "draft→active must precede previous→archived (so we never have zero actives)");
  });
});

// ─── Scenario 2 : POST /api/v2/protocol/publish (HTTP chain) ──────────────

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

describe("E2E versioning — HTTP publish flows through to stats migration", () => {
  it("POST /api/v2/protocol/publish returns the migrated counts and persists the changes", async () => {
    const sb = makeSupabase(fixture());
    const { default: handler } = await import("../api/v2/protocol/publish.js");

    const res = makeRes();
    await handler(
      { method: "POST", body: { documentId: DOC_V2 } },
      res,
      {
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
        hasPersonaAccess: async () => true,
        setCors: () => {},
        supabase: sb,
        // Real publishDraft (not stubbed) — this is the integration point.
      },
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res._body.archived_document_id, DOC_V1);
    assert.equal(res._body.stats_migrated, 2);
    assert.equal(res._body.document.status, "active");

    // Database reflects the migration.
    const v2Questions = sb._rows.protocol_artifact.find((a) => a.id === "v2-art-questions");
    assert.equal(v2Questions.stats.fires, 15);
  });
});

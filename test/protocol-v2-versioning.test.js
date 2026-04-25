import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildStatsMigrationPlan,
  validatePublishTransition,
  publishDraft,
} from "../lib/protocol-v2-versioning.js";

// ─── pure: buildStatsMigrationPlan ────────────────────────────────────────

describe("buildStatsMigrationPlan", () => {
  it("returns an empty plan when either side is empty", () => {
    assert.deepEqual(buildStatsMigrationPlan([], []), []);
    assert.deepEqual(buildStatsMigrationPlan([{ id: "a", content_hash: "h", stats: { fires: 5 } }], []), []);
    assert.deepEqual(buildStatsMigrationPlan([], [{ id: "b", content_hash: "h" }]), []);
  });

  it("copies stats when content_hash matches", () => {
    const oldArts = [{ id: "old1", content_hash: "h1", stats: { fires: 7, last_fired_at: "2026-04-20T00:00:00Z", accuracy: 0.9 } }];
    const newArts = [{ id: "new1", content_hash: "h1" }];
    const plan = buildStatsMigrationPlan(oldArts, newArts);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].artifactId, "new1");
    assert.deepEqual(plan[0].stats, { fires: 7, last_fired_at: "2026-04-20T00:00:00Z", accuracy: 0.9 });
  });

  it("skips new artifacts with no matching hash", () => {
    const oldArts = [{ id: "old1", content_hash: "h1", stats: { fires: 3 } }];
    const newArts = [
      { id: "new1", content_hash: "h2" },
      { id: "new2", content_hash: "h1" },
    ];
    const plan = buildStatsMigrationPlan(oldArts, newArts);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].artifactId, "new2");
  });

  it("when multiple old artifacts share a hash, picks the most-fired", () => {
    const oldArts = [
      { id: "oldA", content_hash: "h", stats: { fires: 2, last_fired_at: "2026-04-01T00:00:00Z" } },
      { id: "oldB", content_hash: "h", stats: { fires: 9, last_fired_at: "2026-04-10T00:00:00Z" } },
      { id: "oldC", content_hash: "h", stats: { fires: 5, last_fired_at: "2026-04-15T00:00:00Z" } },
    ];
    const newArts = [{ id: "new1", content_hash: "h" }];
    const plan = buildStatsMigrationPlan(oldArts, newArts);
    assert.equal(plan[0].stats.fires, 9);
  });

  it("treats a missing stats field as zero fires", () => {
    const oldArts = [
      { id: "oldA", content_hash: "h" }, // no stats
      { id: "oldB", content_hash: "h", stats: { fires: 1 } },
    ];
    const newArts = [{ id: "new1", content_hash: "h" }];
    const plan = buildStatsMigrationPlan(oldArts, newArts);
    assert.equal(plan[0].stats.fires, 1);
  });

  it("ignores artifacts missing a content_hash", () => {
    const oldArts = [{ id: "oldA", content_hash: "h", stats: { fires: 4 } }];
    const newArts = [
      { id: "new1" },          // no hash → skip
      { id: "new2", content_hash: "h" },
    ];
    const plan = buildStatsMigrationPlan(oldArts, newArts);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].artifactId, "new2");
  });
});

// ─── pure: validatePublishTransition ──────────────────────────────────────

describe("validatePublishTransition", () => {
  const validDraft = { id: "d1", status: "draft", owner_kind: "persona", owner_id: "p1" };

  it("ok when no current active and draft is valid", () => {
    assert.deepEqual(validatePublishTransition(validDraft, null), { ok: true });
  });

  it("ok when current active has same owner", () => {
    const active = { id: "d0", status: "active", owner_kind: "persona", owner_id: "p1" };
    assert.deepEqual(validatePublishTransition(validDraft, active), { ok: true });
  });

  it("rejects when draft is missing", () => {
    const out = validatePublishTransition(null, null);
    assert.equal(out.ok, false);
    assert.match(out.error, /draft.*not found|draft.*missing/i);
  });

  it("rejects when draft status !== 'draft'", () => {
    const active = { ...validDraft, status: "active" };
    const out = validatePublishTransition(active, null);
    assert.equal(out.ok, false);
    assert.match(out.error, /draft|status/i);
  });

  it("rejects when active has different owner", () => {
    const otherActive = { id: "d0", status: "active", owner_kind: "persona", owner_id: "p_OTHER" };
    const out = validatePublishTransition(validDraft, otherActive);
    assert.equal(out.ok, false);
    assert.match(out.error, /owner/i);
  });

  it("rejects when draft.id === currentActive.id (self-publish)", () => {
    const sameAsActive = { ...validDraft, id: "dup" };
    const active = { ...validDraft, id: "dup", status: "active" };
    const out = validatePublishTransition(sameAsActive, active);
    assert.equal(out.ok, false);
  });
});

// ─── async: publishDraft ──────────────────────────────────────────────────

function makeSupabase(config) {
  const writes = [];
  const sb = {
    _writes: writes,
    from(table) {
      const tableConfig = config[table] || {};
      const builder = {
        _table: table,
        _filter: {},
        _pendingUpdate: null,
        _pendingInsert: null,
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        in(col, vals) { this._filter[col] = { __in: vals }; return this; },
        update(patch) { this._pendingUpdate = patch; return this; },
        insert(row) { this._pendingInsert = row; return this; },
        _matchesFilter(row) {
          return Object.entries(this._filter).every(([k, v]) => {
            if (v && typeof v === "object" && Array.isArray(v.__in)) return v.__in.includes(row[k]);
            return row[k] === v;
          });
        },
        async single() {
          if (this._pendingInsert) {
            writes.push({ table, insert: this._pendingInsert });
            const inserted = tableConfig.onInsert
              ? tableConfig.onInsert(this._pendingInsert)
              : null;
            return { data: inserted, error: tableConfig.insertError || null };
          }
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter }, patch: this._pendingUpdate });
            const updated = tableConfig.onUpdate
              ? tableConfig.onUpdate(this._filter, this._pendingUpdate)
              : null;
            return { data: updated, error: tableConfig.updateError || null };
          }
          const rows = (tableConfig.rows || []).filter((r) => this._matchesFilter(r));
          const match = rows[0];
          return { data: match || null, error: match ? null : { code: "PGRST116" } };
        },
        async maybeSingle() {
          if (this._pendingInsert || this._pendingUpdate) return this.single();
          const rows = (tableConfig.rows || []).filter((r) => this._matchesFilter(r));
          return { data: rows[0] || null, error: null };
        },
        then(resolve) {
          if (this._pendingInsert) {
            writes.push({ table, insert: this._pendingInsert });
            const inserted = tableConfig.onInsert
              ? tableConfig.onInsert(this._pendingInsert)
              : null;
            resolve({ data: inserted, error: tableConfig.insertError || null });
            return;
          }
          if (this._pendingUpdate) {
            writes.push({ table, filter: { ...this._filter }, patch: this._pendingUpdate });
            const updated = tableConfig.onUpdate
              ? tableConfig.onUpdate(this._filter, this._pendingUpdate)
              : null;
            resolve({ data: updated, error: tableConfig.updateError || null });
            return;
          }
          const rows = (tableConfig.rows || []).filter((r) => this._matchesFilter(r));
          resolve({ data: rows, error: tableConfig.listError || null });
        },
      };
      return builder;
    },
  };
  return sb;
}

const DRAFT_ID = "11111111-1111-1111-1111-111111111111";
const ACTIVE_ID = "22222222-2222-2222-2222-222222222222";
const PERSONA_ID = "p1";

function baseFixture(overrides = {}) {
  return {
    protocol_document: {
      rows: [
        { id: DRAFT_ID, status: "draft", version: 2, owner_kind: "persona", owner_id: PERSONA_ID },
        { id: ACTIVE_ID, status: "active", version: 1, owner_kind: "persona", owner_id: PERSONA_ID },
      ],
      onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
    },
    protocol_section: {
      rows: [
        { id: "sec-draft", document_id: DRAFT_ID },
        { id: "sec-active", document_id: ACTIVE_ID },
      ],
    },
    protocol_artifact: {
      rows: [
        { id: "art-active-1", source_section_id: "sec-active", content_hash: "hX", stats: { fires: 9, last_fired_at: "2026-04-10T00:00:00Z", accuracy: 0.8 } },
        { id: "art-active-2", source_section_id: "sec-active", content_hash: "hY", stats: { fires: 1 } },
        { id: "art-draft-1",  source_section_id: "sec-draft",  content_hash: "hX", stats: { fires: 0 } },
        { id: "art-draft-2",  source_section_id: "sec-draft",  content_hash: "hZ", stats: { fires: 0 } },
      ],
      onUpdate: (filter, patch) => ({ id: filter.id, ...patch }),
    },
    ...overrides,
  };
}

describe("publishDraft", () => {
  it("happy path: flips draft→active, archives previous, migrates 1 stat", async () => {
    const sb = makeSupabase(baseFixture());
    const out = await publishDraft(sb, { documentId: DRAFT_ID });

    assert.equal(out.error, undefined);
    assert.equal(out.document.id, DRAFT_ID);
    assert.equal(out.document.status, "active");
    assert.equal(out.archived_document_id, ACTIVE_ID);
    assert.equal(out.stats_migrated, 1);

    // Order matters: draft should be flipped to active BEFORE old becomes archived
    // (so we never have zero active docs).
    const docWrites = sb._writes.filter((w) => w.table === "protocol_document");
    assert.equal(docWrites.length, 2);
    assert.equal(docWrites[0].filter.id, DRAFT_ID);
    assert.equal(docWrites[0].patch.status, "active");
    assert.equal(docWrites[1].filter.id, ACTIVE_ID);
    assert.equal(docWrites[1].patch.status, "archived");

    // Stats migrated only for the matching artifact (hX).
    const artWrites = sb._writes.filter((w) => w.table === "protocol_artifact");
    assert.equal(artWrites.length, 1);
    assert.equal(artWrites[0].filter.id, "art-draft-1");
    assert.deepEqual(artWrites[0].patch.stats, { fires: 9, last_fired_at: "2026-04-10T00:00:00Z", accuracy: 0.8 });
  });

  it("first publish (no current active) → archived_document_id null, no stats migration", async () => {
    const fix = baseFixture();
    fix.protocol_document.rows = [
      { id: DRAFT_ID, status: "draft", version: 1, owner_kind: "persona", owner_id: PERSONA_ID },
    ];
    fix.protocol_artifact.rows = [
      { id: "art-draft-1", source_section_id: "sec-draft", content_hash: "hX", stats: { fires: 0 } },
    ];
    const sb = makeSupabase(fix);
    const out = await publishDraft(sb, { documentId: DRAFT_ID });

    assert.equal(out.archived_document_id, null);
    assert.equal(out.stats_migrated, 0);
    assert.equal(out.document.status, "active");

    const docWrites = sb._writes.filter((w) => w.table === "protocol_document");
    assert.equal(docWrites.length, 1, "only the draft → active write should occur");
  });

  it("returns error and does not write when document is not a draft", async () => {
    const fix = baseFixture();
    fix.protocol_document.rows[0].status = "active";
    const sb = makeSupabase(fix);
    const out = await publishDraft(sb, { documentId: DRAFT_ID });

    assert.ok(out.error, "expected error");
    assert.match(out.error, /draft|status/i);
    assert.equal(sb._writes.length, 0);
  });

  it("returns error when document is missing", async () => {
    const sb = makeSupabase({ protocol_document: { rows: [] } });
    const out = await publishDraft(sb, { documentId: DRAFT_ID });
    assert.ok(out.error);
    assert.equal(sb._writes.length, 0);
  });
});

// ─── publishDraft + publish_event (Reco B narrative changelog) ────────────

describe("publishDraft → protocol_publish_event", () => {
  function fixtureWithPropositions() {
    return {
      ...baseFixture(),
      proposition: {
        rows: [
          { id: "prop-acc-1", document_id: DRAFT_ID, status: "accepted",
            intent: "add_rule", target_kind: "hard_rules",
            proposed_text: "Toujours vouvoyer si le prospect vouvoie." },
          { id: "prop-acc-2", document_id: DRAFT_ID, status: "accepted",
            intent: "add_paragraph", target_kind: "process",
            proposed_text: "Étape qualification — prérequis: lead a exprimé un intérêt." },
          { id: "prop-rej-1", document_id: DRAFT_ID, status: "rejected",
            intent: "remove_rule", target_kind: "hard_rules",
            proposed_text: "Ne jamais utiliser d'emojis." },
          { id: "prop-rev-1", document_id: DRAFT_ID, status: "revised",
            intent: "amend_paragraph", target_kind: "errors",
            proposed_text: "visio → visioconférence",
            user_note: "garder visio dans les rendez-vous techniques" },
          // Distractor: a pending proposition that should NOT be captured.
          { id: "prop-pending", document_id: DRAFT_ID, status: "pending",
            intent: "add_rule", target_kind: "hard_rules",
            proposed_text: "Maybe later." },
        ],
      },
      protocol_publish_event: {
        onInsert: (row) => ({ id: "evt-1", ...row }),
      },
    };
  }

  it("inserts a publish_event row capturing resolved propositions", async () => {
    const sb = makeSupabase(fixtureWithPropositions());
    const out = await publishDraft(sb, { documentId: DRAFT_ID, publishedBy: "client-42" });

    assert.equal(out.error, undefined);
    assert.equal(out.publish_event_id, "evt-1");

    const insertWrite = sb._writes.find((w) => w.table === "protocol_publish_event");
    assert.ok(insertWrite, "expected an insert write into protocol_publish_event");
    const row = insertWrite.insert;

    assert.equal(row.document_id, DRAFT_ID);
    assert.equal(row.archived_document_id, ACTIVE_ID);
    assert.equal(row.version, 2);
    assert.equal(row.published_by, "client-42");
    assert.equal(row.stats_migrated, 1);

    // Resolved proposition splits.
    assert.deepEqual(row.accepted_proposition_ids.sort(), ["prop-acc-1", "prop-acc-2"]);
    assert.deepEqual(row.rejected_proposition_ids, ["prop-rej-1"]);
    assert.deepEqual(row.revised_proposition_ids, ["prop-rev-1"]);

    // Pending proposition NOT captured.
    assert.ok(
      !row.accepted_proposition_ids.includes("prop-pending") &&
        !row.rejected_proposition_ids.includes("prop-pending") &&
        !row.revised_proposition_ids.includes("prop-pending"),
    );

    // Narrative null when no generator passed.
    assert.equal(row.summary_narrative, null);
    assert.equal(row.summary_brief, null);
  });

  it("calls generateNarrative and persists narrative + brief on the row", async () => {
    let calledWith = null;
    const generateNarrative = async (args) => {
      calledWith = args;
      return {
        narrative: "Cette semaine on a appris qu'il faut vouvoyer si le prospect vouvoie...",
        brief: "Vouvoiement aligné sur le prospect.",
      };
    };

    const sb = makeSupabase(fixtureWithPropositions());
    const out = await publishDraft(sb, {
      documentId: DRAFT_ID,
      publishedBy: "client-42",
      generateNarrative,
    });

    assert.equal(out.error, undefined);
    assert.ok(calledWith, "narrator should have been called");
    assert.equal(calledWith.accepted.length, 2);
    assert.equal(calledWith.rejected.length, 1);
    assert.equal(calledWith.revised.length, 1);
    assert.equal(calledWith.version, 2);

    const insertWrite = sb._writes.find((w) => w.table === "protocol_publish_event");
    assert.match(insertWrite.insert.summary_narrative, /vouvoyer/);
    assert.equal(insertWrite.insert.summary_brief, "Vouvoiement aligné sur le prospect.");
  });

  it("swallows narrator errors and still inserts the publish_event row", async () => {
    const generateNarrative = async () => {
      throw new Error("narrator_blew_up");
    };

    const sb = makeSupabase(fixtureWithPropositions());
    const out = await publishDraft(sb, {
      documentId: DRAFT_ID,
      generateNarrative,
    });

    // The publish itself succeeds.
    assert.equal(out.error, undefined);
    assert.equal(out.document.status, "active");

    // The event is still recorded, with null narrative.
    const insertWrite = sb._writes.find((w) => w.table === "protocol_publish_event");
    assert.ok(insertWrite);
    assert.equal(insertWrite.insert.summary_narrative, null);
    assert.equal(insertWrite.insert.summary_brief, null);
  });

  it("recordPublishEvent=false skips the insert entirely", async () => {
    const sb = makeSupabase(fixtureWithPropositions());
    const out = await publishDraft(sb, {
      documentId: DRAFT_ID,
      recordPublishEvent: false,
    });

    assert.equal(out.error, undefined);
    assert.equal(out.publish_event_id, null);
    const inserts = sb._writes.filter((w) => w.table === "protocol_publish_event");
    assert.equal(inserts.length, 0);
  });
});

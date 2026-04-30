import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  drainEventsToProposition,
  eventToSignal,
  MIN_CONFIDENCE_INSERT,
} from "../scripts/feedback-event-to-proposition.js";

// ─────────────────────────────────────────────────────────────
// Supabase stub. Mirrors only the chained-builder calls we use.
//   .from(table).select(...).is(...).gte(...).order(...).limit(...)   → eventsResolved
//   .from(table).update(...).eq(...)                                  → updatesCalled.push
//   .from(table).select(...).eq(...).eq(...).eq(...).limit(1).maybeSingle() → docsResolved
//   .from(table).update(...).eq(...).select(...).maybeSingle()        → mergeResolved
//   .from(table).insert(...).select(...).single()                     → insertResolved
// ─────────────────────────────────────────────────────────────
function makeSupabase({
  events = [],
  documentIdByPersona = {},
  // V1.5 — sourceByConv: { [conversationId]: 'visite_profil' | … } drives the
  // conversations.source_core lookup in resolveTargetDocumentId. Empty by
  // default → all routing falls through to global doc (legacy behavior).
  sourceByConv = {},
  // V1.5 — playbookIdBySource: { [personaId]: { [source_core]: playbookDocId } }
  // resolves the source-specific playbook doc when sourceByConv hits.
  playbookIdBySource = {},
  insertResult = { id: "p-new", count: 1 },
  mergeResult = { id: "p-existing", count: 2 },
} = {}) {
  const updatesCalled = [];
  const insertsCalled = [];
  const merges = [];

  const sb = {
    updatesCalled,
    insertsCalled,
    merges,
    from(table) {
      if (table === "feedback_events") {
        return makeFeedbackEventsBuilder(events, updatesCalled);
      }
      if (table === "protocol_document") {
        return makeProtocolDocumentBuilder(documentIdByPersona, playbookIdBySource);
      }
      if (table === "conversations") {
        return makeConversationsBuilder(sourceByConv);
      }
      if (table === "proposition") {
        return makePropositionBuilder({ insertResult, mergeResult, insertsCalled, merges });
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return sb;
}

function makeFeedbackEventsBuilder(events, updatesCalled) {
  const builder = {
    _select() {
      return this;
    },
    select(...args) {
      this._isSelect = true;
      return this;
    },
    is() {
      return this;
    },
    gte() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: events, error: null });
    },
    update(payload) {
      return {
        eq: (col, val) => {
          updatesCalled.push({ col, val, payload });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return builder;
}

function makeProtocolDocumentBuilder(globalMap, playbookMap = {}) {
  let personaId = null;
  let sourceCore = null;     // .eq('source_core', X) sets this
  let isSourceCoreNull = false; // .is('source_core', null) sets this
  return {
    select() {
      return this;
    },
    eq(col, val) {
      if (col === "owner_id") personaId = val;
      if (col === "source_core") sourceCore = val;
      return this;
    },
    is(col, val) {
      // Migration 055 / V1.5 — getGlobalDocumentId filters source_core IS NULL
      // to pin the global doc when source-specific playbooks coexist.
      if (col === "source_core" && val === null) isSourceCoreNull = true;
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      // Source-specific playbook query (V1.5) : .eq('source_core', X)
      if (sourceCore) {
        const id = playbookMap[personaId]?.[sourceCore];
        if (id) return Promise.resolve({ data: { id }, error: null });
        return Promise.resolve({ data: null, error: null });
      }
      // Global doc query : .is('source_core', null) — falls through if either
      // explicit (post-055) or omitted (legacy tests don't set the filter).
      const id = globalMap[personaId];
      if (id) return Promise.resolve({ data: { id }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makeConversationsBuilder(sourceByConv) {
  let convId = null;
  return {
    select() { return this; },
    eq(col, val) {
      if (col === "id") convId = val;
      return this;
    },
    maybeSingle() {
      const sc = sourceByConv[convId];
      if (sc) return Promise.resolve({ data: { source_core: sc }, error: null });
      // No row OR row with source_core null — same effect : routing falls
      // through to global doc.
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makePropositionBuilder({ insertResult, mergeResult, insertsCalled, merges }) {
  return {
    insert(row) {
      insertsCalled.push(row);
      return {
        select() {
          return this;
        },
        single: () => Promise.resolve({ data: insertResult, error: null }),
      };
    },
    update(payload) {
      return {
        eq(col, val) {
          merges.push({ col, val, payload });
          return {
            select() {
              return this;
            },
            maybeSingle: () => Promise.resolve({ data: mergeResult, error: null }),
          };
        },
      };
    },
  };
}

const FAKE_EMBED = () => Promise.resolve(new Array(1024).fill(0.01));
const NO_SIMILAR = () => Promise.resolve([]);
const ONE_SIMILAR = () =>
  Promise.resolve([
    {
      id: "p-existing",
      similarity: 0.9,
      proposed_text: "Max 2 questions par message.",
      intent: "add_rule",
      target_kind: "hard_rules",
      target_section_id: null,
      count: 1,
      source_refs: ["e-prev"],
    },
  ]);

const HIGH_CONF_CANDIDATE = {
  target_kind: "hard_rules",
  proposal: {
    intent: "add_rule",
    target_kind: "hard_rules",
    proposed_text: "Max 2 questions par message.",
    rationale: "user corrected 3 questions in last bot reply",
    confidence: 0.92,
  },
};

const LOW_CONF_CANDIDATE = {
  target_kind: "hard_rules",
  proposal: {
    intent: "add_rule",
    target_kind: "hard_rules",
    proposed_text: "Plutôt court.",
    rationale: "weak signal",
    confidence: 0.5,
  },
};

const baseEvent = {
  id: "e-1",
  conversation_id: "c-1",
  message_id: "m-1",
  persona_id: "persona-1",
  event_type: "corrected",
  correction_text: "Max 2 questions par message",
  diff_before: null,
  diff_after: null,
  rules_fired: [],
  created_at: new Date().toISOString(),
};

describe("eventToSignal", () => {
  it("returns null on null/empty event", () => {
    assert.equal(eventToSignal(null), null);
    assert.equal(eventToSignal({}), null);
  });

  it("uses correction_text when present", () => {
    const out = eventToSignal({ ...baseEvent, correction_text: "hello" });
    assert.equal(out.source_text, "hello");
    assert.equal(out.source_type, "corrected");
  });

  it("falls back to diff_after when correction_text is empty", () => {
    const out = eventToSignal({
      ...baseEvent,
      correction_text: "",
      diff_after: "fallback",
    });
    assert.equal(out.source_text, "fallback");
  });

  it("returns null when no source_text available", () => {
    const out = eventToSignal({
      ...baseEvent,
      correction_text: "",
      diff_after: "",
    });
    assert.equal(out, null);
  });

  it("forwards conversation/message/persona ids in context", () => {
    const out = eventToSignal(baseEvent);
    assert.equal(out.context.conversation_id, "c-1");
    assert.equal(out.context.persona_id, "persona-1");
  });
});

describe("drainEventsToProposition — happy paths", () => {
  it("inserts a new proposition when no similar exists and confidence is high", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(out.processed, 1);
    assert.equal(out.inserted, 1);
    assert.equal(out.merged, 0);
    assert.equal(supabase.insertsCalled.length, 1);
    assert.equal(supabase.insertsCalled[0].source_ref, "e-1");
    assert.equal(supabase.insertsCalled[0].count, 1);
    assert.equal(supabase.insertsCalled[0].status, "pending");
    // event marked drained
    assert.ok(supabase.updatesCalled.find((u) => u.payload?.drained_at));
  });

  it("merges into existing similar proposition (count++)", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: ONE_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(out.merged, 1);
    assert.equal(out.inserted, 0);
    assert.equal(supabase.merges.length, 1);
    assert.deepEqual(supabase.merges[0].payload.source_refs.sort(), ["e-1", "e-prev"].sort());
  });

  it("silences low-confidence proposal when no similar match", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([LOW_CONF_CANDIDATE]),
    });
    assert.equal(out.silenced, 1);
    assert.equal(out.inserted, 0);
    assert.equal(supabase.insertsCalled.length, 0);
  });

  it("skips event with no source_text", async () => {
    const supabase = makeSupabase({
      events: [{ ...baseEvent, correction_text: "", diff_after: "" }],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => {
        throw new Error("router should not be called");
      },
    });
    assert.equal(out.skipped, 1);
    assert.equal(supabase.insertsCalled.length, 0);
    assert.ok(supabase.updatesCalled.find((u) => u.payload?.drained_at));
  });

  it("skips event with no active document for persona", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: {},
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(out.skipped, 1);
    assert.equal(supabase.insertsCalled.length, 0);
  });

  it("processes multi-target candidates per event (e.g. hard_rules + errors)", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () =>
        Promise.resolve([
          HIGH_CONF_CANDIDATE,
          {
            target_kind: "errors",
            proposal: {
              intent: "add_paragraph",
              target_kind: "errors",
              proposed_text: "Évite 'X' — préfère 'Y'.",
              rationale: "...",
              confidence: 0.85,
            },
          },
        ]),
    });
    assert.equal(out.inserted, 2);
    assert.equal(supabase.insertsCalled.length, 2);
  });

  it("recovers from router error and marks event drained anyway", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.reject(new Error("router blew up")),
    });
    assert.equal(out.skipped, 1);
    // event still marked drained — we don't re-process broken events forever
    assert.ok(supabase.updatesCalled.find((u) => u.payload?.drained_at));
  });

  it("dry-run does not insert, merge, or mark drained", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
      dryRun: true,
    });
    assert.equal(out.processed, 1);
    assert.equal(out.inserted, 1); // counts as dry insert
    assert.equal(supabase.insertsCalled.length, 0);
    assert.equal(supabase.updatesCalled.filter((u) => u.payload?.drained_at).length, 0);
  });
});

describe("drainEventsToProposition — embed unavailable", () => {
  it("still inserts when embed returns null (no dedup, but high-conf passes)", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainEventsToProposition({
      supabase,
      embed: () => Promise.resolve(null),
      findSimilar: () => {
        throw new Error("findSimilar should not be called when embedding is null");
      },
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(out.inserted, 1);
    assert.equal(supabase.insertsCalled[0].embedding, null);
  });
});

describe("drainEventsToProposition — empty input", () => {
  it("returns zeros when no undrained events", async () => {
    const supabase = makeSupabase({ events: [] });
    const out = await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([]),
    });
    assert.equal(out.processed, 0);
    assert.equal(out.inserted, 0);
    assert.equal(out.merged, 0);
  });
});

describe("MIN_CONFIDENCE_INSERT exposed", () => {
  it("matches spec value 0.75", () => {
    assert.equal(MIN_CONFIDENCE_INSERT, 0.75);
  });
});

// ─────────────────────────────────────────────────────────────
// V1.5 — source-aware routing of corrections (migration 055 + #160).
// ─────────────────────────────────────────────────────────────
describe("drainEventsToProposition — V1.5 source-aware routing", () => {
  it("routes the proposition to the SOURCE-SPECIFIC playbook when conv has source_core and a matching playbook exists", async () => {
    const supabase = makeSupabase({
      events: [baseEvent], // conversation_id = "c-1", persona_id = "persona-1"
      documentIdByPersona: { "persona-1": "global-doc" },
      sourceByConv: { "c-1": "visite_profil" },
      playbookIdBySource: { "persona-1": { visite_profil: "playbook-vp-doc" } },
    });
    await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(supabase.insertsCalled.length, 1);
    assert.equal(
      supabase.insertsCalled[0].document_id,
      "playbook-vp-doc",
      "proposition should land on the visite_profil playbook, not the global doc"
    );
  });

  it("falls back to the GLOBAL doc when conv has source_core but no matching playbook is seeded yet", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "global-doc" },
      sourceByConv: { "c-1": "spyer" },
      // no playbook for persona-1.spyer
    });
    await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(supabase.insertsCalled[0].document_id, "global-doc");
  });

  it("uses the GLOBAL doc when the conv has no source_core (legacy behavior preserved)", async () => {
    const supabase = makeSupabase({
      events: [baseEvent],
      documentIdByPersona: { "persona-1": "global-doc" },
      // no sourceByConv entry → routing returns null source_core → global
    });
    await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(supabase.insertsCalled[0].document_id, "global-doc");
  });

  it("uses the GLOBAL doc when the event has no conversation_id at all (cron-derived signals)", async () => {
    const eventNoConv = { ...baseEvent, conversation_id: null };
    const supabase = makeSupabase({
      events: [eventNoConv],
      documentIdByPersona: { "persona-1": "global-doc" },
      sourceByConv: { "c-1": "visite_profil" }, // exists but irrelevant — event has no conv id
    });
    await drainEventsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(supabase.insertsCalled[0].document_id, "global-doc");
  });
});

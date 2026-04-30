import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  drainCorrectionsToProposition,
  correctionToSignal,
  isPositiveMarker,
} from "../scripts/feedback-event-to-proposition.js";

// ─────────────────────────────────────────────────────────────
// Supabase stub for the corrections bridge. Same shape as the events
// stub in feedback-event-to-proposition.test.js but reading from
// `corrections` (with .in(), .is()) and writing proposition_drained_at.
// ─────────────────────────────────────────────────────────────
function makeSupabase({
  rows = [],
  documentIdByPersona = {},
  insertResult = { id: "p-new", count: 1 },
  mergeResult = { id: "p-existing", count: 2 },
} = {}) {
  const updatesCalled = [];
  const insertsCalled = [];
  const merges = [];

  return {
    updatesCalled,
    insertsCalled,
    merges,
    from(table) {
      if (table === "corrections") {
        return makeCorrectionsBuilder(rows, updatesCalled);
      }
      if (table === "protocol_document") {
        return makeProtocolDocumentBuilder(documentIdByPersona);
      }
      if (table === "proposition") {
        return makePropositionBuilder({ insertResult, mergeResult, insertsCalled, merges });
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function makeCorrectionsBuilder(rows, updatesCalled) {
  return {
    select() { return this; },
    is() { return this; },
    in() { return this; },
    gte() { return this; },
    order() { return this; },
    limit() {
      return Promise.resolve({ data: rows, error: null });
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
}

function makeProtocolDocumentBuilder(map) {
  let personaId = null;
  return {
    select() { return this; },
    eq(col, val) {
      if (col === "owner_id") personaId = val;
      return this;
    },
    // Migration 055 — getActiveDocumentId now filters source_core IS NULL to
    // pin the global doc when source-specific playbooks coexist. Stub no-ops
    // since the map maps personaId → globalDocId 1-to-1.
    is() { return this; },
    limit() { return this; },
    maybeSingle() {
      const id = map[personaId];
      if (id) return Promise.resolve({ data: { id }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makePropositionBuilder({ insertResult, mergeResult, insertsCalled, merges }) {
  return {
    insert(row) {
      insertsCalled.push(row);
      return {
        select() { return this; },
        single: () => Promise.resolve({ data: insertResult, error: null }),
      };
    },
    update(payload) {
      return {
        eq(col, val) {
          merges.push({ col, val, payload });
          return {
            select() { return this; },
            maybeSingle: () => Promise.resolve({ data: mergeResult, error: null }),
          };
        },
      };
    },
  };
}

const FAKE_EMBED = () => Promise.resolve(new Array(1024).fill(0.01));
const NO_SIMILAR = () => Promise.resolve([]);
const HIGH_CONF_CANDIDATE = {
  target_kind: "errors",
  proposal: {
    intent: "add_paragraph",
    target_kind: "errors",
    proposed_text: "Évite 'n'hésitez pas' — préfère 'dis-moi'.",
    rationale: "Implicit: copy_paste_out signal validated draft text.",
    confidence: 0.88,
  },
};

const baseCorrection = {
  id: "c-1",
  persona_id: "persona-1",
  correction: "[COPY_PASTE_OUT] j'ai copié ce draft, gardez le ton",
  user_message: "what should i write?",
  bot_message: "Voici un draft: ...",
  source_channel: "copy_paste_out",
  confidence_weight: 0.6,
  is_implicit: true,
  created_at: new Date().toISOString(),
};

describe("correctionToSignal", () => {
  it("returns null on null/empty input", () => {
    assert.equal(correctionToSignal(null), null);
    assert.equal(correctionToSignal({}), null);
  });

  it("strips [COPY_PASTE_OUT] prefix", () => {
    const out = correctionToSignal({ ...baseCorrection, correction: "[COPY_PASTE_OUT] hello" });
    assert.equal(out.source_text, "hello");
    assert.equal(out.source_type, "copy_paste_out");
  });

  it("strips [REGEN_REJECTED] prefix", () => {
    const out = correctionToSignal({
      ...baseCorrection,
      source_channel: "regen_rejection",
      correction: "[REGEN_REJECTED] redo this",
    });
    assert.equal(out.source_text, "redo this");
    assert.equal(out.source_type, "regen_rejection");
  });

  it("returns null when stripped text is empty", () => {
    const out = correctionToSignal({ ...baseCorrection, correction: "[COPY_PASTE_OUT]   " });
    assert.equal(out, null);
  });

  it("preserves confidence_weight and is_implicit in context", () => {
    const out = correctionToSignal(baseCorrection);
    assert.equal(out.context.confidence_weight, 0.6);
    assert.equal(out.context.is_implicit, true);
  });

  it("falls back to chat_correction when source_channel missing", () => {
    const out = correctionToSignal({ ...baseCorrection, source_channel: null, correction: "fix this" });
    assert.equal(out.source_type, "chat_correction");
  });

  it("forwards user/bot messages to context", () => {
    const out = correctionToSignal({
      ...baseCorrection,
      correction: "use dis-moi instead of n'hésitez pas",
      user_message: "is the message ok?",
      bot_message: "n'hésitez pas à me contacter",
    });
    assert.equal(out.context.user_message, "is the message ok?");
    assert.equal(out.context.bot_message, "n'hésitez pas à me contacter");
  });
});

describe("isPositiveMarker", () => {
  it("detects [VALIDATED]", () => {
    assert.equal(isPositiveMarker("[VALIDATED] yes good"), true);
  });
  it("detects [CLIENT_VALIDATED]", () => {
    assert.equal(isPositiveMarker("[CLIENT_VALIDATED] confirmé"), true);
  });
  it("detects [EXCELLENT]", () => {
    assert.equal(isPositiveMarker("[EXCELLENT] pattern à multiplier"), true);
  });
  it("ignores other prefixes", () => {
    assert.equal(isPositiveMarker("[COPY_PASTE_OUT] ..."), false);
    assert.equal(isPositiveMarker("normal correction text"), false);
  });
  it("rejects null/undefined/non-string", () => {
    assert.equal(isPositiveMarker(null), false);
    assert.equal(isPositiveMarker(undefined), false);
    assert.equal(isPositiveMarker(123), false);
  });
});

describe("drainCorrectionsToProposition — positive markers", () => {
  it("classifies [VALIDATED] as positive_marker (not no_candidates)", async () => {
    const supabase = makeSupabase({
      rows: [{ ...baseCorrection, correction: "[VALIDATED] Réponse validée par l'utilisateur" }],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => {
        throw new Error("router should not be called for positive markers");
      },
    });
    assert.equal(out.processed, 1);
    assert.equal(out.skipped, 1);
    assert.equal(out.inserted, 0);
    assert.equal(supabase.insertsCalled.length, 0);

    const reasons = out.results[0].outcomes.map((o) => o.reason);
    assert.ok(reasons.includes("positive_marker"));
    assert.ok(!reasons.includes("no_candidates"));
    // marked drained so cron doesn't re-pick
    assert.ok(supabase.updatesCalled.find((u) => u.payload?.proposition_drained_at));
  });

  it("classifies [CLIENT_VALIDATED] as positive_marker", async () => {
    const supabase = makeSupabase({
      rows: [{ ...baseCorrection, correction: "[CLIENT_VALIDATED] confirmé par le client" }],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => {
        throw new Error("router should not be called");
      },
    });
    assert.equal(out.skipped, 1);
    assert.equal(out.results[0].outcomes[0].reason, "positive_marker");
  });
});

describe("drainCorrectionsToProposition — happy paths", () => {
  it("inserts a new proposition with source='chat_rewrite'", async () => {
    const supabase = makeSupabase({
      rows: [baseCorrection],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(out.processed, 1);
    assert.equal(out.inserted, 1);
    assert.equal(supabase.insertsCalled.length, 1);
    assert.equal(supabase.insertsCalled[0].source, "chat_rewrite");
    assert.equal(supabase.insertsCalled[0].source_ref, "c-1");
    assert.equal(supabase.insertsCalled[0].target_kind, "errors");
  });

  it("marks correction proposition_drained_at after processing", async () => {
    const supabase = makeSupabase({
      rows: [baseCorrection],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    const drainedUpdate = supabase.updatesCalled.find(
      (u) => u.payload?.proposition_drained_at,
    );
    assert.ok(drainedUpdate, "should mark proposition_drained_at");
    assert.equal(drainedUpdate.col, "id");
    assert.equal(drainedUpdate.val, "c-1");
  });

  it("skips correction with empty text after prefix strip", async () => {
    const supabase = makeSupabase({
      rows: [{ ...baseCorrection, correction: "[COPY_PASTE_OUT] " }],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => {
        throw new Error("router should not be called");
      },
    });
    assert.equal(out.skipped, 1);
    assert.equal(supabase.insertsCalled.length, 0);
    // still mark drained to avoid retry storm
    assert.ok(supabase.updatesCalled.find((u) => u.payload?.proposition_drained_at));
  });

  it("skips when persona has no active document", async () => {
    const supabase = makeSupabase({
      rows: [baseCorrection],
      documentIdByPersona: {},
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
    });
    assert.equal(out.skipped, 1);
    assert.equal(supabase.insertsCalled.length, 0);
  });

  it("recovers from router error and marks correction drained", async () => {
    const supabase = makeSupabase({
      rows: [baseCorrection],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.reject(new Error("router blew up")),
    });
    assert.equal(out.skipped, 1);
    assert.ok(supabase.updatesCalled.find((u) => u.payload?.proposition_drained_at));
  });

  it("dry-run does not insert, merge, or mark drained", async () => {
    const supabase = makeSupabase({
      rows: [baseCorrection],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([HIGH_CONF_CANDIDATE]),
      dryRun: true,
    });
    assert.equal(out.processed, 1);
    assert.equal(out.inserted, 1); // dry-insert counts in summary
    assert.equal(supabase.insertsCalled.length, 0);
    assert.equal(supabase.updatesCalled.filter((u) => u.payload?.proposition_drained_at).length, 0);
  });

  it("returns zeros on empty input", async () => {
    const supabase = makeSupabase({ rows: [] });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () => Promise.resolve([]),
    });
    assert.equal(out.processed, 0);
  });
});

describe("drainCorrectionsToProposition — channel filter", () => {
  it("processes regen_rejection with same path as copy_paste_out", async () => {
    const row = {
      ...baseCorrection,
      id: "c-2",
      source_channel: "regen_rejection",
      correction: "[REGEN_REJECTED] this draft was rejected",
      confidence_weight: 0.5,
    };
    const supabase = makeSupabase({
      rows: [row],
      documentIdByPersona: { "persona-1": "doc-1" },
    });
    const out = await drainCorrectionsToProposition({
      supabase,
      embed: FAKE_EMBED,
      findSimilar: NO_SIMILAR,
      runRouteAndExtract: () =>
        Promise.resolve([
          {
            target_kind: "hard_rules",
            proposal: {
              intent: "add_rule",
              target_kind: "hard_rules",
              proposed_text: "Quelque chose de nouveau.",
              rationale: "from rejection signal",
              confidence: 0.85,
            },
          },
        ]),
    });
    assert.equal(out.inserted, 1);
    assert.equal(supabase.insertsCalled[0].source, "chat_rewrite");
  });
});

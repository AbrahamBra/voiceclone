// Chunk 2 Task 2.9 — End-to-end test for the protocole-vivant pipeline.
//
// Two test surfaces in this file:
//
// 1. ALWAYS RUN — wiring smoke test : verifie que les modules s'importent,
//    que les exports clé existent, et que la pipeline composée
//    (eventToSignal → routeAndExtract → embed → findSimilar → persist)
//    tourne bout-en-bout avec des stubs in-process. Ce test prouve la
//    plomberie sans toucher Postgres ni Anthropic.
//
// 2. OPTIONNEL (skipped sans SUPABASE_TEST_URL) — full live E2E :
//    insère un feedback_event dans une vraie DB Supabase de test, lance
//    le cron, vérifie qu'une proposition pending apparaît, appelle
//    l'endpoint accept, vérifie que la section a été mise à jour.
//
// IMPORTANT : la voie 2 ne tourne JAMAIS contre la prod. Elle exige que
// l'env var SUPABASE_TEST_URL pointe sur une instance distincte (preview
// ou local) et SUPABASE_TEST_SERVICE_ROLE_KEY soit set.

import { strict as assert } from "node:assert";
import { describe, it, before } from "node:test";

// Import all the wiring under test.
import {
  eventToSignal,
  drainEventsToProposition,
  MIN_CONFIDENCE_INSERT,
} from "../scripts/feedback-event-to-proposition.js";
import {
  routeSignal,
  runExtractors,
  routeAndExtract,
} from "../lib/protocol-v2-extractor-router.js";
import {
  EXTRACTORS,
  TARGET_KINDS,
} from "../lib/protocol-v2-extractors/index.js";
import {
  EMBEDDING_DIM,
  SEMANTIC_DEDUP_THRESHOLD,
  isProtocolEmbeddingAvailable,
} from "../lib/protocol-v2-embeddings.js";
import handler from "../api/v2/protocol/extract.js";

// ─────────────────────────────────────────────────────────────
// Surface 1 — wiring smoke test (always runs)
// ─────────────────────────────────────────────────────────────

describe("Chunk 2 wiring — modules export the public API expected by callers", () => {
  it("router has all 6 target_kinds wired", () => {
    // TARGET_KINDS is frozen — copy before sort.
    assert.deepEqual([...TARGET_KINDS].sort(), [
      "errors",
      "hard_rules",
      "icp_patterns",
      "process",
      "scoring",
      "templates",
    ]);
    for (const kind of TARGET_KINDS) {
      assert.equal(typeof EXTRACTORS[kind], "function", `EXTRACTORS.${kind} should be a function`);
    }
  });

  it("router exports the three callable surfaces", () => {
    assert.equal(typeof routeSignal, "function");
    assert.equal(typeof runExtractors, "function");
    assert.equal(typeof routeAndExtract, "function");
  });

  it("cron exports drainEventsToProposition + eventToSignal + threshold", () => {
    assert.equal(typeof drainEventsToProposition, "function");
    assert.equal(typeof eventToSignal, "function");
    assert.equal(MIN_CONFIDENCE_INSERT, 0.75);
  });

  it("embeddings module exposes constants matching schema (post-045)", () => {
    assert.equal(EMBEDDING_DIM, 1024);
    assert.equal(SEMANTIC_DEDUP_THRESHOLD, 0.85);
    assert.equal(typeof isProtocolEmbeddingAvailable(), "boolean");
  });

  it("extract endpoint default export is a handler function", () => {
    assert.equal(typeof handler, "function");
  });
});

describe("Chunk 2 wiring — full pipeline composed with in-process stubs", () => {
  it("event → signal → router → extractor → embed → findSimilar → insert", async () => {
    // Stateful Supabase stub : tracks inserts and the drained_at update.
    const inserted = [];
    const drained = [];

    const supabase = {
      from(table) {
        if (table === "feedback_events") {
          return {
            select() { return this; },
            is() { return this; },
            gte() { return this; },
            order() { return this; },
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: "event-e2e-1",
                    persona_id: "persona-e2e",
                    conversation_id: "conv-e2e",
                    message_id: "msg-e2e",
                    event_type: "corrected",
                    correction_text:
                      "Jamais plus de deux questions par message — c'est la règle.",
                    diff_before: null,
                    diff_after: null,
                    rules_fired: [],
                    created_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
            update: (payload) => ({
              eq: (col, val) => {
                drained.push({ payload, col, val });
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table === "protocol_document") {
          return {
            select() { return this; },
            eq() { return this; },
            // Migration 055 — getActiveDocumentId now filters source_core IS NULL.
            is() { return this; },
            limit() { return this; },
            maybeSingle: () => Promise.resolve({ data: { id: "doc-e2e" }, error: null }),
          };
        }
        if (table === "proposition") {
          return {
            insert: (row) => {
              inserted.push(row);
              return {
                select() { return this; },
                single: () =>
                  Promise.resolve({ data: { id: "prop-e2e", count: 1 }, error: null }),
              };
            },
            update: () => ({
              eq() { return { select() { return this; }, maybeSingle: () => Promise.resolve({ data: null, error: null }) }; },
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };

    // Stub router → returns hard_rules
    // Stub extractors → returns a high-confidence proposal
    const routedAndExtracted = async () => [
      {
        target_kind: "hard_rules",
        proposal: {
          intent: "add_rule",
          target_kind: "hard_rules",
          proposed_text: "Max 2 questions par message.",
          rationale: "User's correction explicitly states the rule.",
          confidence: 0.92,
        },
      },
    ];

    // Stub embed → returns a 1024-dim vector
    const embed = () => Promise.resolve(new Array(1024).fill(0.01));

    // Stub findSimilar → no match (so we'll insert)
    const findSimilar = () => Promise.resolve([]);

    const summary = await drainEventsToProposition({
      supabase,
      embed,
      findSimilar,
      runRouteAndExtract: routedAndExtracted,
    });

    assert.equal(summary.processed, 1, "one event processed");
    assert.equal(summary.inserted, 1, "one proposition inserted");
    assert.equal(summary.merged, 0);
    assert.equal(summary.silenced, 0);

    // Verify the row that hit `proposition.insert` looks right.
    assert.equal(inserted.length, 1);
    const row = inserted[0];
    assert.equal(row.document_id, "doc-e2e");
    assert.equal(row.source, "feedback_event");
    assert.equal(row.source_ref, "event-e2e-1");
    assert.deepEqual(row.source_refs, ["event-e2e-1"]);
    assert.equal(row.count, 1);
    assert.equal(row.intent, "add_rule");
    assert.equal(row.target_kind, "hard_rules");
    assert.equal(row.status, "pending");
    assert.equal(row.embedding.length, 1024);

    // Verify the event was marked drained.
    assert.equal(drained.length, 1);
    assert.ok(drained[0].payload?.drained_at);
  });

  it("extract endpoint composes save + routeAndExtract end-to-end with stubs", async () => {
    let savedProse = null;

    const DOC_UUID = "00000000-0000-0000-0000-000000000001";
    const SEC_UUID = "00000000-0000-0000-0000-000000000002";

    const stubSupabase = {
      from(table) {
        if (table === "protocol_document") {
          return {
            select() { return this; },
            eq() { return this; },
            single: () =>
              Promise.resolve({
                data: { id: DOC_UUID, owner_kind: "persona", owner_id: "persona-1" },
                error: null,
              }),
          };
        }
        if (table === "protocol_section") {
          return {
            select() { return this; },
            eq() { return this; },
            single: () =>
              Promise.resolve({
                data: { id: SEC_UUID, document_id: DOC_UUID, kind: "hard_rules", heading: "Règles" },
                error: null,
              }),
            update: (payload) => ({
              eq: () => {
                savedProse = payload.prose;
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };

    const res = {
      statusCode: null,
      body: null,
      setHeader: () => {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
      end() {
        return this;
      },
    };

    await handler(
      {
        method: "POST",
        body: {
          document_id: DOC_UUID,
          section_id: SEC_UUID,
          prose: "Jamais plus de 2 questions par message.",
        },
      },
      res,
      {
        authenticateRequest: async () => ({ client: { id: "u" }, isAdmin: false }),
        hasPersonaAccess: async () => true,
        supabase: stubSupabase,
        setCors: () => {},
        routeAndExtract: async (signal) => {
          assert.equal(signal.source_type, "prose_edit");
          assert.equal(signal.context.section_kind, "hard_rules");
          return [
            {
              target_kind: "hard_rules",
              proposal: {
                intent: "add_rule",
                target_kind: "hard_rules",
                proposed_text: "Max 2 questions par message.",
                rationale: "from prose",
                confidence: 0.9,
              },
            },
          ];
        },
      },
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.saved, true);
    assert.equal(savedProse, "Jamais plus de 2 questions par message.");
    assert.equal(res.body.candidates.length, 1);
    assert.equal(res.body.candidates[0].target_kind, "hard_rules");
  });
});

// ─────────────────────────────────────────────────────────────
// Surface 2 — full live E2E (gated on SUPABASE_TEST_URL)
//
// Doc-only for now. The shape of a real run is :
//   1. createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY)
//   2. Insert a persona + protocol_document(active) + a hard_rules section
//   3. Insert a feedback_events row with correction_text
//   4. Call drainEventsToProposition({ supabase, ... }) avec les vrais deps
//   5. Query proposition WHERE document_id=... → assert 1 row, status=pending
//   6. Call api/v2/propositions handler with action:'accept' (Task 4.3 will
//      patch the section.prose)
//   7. Cleanup: DELETE persona (CASCADE)
// ─────────────────────────────────────────────────────────────

describe("Chunk 2 live E2E (skipped without SUPABASE_TEST_URL)", () => {
  const liveEnabled =
    !!process.env.SUPABASE_TEST_URL && !!process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

  it(
    "full pipeline against real preview DB",
    { skip: !liveEnabled ? "SUPABASE_TEST_URL not set — gated by design" : false },
    async () => {
      // Implementation deferred to a follow-up that runs in a CI step gated
      // on the secret. The wiring smoke test above covers shape-level
      // composition; the live test would only catch driver-level breaks
      // (auth_failed, schema drift, network). Cheap to add once a preview
      // DB is provisioned for tests.
      assert.fail("placeholder — implement when SUPABASE_TEST_URL is provisioned");
    },
  );
});

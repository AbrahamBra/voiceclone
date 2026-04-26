import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildReviewDeck,
  symbolForIntent,
  relativeDateFr,
  REVIEW_DECK_ERRORS,
} from "../lib/review-deck-builder.js";

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
const ACTIVE_DOC = "22222222-2222-2222-2222-222222222222";
const DRAFT_DOC = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-04-26T12:00:00Z");

function makeSupabase(tables) {
  return {
    from(table) {
      const cfg = tables[table] || { rows: [] };
      const builder = {
        _eq: {},
        _in: {},
        select() { return this; },
        eq(col, val) { this._eq[col] = val; return this; },
        in(col, vals) { this._in[col] = vals; return this; },
        order() { return this; },
        async single() {
          const rows = cfg.rows.filter(matchFilters(this._eq, this._in));
          const row = rows[0];
          return { data: row || null, error: row ? null : { code: "PGRST116" } };
        },
        then(onFulfilled) {
          const rows = cfg.rows.filter(matchFilters(this._eq, this._in));
          // Apply post-filter sort if needed (resolved_at desc)
          if (cfg.sortBy) {
            rows.sort((a, b) => (b[cfg.sortBy] || "").localeCompare(a[cfg.sortBy] || ""));
          }
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
        },
      };
      return builder;
    },
  };
}

function matchFilters(eq, inFilters) {
  return (row) => {
    for (const [k, v] of Object.entries(eq)) if (row[k] !== v) return false;
    for (const [k, vs] of Object.entries(inFilters)) if (!vs.includes(row[k])) return false;
    return true;
  };
}

function basePersonaTable() {
  return { rows: [{ id: PERSONA_ID, name: "Thomas", client_label: null }] };
}

describe("symbolForIntent", () => {
  it("maps the 5 known intents", () => {
    assert.deepEqual(symbolForIntent("add_paragraph"), ["+", "Ajouté"]);
    assert.deepEqual(symbolForIntent("add_rule"), ["+", "Ajouté"]);
    assert.deepEqual(symbolForIntent("amend_paragraph"), ["↻", "Modifié"]);
    assert.deepEqual(symbolForIntent("refine_pattern"), ["↻", "Modifié"]);
    assert.deepEqual(symbolForIntent("remove_rule"), ["−", "Retiré"]);
  });

  it("falls back for unknown intents", () => {
    assert.deepEqual(symbolForIntent("add_disqualifier"), ["•", "Modifié"]);
    assert.deepEqual(symbolForIntent("totally_new_intent_2027"), ["•", "Modifié"]);
  });
});

describe("relativeDateFr", () => {
  it('returns "aujourd\'hui" for same-day diffs', () => {
    assert.equal(relativeDateFr("2026-04-26T08:00:00Z", NOW), "aujourd'hui");
  });
  it('returns "hier" for 1-day diff', () => {
    assert.equal(relativeDateFr("2026-04-25T11:00:00Z", NOW), "hier");
  });
  it("returns N days for 2+", () => {
    assert.equal(relativeDateFr("2026-04-20T11:00:00Z", NOW), "il y a 6 jours");
  });
});

describe("buildReviewDeck — flavor kickoff", () => {
  it("renders kickoff when only a draft exists", async () => {
    const sb = makeSupabase({
      personas: basePersonaTable(),
      protocol_document: {
        rows: [
          { id: DRAFT_DOC, owner_kind: "persona", owner_id: PERSONA_ID, status: "draft", version: 1 },
        ],
      },
      protocol_section: {
        rows: [
          { id: "s1", document_id: DRAFT_DOC, order: 1, kind: "identity", heading: "Identité", prose: "Tu es Thomas, setter immobilier." },
          { id: "s2", document_id: DRAFT_DOC, order: 2, kind: "process", heading: "Process DM", prose: "1. Accroche perso. 2. Question ouverte." },
        ],
      },
      proposition: { rows: [] },
    });
    const { flavor, markdown } = await buildReviewDeck(sb, PERSONA_ID, { now: NOW });
    assert.equal(flavor, "kickoff");
    assert.match(markdown, /^# Protocole Thomas — première version/);
    assert.match(markdown, /### §1\. Identité/);
    assert.match(markdown, /Tu es Thomas, setter immobilier\./);
    assert.match(markdown, /### §2\. Process DM/);
    assert.match(markdown, /C'est la fondation/);
  });
});

describe("buildReviewDeck — flavor ongoing", () => {
  function ongoingFixture(extras = {}) {
    return makeSupabase({
      personas: basePersonaTable(),
      protocol_document: {
        rows: [
          { id: ACTIVE_DOC, owner_kind: "persona", owner_id: PERSONA_ID, status: "active", version: 2 },
          { id: DRAFT_DOC, owner_kind: "persona", owner_id: PERSONA_ID, status: "draft", version: 3 },
        ],
      },
      protocol_section: {
        rows: [
          { id: "s1", document_id: DRAFT_DOC, order: 1, kind: "identity", heading: "Identité", prose: "Tu es Thomas." },
          { id: "s2", document_id: DRAFT_DOC, order: 2, kind: "process", heading: "Process", prose: "Étape 1. Étape 2." },
          { id: "s3", document_id: DRAFT_DOC, order: 3, kind: "templates", heading: "Templates", prose: "" },
        ],
      },
      proposition: {
        rows: extras.propositions || [],
        sortBy: "resolved_at",
      },
    });
  }

  it("renders changelog with mix of intents and groups by section", async () => {
    const sb = ongoingFixture({
      propositions: [
        {
          id: "p1",
          document_id: DRAFT_DOC,
          status: "accepted",
          intent: "amend_paragraph",
          target_kind: "identity",
          source_quote: "Tu es Tom.",
          proposed_text: "Tu es Thomas.",
          rationale: "Nom complet plus pro.",
          resolved_at: "2026-04-25T10:00:00Z",
        },
        {
          id: "p2",
          document_id: DRAFT_DOC,
          status: "accepted",
          intent: "add_rule",
          target_kind: "process",
          source_quote: null,
          proposed_text: "Toujours poser une question ouverte avant de fermer.",
          rationale: "Apprentissage de 4 corrections.",
          resolved_at: "2026-04-24T10:00:00Z",
        },
        {
          id: "p3",
          document_id: DRAFT_DOC,
          status: "accepted",
          intent: "remove_rule",
          target_kind: "process",
          source_quote: "Jamais utiliser de tutoiement.",
          proposed_text: "(retiré)",
          rationale: null,
          resolved_at: "2026-04-23T10:00:00Z",
        },
      ],
    });
    const { flavor, markdown } = await buildReviewDeck(sb, PERSONA_ID, { now: NOW });
    assert.equal(flavor, "ongoing");
    assert.match(markdown, /^# Protocole Thomas — proposition v3/);
    assert.match(markdown, /3 modifications vs v2/);
    assert.match(markdown, /### §identity/);
    assert.match(markdown, /### §process/);
    assert.match(markdown, /\*\*↻ Modifié\*\* — hier/);
    assert.match(markdown, /Avant : « Tu es Tom\. »/);
    assert.match(markdown, /Après : « Tu es Thomas\. »/);
    assert.match(markdown, /\*\*\+ Ajouté\*\* — il y a 2 jours/);
    assert.match(markdown, /\*\*− Retiré\*\* — il y a 3 jours/);
    assert.match(markdown, /\*Pourquoi :\* —/);
    // Section with empty prose is skipped
    assert.doesNotMatch(markdown, /### §3\. Templates/);
  });

  it("renders 'doctrine stable' when zero propositions accepted", async () => {
    const sb = ongoingFixture({ propositions: [] });
    const { markdown } = await buildReviewDeck(sb, PERSONA_ID, { now: NOW });
    assert.match(markdown, /Aucune modification depuis v2 — votre doctrine est stable\./);
  });

  it("omits the 'Avant' line when source_quote is null on amend", async () => {
    const sb = ongoingFixture({
      propositions: [
        {
          id: "p1",
          document_id: DRAFT_DOC,
          status: "accepted",
          intent: "amend_paragraph",
          target_kind: "identity",
          source_quote: null,
          proposed_text: "Tu es Thomas.",
          rationale: "Reformulation.",
          resolved_at: "2026-04-25T10:00:00Z",
        },
      ],
    });
    const { markdown } = await buildReviewDeck(sb, PERSONA_ID, { now: NOW });
    assert.doesNotMatch(markdown, /Avant :/);
    assert.match(markdown, /Après : « Tu es Thomas\. »/);
  });

  it("logs warning + uses fallback symbol on unknown intent", async () => {
    const warnings = [];
    const sb = ongoingFixture({
      propositions: [
        {
          id: "p1",
          document_id: DRAFT_DOC,
          status: "accepted",
          intent: "add_disqualifier",
          target_kind: "identity",
          source_quote: null,
          proposed_text: "Skip si CEO solo.",
          rationale: "Nouveau pattern.",
          resolved_at: "2026-04-25T10:00:00Z",
        },
      ],
    });
    const { markdown } = await buildReviewDeck(sb, PERSONA_ID, {
      now: NOW,
      logger: { warn: (event, payload) => warnings.push({ event, payload }) },
    });
    assert.match(markdown, /\*\*• Modifié\*\*/);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].event, "review_deck_unknown_intent");
    assert.equal(warnings[0].payload.intent, "add_disqualifier");
  });

  it("prefers client_label over name when set", async () => {
    const sb = makeSupabase({
      personas: { rows: [{ id: PERSONA_ID, name: "Thomas", client_label: "Cabinet Durand" }] },
      protocol_document: {
        rows: [{ id: DRAFT_DOC, owner_kind: "persona", owner_id: PERSONA_ID, status: "draft", version: 1 }],
      },
      protocol_section: {
        rows: [{ id: "s1", document_id: DRAFT_DOC, order: 1, kind: "identity", heading: "ID", prose: "x." }],
      },
      proposition: { rows: [] },
    });
    const { markdown } = await buildReviewDeck(sb, PERSONA_ID, { now: NOW });
    assert.match(markdown, /Protocole Cabinet Durand —/);
  });
});

describe("buildReviewDeck — error paths", () => {
  it("throws NOT_FOUND_PERSONA when persona absent", async () => {
    const sb = makeSupabase({
      personas: { rows: [] },
      protocol_document: { rows: [] },
      protocol_section: { rows: [] },
      proposition: { rows: [] },
    });
    await assert.rejects(
      () => buildReviewDeck(sb, PERSONA_ID, { now: NOW }),
      (err) => err.code === "NOT_FOUND_PERSONA",
    );
  });

  it("throws NOT_FOUND_PROTOCOL when persona has no document", async () => {
    const sb = makeSupabase({
      personas: basePersonaTable(),
      protocol_document: { rows: [] },
      protocol_section: { rows: [] },
      proposition: { rows: [] },
    });
    await assert.rejects(
      () => buildReviewDeck(sb, PERSONA_ID, { now: NOW }),
      (err) => err.code === "NOT_FOUND_PROTOCOL",
    );
  });
});

describe("REVIEW_DECK_ERRORS", () => {
  it("exports stable error codes", () => {
    assert.equal(typeof REVIEW_DECK_ERRORS.NOT_FOUND_PERSONA, "string");
    assert.equal(typeof REVIEW_DECK_ERRORS.NOT_FOUND_PROTOCOL, "string");
  });
});

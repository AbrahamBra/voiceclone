import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  composeNarratorPrompt,
  generateNarrative,
  NARRATOR_DEFAULTS,
} from "../lib/protocol-v2-changelog-narrator.js";

// ─── pure: composeNarratorPrompt ──────────────────────────────────────────

describe("composeNarratorPrompt", () => {
  it("includes accepted, revised, rejected sections when populated", () => {
    const { system, user } = composeNarratorPrompt({
      accepted: [
        { intent: "add_rule", target_kind: "hard_rules", proposed_text: "Vouvoyer si vouvoiement reçu." },
      ],
      revised: [
        {
          intent: "amend_paragraph",
          target_kind: "errors",
          proposed_text: "visio → visioconférence",
          user_note: "garder visio en context tech",
        },
      ],
      rejected: [
        { intent: "remove_rule", target_kind: "hard_rules", proposed_text: "Pas d'emojis." },
      ],
      personaName: "Thomas",
      fromVersion: 2,
      toVersion: 3,
    });

    // System prompt enforces the tone constraints + JSON output.
    assert.match(system, /Sudowrite/);
    assert.match(system, /JSON/);
    assert.match(system, /narrative/);
    assert.match(system, /brief/);

    // User prompt has all three sections.
    assert.match(user, /Propositions intégrées/);
    assert.match(user, /Propositions intégrées en version reformulée/);
    assert.match(user, /Propositions refusées/);
    assert.match(user, /Vouvoyer si vouvoiement reçu/);
    assert.match(user, /visioconférence/);
    assert.match(user, /Pas d'emojis/);
    assert.match(user, /v2 → v3/);
    assert.match(user, /garder visio en context tech/);
  });

  it("includes only sections that have entries", () => {
    const { user } = composeNarratorPrompt({
      accepted: [
        { intent: "add_rule", target_kind: "hard_rules", proposed_text: "X" },
      ],
      revised: [],
      rejected: [],
    });

    assert.match(user, /Propositions intégrées/);
    assert.ok(!/refusées/.test(user), "no rejected section when empty");
    assert.ok(!/reformulée/.test(user), "no revised section when empty");
  });

  it("emits a fallback line when nothing is resolved", () => {
    const { user } = composeNarratorPrompt({});
    assert.match(user, /Aucune proposition résolue/);
  });

  it("uses default personaName when not provided", () => {
    const { system } = composeNarratorPrompt({});
    assert.match(system, /le clone/);
  });
});

// ─── async: generateNarrative ─────────────────────────────────────────────

function makeFakeClaudeReturning(text) {
  return async () => ({ content: [{ type: "text", text }] });
}

describe("generateNarrative", () => {
  it("returns parsed narrative + brief on a clean JSON response", async () => {
    const callClaude = makeFakeClaudeReturning(
      JSON.stringify({
        narrative: "Cette semaine on a appris que Thomas refuse les emojis sauf si le prospect en envoie. On a aussi viré la formule 'à votre disposition'.",
        brief: "Emojis conditionnels + retrait formule cliché.",
      }),
    );

    const out = await generateNarrative({
      accepted: [
        { intent: "add_rule", target_kind: "hard_rules", proposed_text: "Emojis conditionnels." },
      ],
      rejected: [],
      revised: [],
      callClaude,
    });

    assert.match(out.narrative, /emojis/);
    assert.match(out.brief, /Emojis conditionnels/);
    assert.equal(out.error, undefined);
  });

  it("tolerates extra text around the JSON object", async () => {
    const callClaude = makeFakeClaudeReturning(
      `Voici le changelog:\n\n{"narrative": "Récit ici.", "brief": "Tagline."}\n\nFin.`,
    );

    const out = await generateNarrative({ accepted: [], rejected: [], revised: [], callClaude });

    assert.equal(out.narrative, "Récit ici.");
    assert.equal(out.brief, "Tagline.");
  });

  it("returns error when the response is unparseable", async () => {
    const callClaude = makeFakeClaudeReturning("Not JSON at all, just a paragraph.");
    const out = await generateNarrative({ accepted: [], rejected: [], revised: [], callClaude });
    assert.equal(out.narrative, null);
    assert.equal(out.brief, null);
    assert.equal(out.error, "narrator_unparseable");
  });

  it("returns error when content is empty", async () => {
    const callClaude = async () => ({ content: [] });
    const out = await generateNarrative({ accepted: [], rejected: [], revised: [], callClaude });
    assert.equal(out.narrative, null);
    assert.equal(out.error, "narrator_empty_response");
  });

  it("returns error when callClaude rejects", async () => {
    const callClaude = async () => {
      throw new Error("rate_limited");
    };
    const out = await generateNarrative({ accepted: [], rejected: [], revised: [], callClaude });
    assert.equal(out.narrative, null);
    assert.match(out.error, /rate_limited|narrator_call_failed/);
  });

  it("trims whitespace on parsed strings", async () => {
    const callClaude = makeFakeClaudeReturning(
      JSON.stringify({ narrative: "  Récit avec espaces.  \n", brief: "  Tagline.  " }),
    );
    const out = await generateNarrative({ accepted: [], rejected: [], revised: [], callClaude });
    assert.equal(out.narrative, "Récit avec espaces.");
    assert.equal(out.brief, "Tagline.");
  });

  it("returns error when neither narrative nor brief is present in JSON", async () => {
    const callClaude = makeFakeClaudeReturning(JSON.stringify({ foo: "bar" }));
    const out = await generateNarrative({ accepted: [], rejected: [], revised: [], callClaude });
    assert.equal(out.error, "narrator_missing_fields");
  });
});

describe("NARRATOR_DEFAULTS", () => {
  it("exposes the model + tokens + timeout knobs", () => {
    assert.ok(NARRATOR_DEFAULTS.MODEL);
    assert.ok(typeof NARRATOR_DEFAULTS.MAX_TOKENS === "number");
    assert.ok(typeof NARRATOR_DEFAULTS.TIMEOUT_MS === "number");
  });
});

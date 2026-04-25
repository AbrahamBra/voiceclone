import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractTemplate,
  normalizeProposal,
} from "../lib/protocol-v2-extractors/templates.js";

function makeClient(queue) {
  const responses = Array.isArray(queue) ? [...queue] : [queue];
  const client = { calls: 0 };
  client.messages = {
    create: async () => {
      client.calls++;
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next !== "string") throw new Error("stub_exhausted");
      return { content: [{ type: "text", text: next }] };
    },
  };
  return client;
}

describe("normalizeProposal (templates)", () => {
  it("accepts a well-formed add_paragraph skeleton", () => {
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text:
        "Template 'premier DM cold' : slot 1 = mention concrète signal profil ; slot 2 = question ouverte process actuel ; slot 3 = pas de pitch.",
      rationale: "User a décrit la structure d'un DM cold.",
      confidence: 0.9,
    });
    assert.equal(out?.target_kind, "templates");
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(out?.confidence, 0.9);
  });

  it("accepts amend_paragraph", () => {
    const out = normalizeProposal({
      intent: "amend_paragraph",
      proposed_text: "Template 'closing rdv' — ajouter slot 'horaire suggéré' avant le CTA.",
      confidence: 0.7,
    });
    assert.equal(out?.intent, "amend_paragraph");
    assert.equal(out?.target_kind, "templates");
  });

  it("returns null when extractable:false", () => {
    assert.equal(
      normalizeProposal({ extractable: false, reason: "validation noise" }),
      null,
    );
  });

  it("rejects intent specific to other extractors", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Template 'X' : slot 1 = ...",
        confidence: 0.9,
      }),
      null,
    );
    assert.equal(
      normalizeProposal({
        intent: "refine_pattern",
        proposed_text: "Template 'X' : slot 1 = ...",
        confidence: 0.8,
      }),
      null,
    );
  });

  it("returns null when proposed_text is missing or too short", () => {
    assert.equal(normalizeProposal({ intent: "add_paragraph" }), null);
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: "abc" }),
      null,
    );
  });

  it("returns null when proposed_text is absurdly long", () => {
    const long = "x".repeat(900);
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: long,
        confidence: 0.9,
      }),
      null,
    );
  });

  it("clamps confidence to [0,1] and rounds to 2 decimals", () => {
    const base = {
      intent: "add_paragraph",
      proposed_text: "Template 'X' : slot 1 = a ; slot 2 = b.",
    };
    assert.equal(normalizeProposal({ ...base, confidence: 1.7 })?.confidence, 1);
    assert.equal(normalizeProposal({ ...base, confidence: -0.4 })?.confidence, 0);
    assert.equal(
      normalizeProposal({ ...base, confidence: 0.876543 })?.confidence,
      0.88,
    );
  });

  it("defaults confidence to 0.5 when missing or invalid", () => {
    const base = {
      intent: "add_paragraph",
      proposed_text: "Template 'X' : slot 1 = a ; slot 2 = b.",
    };
    assert.equal(normalizeProposal(base)?.confidence, 0.5);
    assert.equal(
      normalizeProposal({ ...base, confidence: "high" })?.confidence,
      0.5,
    );
  });

  it("trims rationale and caps at 500 chars", () => {
    const long = "y".repeat(600);
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text: "Template 'X' : slot 1 = a ; slot 2 = b.",
      rationale: long,
      confidence: 0.8,
    });
    assert.equal(out?.rationale.length, 500);
  });

  it("rejects non-object input", () => {
    assert.equal(normalizeProposal(null), null);
    assert.equal(normalizeProposal("string"), null);
    assert.equal(normalizeProposal(42), null);
  });
});

describe("extractTemplate", () => {
  const baseSignal = {
    source_type: "playbook_paste",
    source_text:
      "Pour un premier DM cold, structure : 1) accroche sur signal profil concret, 2) question ouverte sur leur process, 3) jamais de pitch d'offre.",
  };

  it("returns null on missing signal", async () => {
    assert.equal(await extractTemplate(null), null);
    assert.equal(await extractTemplate({}), null);
  });

  it("returns null on empty source_text", async () => {
    assert.equal(await extractTemplate({ source_text: "" }), null);
    assert.equal(await extractTemplate({ source_text: "   " }), null);
  });

  it("returns null on absurdly long source_text", async () => {
    const huge = "z".repeat(5000);
    assert.equal(await extractTemplate({ source_text: huge }), null);
  });

  it("returns null without API key when no client injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.equal(await extractTemplate(baseSignal), null);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("parses a clean skeleton proposal", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Template 'premier DM cold' : slot 1 = mention signal concret ; slot 2 = question ouverte process ; slot 3 = pas de pitch.",
        rationale: "User a décrit la structure d'un DM cold explicitement.",
        confidence: 0.92,
      }),
    ]);
    const out = await extractTemplate(baseSignal, { anthropic });
    assert.equal(out?.target_kind, "templates");
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(out?.confidence, 0.92);
  });

  it("parses an amend on existing template (slot edit)", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "amend_paragraph",
        proposed_text:
          "Template 'closing rdv' — ajouter slot 'horaire suggéré' avant le CTA pour réduire la friction.",
        rationale: "User a demandé une modification ciblée.",
        confidence: 0.85,
      }),
    ]);
    const out = await extractTemplate(baseSignal, { anthropic });
    assert.equal(out?.intent, "amend_paragraph");
  });

  it("returns null on validation noise", async () => {
    const anthropic = makeClient([
      JSON.stringify({ extractable: false, reason: "user is just validating" }),
    ]);
    const out = await extractTemplate(
      { source_type: "chat_correction", source_text: "ok parfait" },
      { anthropic },
    );
    assert.equal(out, null);
  });

  it("returns null when LLM correctly routes a hard rule (format limit) elsewhere", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "format limit is a hard_rule, not template",
      }),
    ]);
    const out = await extractTemplate(
      {
        source_type: "chat_correction",
        source_text: "Jamais plus de 8 lignes dans un DM.",
      },
      { anthropic },
    );
    assert.equal(out, null);
  });

  it("returns null when LLM routes a do/don't pair to errors", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "avoid/prefer pair belongs to errors, not templates",
      }),
    ]);
    const out = await extractTemplate(
      {
        source_type: "chat_correction",
        source_text: "Évite 'n'hésitez pas' — préfère 'dis-moi'.",
      },
      { anthropic },
    );
    assert.equal(out, null);
  });

  it("returns null when LLM routes an ICP pattern away", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "ICP profile description, belongs to patterns",
      }),
    ]);
    const out = await extractTemplate(
      {
        source_type: "chat_correction",
        source_text: "Les fondateurs SaaS B2B seed répondent mieux quand on cite leur levée.",
      },
      { anthropic },
    );
    assert.equal(out, null);
  });

  it("retries once on parse-fail, then succeeds", async () => {
    const anthropic = makeClient([
      "this is prose, not json at all",
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Template 'relance J+3' : slot 1 = référer signal DM1 ; slot 2 = reposer question sans pression.",
        rationale: "second attempt parsed",
        confidence: 0.7,
      }),
    ]);
    const out = await extractTemplate(baseSignal, { anthropic });
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(anthropic.calls, 2);
  });

  it("returns null when both attempts fail to parse", async () => {
    const anthropic = makeClient(["nope", "still nope"]);
    const out = await extractTemplate(baseSignal, { anthropic });
    assert.equal(out, null);
    assert.equal(anthropic.calls, 2);
  });

  it("returns null on transport error (no retry)", async () => {
    const anthropic = makeClient([new Error("network down")]);
    const out = await extractTemplate(baseSignal, { anthropic });
    assert.equal(out, null);
    assert.equal(anthropic.calls, 1);
  });

  it("respects a tight timeout", async () => {
    const slow = { messages: { create: () => new Promise(() => {}) } };
    const t0 = Date.now();
    const out = await extractTemplate(baseSignal, { anthropic: slow, timeoutMs: 50 });
    assert.equal(out, null);
    assert.ok(Date.now() - t0 < 500);
  });

  it("rejects intent that doesn't apply to templates (e.g. add_rule)", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_rule",
        proposed_text: "Template 'X' : slot 1 = ...",
        confidence: 0.9,
      }),
    ]);
    const out = await extractTemplate(baseSignal, { anthropic });
    assert.equal(out, null);
  });
});

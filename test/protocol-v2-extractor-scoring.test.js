import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractScoring,
  normalizeProposal,
} from "../lib/protocol-v2-extractors/scoring.js";

// ─────────────────────────────────────────────────────────────
// Stub Anthropic client. Each call consumes one entry from
// `queue` (FIFO). Error entries are thrown to simulate network.
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// normalizeProposal — pure validation / shape coercion
// ─────────────────────────────────────────────────────────────

describe("normalizeProposal (scoring)", () => {
  it("accepts a well-formed add_paragraph proposal (axe)", () => {
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text:
        "Ajouter l'axe 'urgence perçue' — 0: aucun signal, 1: vague, 2: deadline évoquée, 3: délai < 30 jours.",
      rationale: "User a décrit explicitement un nouvel axe.",
      confidence: 0.9,
    });
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.target_kind, "scoring");
    assert.match(out.proposed_text, /urgence/i);
    assert.equal(out.confidence, 0.9);
  });

  it("accepts amend_paragraph", () => {
    const out = normalizeProposal({
      intent: "amend_paragraph",
      proposed_text: "Recalibrer niveau 3 de l'axe urgence : délai < 15 jours (au lieu de 30).",
      confidence: 0.7,
    });
    assert.equal(out.intent, "amend_paragraph");
    assert.equal(out.target_kind, "scoring");
  });

  it("returns null when extractable:false", () => {
    assert.equal(
      normalizeProposal({ extractable: false, reason: "hors scope scoring" }),
      null,
    );
  });

  it("returns null for unknown intents (add_rule, remove_rule, refine_pattern)", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Score ≥ 7 → DM direct.",
        confidence: 0.8,
      }),
      null,
    );
    assert.equal(
      normalizeProposal({
        intent: "remove_rule",
        proposed_text: "retirer un axe",
        confidence: 0.8,
      }),
      null,
    );
    assert.equal(
      normalizeProposal({
        intent: "refine_pattern",
        proposed_text: "x y z",
        confidence: 0.8,
      }),
      null,
    );
  });

  it("returns null when proposed_text is missing or too short", () => {
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: "" }),
      null,
    );
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: "ab" }),
      null,
    );
    assert.equal(normalizeProposal({ intent: "add_paragraph" }), null);
  });

  it("returns null when proposed_text is absurdly long", () => {
    const huge = "a".repeat(5000);
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: huge }),
      null,
    );
  });

  it("clamps confidence into [0,1] and defaults to 0.5 when missing/invalid", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Axe 'budget' — 0: inconnu, 1: flou, 2: ordre de grandeur, 3: chiffré.",
        confidence: 1.8,
      }).confidence,
      1,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Axe 'budget' — 0: inconnu, 1: flou, 2: ordre de grandeur, 3: chiffré.",
        confidence: -0.2,
      }).confidence,
      0,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Axe 'budget' — 0: inconnu, 1: flou, 2: ordre de grandeur, 3: chiffré.",
        confidence: "high",
      }).confidence,
      0.5,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Axe 'budget' — 0: inconnu, 1: flou, 2: ordre de grandeur, 3: chiffré.",
      }).confidence,
      0.5,
    );
  });

  it("returns null on null / non-object input", () => {
    assert.equal(normalizeProposal(null), null);
    assert.equal(normalizeProposal(undefined), null);
    assert.equal(normalizeProposal("string"), null);
    assert.equal(normalizeProposal(42), null);
  });
});

// ─────────────────────────────────────────────────────────────
// extractScoring — end-to-end with stubbed Anthropic client
// ─────────────────────────────────────────────────────────────

describe("extractScoring — signal fixtures", () => {
  it("fixture 1 — axe explicitement proposé avec 4 niveaux → add_paragraph confiance élevée", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Ajouter l'axe 'urgence perçue' — 0: aucun signal, 1: mention vague, 2: deadline évoquée, 3: délai < 30 jours.",
        rationale: "User a décrit l'axe et ses 4 niveaux mot pour mot.",
        confidence: 0.93,
      }),
    ]);
    const out = await extractScoring(
      {
        source_type: "direct_instruction",
        source_text:
          "ajoute un axe scoring urgence perçue : 0 aucun signal, 1 vague, 2 deadline, 3 délai moins de 30 jours",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.target_kind, "scoring");
    assert.match(out.proposed_text, /urgence/i);
    assert.ok(out.confidence >= 0.9);
    assert.equal(client.calls, 1);
  });

  it("fixture 2 — seuil chiffré sur score global → add_paragraph (decision table)", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text: "Si score global ≥ 7 → envoyer DM direct sans qualifier.",
        rationale: "User a énoncé une règle chiffrée score → action.",
        confidence: 0.88,
      }),
    ]);
    const out = await extractScoring(
      {
        source_type: "direct_instruction",
        source_text: "quand le score dépasse 7 tu envoies un DM direct, pas la peine de qualifier",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.target_kind, "scoring");
    assert.match(out.proposed_text, /≥|>=|score/i);
  });

  it("fixture 3 — recalibrage d'un niveau existant → amend_paragraph", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "amend_paragraph",
        proposed_text:
          "Recalibrer niveau 3 de l'axe 'urgence perçue' : délai < 15 jours (au lieu de 30).",
        rationale: "User a précisé que 30 jours c'est trop large, 15 plus réaliste.",
        confidence: 0.82,
      }),
    ]);
    const out = await extractScoring(
      {
        source_type: "correction",
        source_text: "en fait le niveau 3 sur urgence c'est plutôt moins de 15 jours, pas 30",
        context: {
          existing_scoring_excerpt:
            "Axe 'urgence perçue' — 0: aucun signal, 1: vague, 2: deadline, 3: < 30 jours.",
        },
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "amend_paragraph");
    assert.match(out.proposed_text, /15/);
  });

  it("fixture 4 — hard rule déguisée (max N questions) → null", async () => {
    const client = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "règle d'écriture (hard_rules), pas du scoring",
      }),
    ]);
    const out = await extractScoring(
      {
        source_type: "correction",
        source_text: "max 2 questions par DM s'il te plaît",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
  });

  it("fixture 5 — pattern ICP / ton → null", async () => {
    const client = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "pattern ICP, appartient à patterns",
      }),
    ]);
    const out = await extractScoring(
      {
        source_type: "correction",
        source_text: "les C-levels répondent mieux quand on est formel",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
  });

  it("fixture 6 — validation 'ok top' → null (noise)", async () => {
    const client = makeClient([
      JSON.stringify({ extractable: false, reason: "validation, aucun contenu scoring" }),
    ]);
    const out = await extractScoring(
      { source_type: "correction", source_text: "ok top" },
      { anthropic: client },
    );
    assert.equal(out, null);
  });

  it("fixture 7 — parse fail puis succès au retry → proposal retournée", async () => {
    const client = makeClient([
      "pas du json, juste du texte explicatif",
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text: "Si score < 4 sur axe 'budget' → pas de DM offre, rester en nurturing.",
        rationale: "User a énoncé une gate budget claire.",
        confidence: 0.84,
      }),
    ]);
    const out = await extractScoring(
      {
        source_type: "direct_instruction",
        source_text: "si le prospect est sous 4 sur budget on pitche pas l'offre, on nurture",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.confidence, 0.84);
    assert.equal(client.calls, 2, "doit avoir retry une fois sur parse fail");
  });

  it("fixture 8 — parse fail deux fois → null (pas de 3e tentative)", async () => {
    const client = makeClient(["not json #1", "not json #2 either"]);
    const out = await extractScoring(
      { source_type: "correction", source_text: "axe maturité mais flou" },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 2);
  });

  it("rejette signal vide ou source_text absent", async () => {
    const client = makeClient([]);
    assert.equal(await extractScoring({}, { anthropic: client }), null);
    assert.equal(await extractScoring(null, { anthropic: client }), null);
    assert.equal(
      await extractScoring(
        { source_type: "correction", source_text: "   " },
        { anthropic: client },
      ),
      null,
    );
    assert.equal(client.calls, 0);
  });

  it("rejette signal trop long (>4000 chars)", async () => {
    const client = makeClient([]);
    const huge = "x".repeat(4100);
    const out = await extractScoring(
      { source_type: "correction", source_text: huge },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 0);
  });

  it("bail silencieux si le client throw (erreur réseau / timeout)", async () => {
    const client = makeClient([new Error("network_error")]);
    const out = await extractScoring(
      { source_type: "correction", source_text: "score >= 7 DM direct" },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 1);
  });

  it("retourne null si pas d'API key et pas de client injecté", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await extractScoring({
        source_type: "correction",
        source_text: "score >= 7 DM direct",
      });
      assert.equal(out, null);
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

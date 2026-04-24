import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractPattern,
  normalizeProposal,
} from "../lib/protocol-v2-extractors/patterns.js";

// ─────────────────────────────────────────────────────────────
// Stub Anthropic client. Each call consumes one entry from `queue`
// (FIFO). Error entries are thrown to simulate transport failures.
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

describe("normalizeProposal (patterns)", () => {
  it("accepts a well-formed add_paragraph proposal", () => {
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text:
        "Pattern: fondateur SaaS B2B seed — signaux: 10-30 employés, levée <18 mois — question-clé: 'tu gères toi-même la prospection ?'",
      rationale: "User a décrit ce profil.",
      confidence: 0.88,
    });
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.target_kind, "icp_patterns");
    assert.match(out.proposed_text, /fondateur/i);
    assert.equal(out.confidence, 0.88);
  });

  it("returns null when extractable:false", () => {
    assert.equal(
      normalizeProposal({ extractable: false, reason: "validation msg" }),
      null,
    );
  });

  it("returns null for unknown intent (add_rule belongs to hard_rules)", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Pattern: consultants solo — signaux: 1-2 employés — Q: 'combien de clients ?'",
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
      normalizeProposal({ intent: "add_paragraph", proposed_text: "short" }),
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
    const base = {
      intent: "add_paragraph",
      proposed_text:
        "Pattern: Head of Growth scaleup — signaux: 50-200 empl, titre Head of Growth — Q: 'tu as des SDRs dédiés ?'",
    };
    assert.equal(normalizeProposal({ ...base, confidence: 1.8 }).confidence, 1);
    assert.equal(normalizeProposal({ ...base, confidence: -0.2 }).confidence, 0);
    assert.equal(normalizeProposal({ ...base, confidence: "high" }).confidence, 0.5);
    assert.equal(normalizeProposal(base).confidence, 0.5);
  });

  it("accepts amend_paragraph and refine_pattern intents", () => {
    const amend = normalizeProposal({
      intent: "amend_paragraph",
      proposed_text:
        "Pattern: consultant solo senior (5+ ans) — préciser : min 3 ans de visibilité LinkedIn.",
      confidence: 0.7,
    });
    assert.equal(amend.intent, "amend_paragraph");
    assert.equal(amend.target_kind, "icp_patterns");

    const refine = normalizeProposal({
      intent: "refine_pattern",
      proposed_text:
        "Ajouter signal 'posts hebdo' au pattern fondateur SaaS seed — question-clé inchangée.",
      confidence: 0.6,
    });
    assert.equal(refine.intent, "refine_pattern");
  });

  it("returns null on null / non-object input", () => {
    assert.equal(normalizeProposal(null), null);
    assert.equal(normalizeProposal(undefined), null);
    assert.equal(normalizeProposal("string"), null);
    assert.equal(normalizeProposal(42), null);
  });
});

// ─────────────────────────────────────────────────────────────
// extractPattern — end-to-end with stubbed Anthropic client
// 6+ fixtures représentatifs de signaux attendus en prod.
// ─────────────────────────────────────────────────────────────

describe("extractPattern — signal fixtures", () => {
  it("fixture 1 — pattern clairement nommé avec signaux + question-clé → add_paragraph haute confiance", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Pattern: fondateur SaaS B2B seed — signaux: 10-30 employés, annonce levée <18 mois, CEO LinkedIn actif (posts hebdo) — question-clé: 'tu gères toi-même ta prospection ou tu as un SDR ?'",
        rationale: "User a explicitement nommé ce pattern avec ses 3 signaux et la question qualifiante.",
        confidence: 0.93,
      }),
    ]);
    const out = await extractPattern(
      {
        source_type: "direct_instruction",
        source_text:
          "pattern fondateur SaaS B2B seed : 10-30 employés, levée récente (<18 mois), le CEO poste chaque semaine. La question qui qualifie : 'tu gères toi-même ta prospection ou tu as un SDR ?'",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.target_kind, "icp_patterns");
    assert.match(out.proposed_text, /fondateur|SaaS/i);
    assert.match(out.proposed_text, /question-clé/i);
    assert.ok(out.confidence >= 0.9);
    assert.equal(client.calls, 1);
  });

  it("fixture 2 — pattern implicite (profil décrit sans nom) → add_paragraph, nom synthétique", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Pattern: consultant solo senior — signaux: 0-1 employé, 5+ ans d'activité indépendante, offres 1-to-1 — question-clé: 'combien de clients actifs en ce moment ?'",
        rationale:
          "User décrit un profil sans le nommer ; le nom 'consultant solo senior' synthétise les signaux donnés.",
        confidence: 0.82,
      }),
    ]);
    const out = await extractPattern(
      {
        source_type: "correction",
        source_text:
          "les gens que je cible sont en général solo ou 1 collab, font ça depuis 5 ans minimum, vendent du 1-to-1. Faut leur demander combien de clients ils ont en cours.",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_paragraph");
    assert.match(out.proposed_text, /consultant|solo/i);
    assert.ok(out.confidence >= 0.7);
  });

  it("fixture 3 — noise générique (pas d'archétype) → null", async () => {
    const client = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "signal isolé sans archétype nommable",
      }),
    ]);
    const out = await extractPattern(
      {
        source_type: "correction",
        source_text: "les gens de 40+ répondent mieux en général",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 1);
  });

  it("fixture 4 — règle d'écriture déguisée → null (appartient à hard_rules)", async () => {
    const client = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "règle d'écriture, pas un pattern ICP",
      }),
    ]);
    const out = await extractPattern(
      {
        source_type: "correction",
        source_text: "max 2 questions par message, pas 3",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
  });

  it("fixture 5 — refine_pattern sur pattern existant", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "refine_pattern",
        proposed_text:
          "Ajouter le signal 'annonce hiring SDR sur LinkedIn' au pattern 'fondateur SaaS B2B seed' — indicateur fort que la prospection devient un sujet.",
        rationale:
          "User a repéré un signal additionnel sur un prospect matchant un pattern existant.",
        confidence: 0.78,
      }),
    ]);
    const out = await extractPattern(
      {
        source_type: "correction",
        source_text:
          "ajoute 'recrute un SDR' comme signal au pattern fondateur SaaS seed — c'est un signal fort",
        context: {
          existing_patterns_excerpt:
            "Pattern: fondateur SaaS B2B seed — signaux: 10-30 employés, levée <18 mois...",
        },
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "refine_pattern");
    assert.equal(out.target_kind, "icp_patterns");
    assert.match(out.proposed_text, /SDR/i);
  });

  it("fixture 6 — validation 'ok top' → null", async () => {
    const client = makeClient([
      JSON.stringify({ extractable: false, reason: "validation message" }),
    ]);
    const out = await extractPattern(
      { source_type: "correction", source_text: "ok top" },
      { anthropic: client },
    );
    assert.equal(out, null);
  });

  it("fixture 7 — parse fail puis succès au retry → proposal retournée", async () => {
    const client = makeClient([
      "pas du JSON, juste du texte explicatif",
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Pattern: Head of Growth scaleup — signaux: 50-200 employés, Series B+, titre Head of Growth/VP Growth — question-clé: 'tu as combien de SDRs dans l'équipe ?'",
        rationale: "User a esquissé ce profil avec 3 signaux et une question qualifiante.",
        confidence: 0.84,
      }),
    ]);
    const out = await extractPattern(
      {
        source_type: "direct_instruction",
        source_text:
          "autre pattern : Head of Growth en scaleup Series B+, 50-200 empl. Question : combien de SDRs il manage.",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_paragraph");
    assert.equal(out.confidence, 0.84);
    assert.equal(client.calls, 2, "doit avoir retry une fois sur parse fail");
  });

  it("fixture 8 — parse fail deux fois → null (pas de 3e tentative)", async () => {
    const client = makeClient(["not json #1", "still not json"]);
    const out = await extractPattern(
      { source_type: "correction", source_text: "pattern flou, reformule" },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 2);
  });

  it("rejette signal vide ou source_text absent", async () => {
    const client = makeClient([]);
    assert.equal(await extractPattern({}, { anthropic: client }), null);
    assert.equal(await extractPattern(null, { anthropic: client }), null);
    assert.equal(
      await extractPattern(
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
    const out = await extractPattern(
      { source_type: "correction", source_text: huge },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 0);
  });

  it("bail silencieux si le client throw (erreur réseau / timeout)", async () => {
    const client = makeClient([new Error("network_error")]);
    const out = await extractPattern(
      { source_type: "correction", source_text: "pattern fondateur SaaS seed" },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 1, "pas de retry sur throw");
  });

  it("retourne null si pas d'API key et pas de client injecté", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await extractPattern({
        source_type: "correction",
        source_text: "pattern fondateur SaaS seed",
      });
      assert.equal(out, null);
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

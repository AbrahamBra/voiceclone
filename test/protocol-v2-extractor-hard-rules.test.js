import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractHardRule,
  normalizeProposal,
} from "../lib/protocol-v2-extractors/hard_rules.js";

// ─────────────────────────────────────────────────────────────
// Stub Anthropic client. The real SDK exposes `messages.create`
// returning `{ content: [{type:'text', text:'...'}] }`. Each
// call consumes one entry from `queue` (FIFO). Error entries
// are thrown to simulate network / transport failures.
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

describe("normalizeProposal", () => {
  it("accepts a well-formed add_rule proposal", () => {
    const out = normalizeProposal({
      intent: "add_rule",
      proposed_text: "Jamais plus de deux questions par message.",
      rationale: "User a corrigé un DM avec 3 questions.",
      confidence: 0.9,
    });
    assert.deepEqual(out, {
      intent: "add_rule",
      target_kind: "hard_rules",
      proposed_text: "Jamais plus de deux questions par message.",
      rationale: "User a corrigé un DM avec 3 questions.",
      confidence: 0.9,
    });
  });

  it("returns null when extractable:false", () => {
    assert.equal(
      normalizeProposal({ extractable: false, reason: "validation msg" }),
      null,
    );
  });

  it("returns null for unknown intent", () => {
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
      normalizeProposal({ intent: "add_rule", proposed_text: "" }),
      null,
    );
    assert.equal(
      normalizeProposal({ intent: "add_rule", proposed_text: "ab" }),
      null,
    );
    assert.equal(normalizeProposal({ intent: "add_rule" }), null);
  });

  it("returns null when proposed_text is absurdly long", () => {
    const huge = "a".repeat(5000);
    assert.equal(
      normalizeProposal({ intent: "add_rule", proposed_text: huge }),
      null,
    );
  });

  it("clamps confidence into [0,1] and defaults to 0.5 when missing/invalid", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Jamais de bullets.",
        confidence: 1.8,
      }).confidence,
      1,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Jamais de bullets.",
        confidence: -0.2,
      }).confidence,
      0,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Jamais de bullets.",
        confidence: "high",
      }).confidence,
      0.5,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Jamais de bullets.",
      }).confidence,
      0.5,
    );
  });

  it("accepts remove_rule and amend_paragraph intents", () => {
    const rem = normalizeProposal({
      intent: "remove_rule",
      proposed_text: "Retirer la règle sur les bullets.",
      confidence: 0.7,
    });
    assert.equal(rem.intent, "remove_rule");
    assert.equal(rem.target_kind, "hard_rules");

    const amend = normalizeProposal({
      intent: "amend_paragraph",
      proposed_text: "Max 6 lignes au lieu de 8.",
      confidence: 0.6,
    });
    assert.equal(amend.intent, "amend_paragraph");
  });

  it("returns null on null / non-object input", () => {
    assert.equal(normalizeProposal(null), null);
    assert.equal(normalizeProposal(undefined), null);
    assert.equal(normalizeProposal("string"), null);
    assert.equal(normalizeProposal(42), null);
  });
});

// ─────────────────────────────────────────────────────────────
// extractHardRule — end-to-end with stubbed Anthropic client
// Fixtures = 6 scénarios représentatifs de signaux attendus en prod.
// ─────────────────────────────────────────────────────────────

describe("extractHardRule — signal fixtures", () => {
  it("fixture 1 — correction explicite avec nombre → add_rule confiance élevée", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "add_rule",
        proposed_text: "Jamais plus de deux questions par message.",
        rationale: "User a signalé que la dernière réponse contenait 3 questions.",
        confidence: 0.92,
      }),
    ]);
    const out = await extractHardRule(
      {
        source_type: "correction",
        source_text: "Trop de questions, max 2 par DM s'il te plaît.",
        context: {
          last_bot_msg: "Salut Marie, tu vends en B2B ? Quelle cible ? Combien de leads/mois ?",
        },
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_rule");
    assert.equal(out.target_kind, "hard_rules");
    assert.match(out.proposed_text, /questions/i);
    assert.ok(out.confidence >= 0.9);
    assert.equal(client.calls, 1);
  });

  it("fixture 2 — validation 'ok top' → null (extractable:false)", async () => {
    const client = makeClient([
      JSON.stringify({ extractable: false, reason: "validation message, pas une règle" }),
    ]);
    const out = await extractHardRule(
      {
        source_type: "correction",
        source_text: "ok top",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 1);
  });

  it("fixture 3 — instruction directe interdiction → add_rule", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "add_rule",
        proposed_text: "Ne jamais mentionner l'offre ni le prix dans un DM LinkedIn.",
        rationale: "Instruction explicite du user.",
        confidence: 0.88,
      }),
    ]);
    const out = await extractHardRule(
      {
        source_type: "direct_instruction",
        source_text: "règle : jamais parler de l'offre ou du prix, c'est trop tôt",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_rule");
    assert.match(out.proposed_text, /offre|prix/i);
  });

  it("fixture 4 — conseil de ton générique → null (appartient à patterns/errors)", async () => {
    const client = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "conseil de tonalité, appartient à patterns/errors",
      }),
    ]);
    const out = await extractHardRule(
      {
        source_type: "correction",
        source_text: "sois plus chaleureux, moins robotique",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
  });

  it("fixture 5 — parse fail puis succès au retry → proposal retournée", async () => {
    const client = makeClient([
      "pas du json du tout, juste du texte explicatif",
      JSON.stringify({
        intent: "add_rule",
        proposed_text: "Max 8 lignes par message LinkedIn.",
        rationale: "User a corrigé un DM de 12 lignes.",
        confidence: 0.85,
      }),
    ]);
    const out = await extractHardRule(
      {
        source_type: "correction",
        source_text: "beaucoup trop long, max 8 lignes",
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "add_rule");
    assert.equal(out.confidence, 0.85);
    assert.equal(client.calls, 2, "doit avoir retry une fois sur parse fail");
  });

  it("fixture 6 — parse fail deux fois → null (pas de 3e tentative)", async () => {
    const client = makeClient([
      "not json #1",
      "not json #2 either",
    ]);
    const out = await extractHardRule(
      {
        source_type: "correction",
        source_text: "hmm reformule",
      },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 2);
  });

  it("fixture 7 — regen_rejection + entities matched → amend_paragraph", async () => {
    const client = makeClient([
      JSON.stringify({
        intent: "amend_paragraph",
        proposed_text: "Jamais utiliser l'expression 'faire pressant' dans un DM.",
        rationale: "regen_rejection sur draft contenant 'fait pressant'.",
        confidence: 0.78,
      }),
    ]);
    const out = await extractHardRule(
      {
        source_type: "regen_rejection",
        source_text: "[REGEN_REJECTED] user clicked ↻ on draft",
        context: {
          draft_text: "Salut, ton post m'a fait pressant de te contacter.",
          entities: ["fait pressant"],
        },
      },
      { anthropic: client },
    );
    assert.equal(out.intent, "amend_paragraph");
    assert.equal(out.target_kind, "hard_rules");
    assert.match(out.proposed_text, /pressant/i);
  });

  it("rejette signal vide ou source_text absent", async () => {
    // Aucun appel API n'est fait — donc aucune réponse stub nécessaire.
    const client = makeClient([]);
    assert.equal(await extractHardRule({}, { anthropic: client }), null);
    assert.equal(await extractHardRule(null, { anthropic: client }), null);
    assert.equal(
      await extractHardRule({ source_type: "correction", source_text: "   " }, { anthropic: client }),
      null,
    );
    assert.equal(client.calls, 0);
  });

  it("rejette signal trop long (>4000 chars)", async () => {
    const client = makeClient([]);
    const huge = "x".repeat(4100);
    const out = await extractHardRule(
      { source_type: "correction", source_text: huge },
      { anthropic: client },
    );
    assert.equal(out, null);
    assert.equal(client.calls, 0);
  });

  it("bail silencieux si le client throw (erreur réseau / timeout)", async () => {
    const client = makeClient([new Error("network_error")]);
    const out = await extractHardRule(
      { source_type: "correction", source_text: "max 2 questions" },
      { anthropic: client },
    );
    assert.equal(out, null);
    // Pas de retry sur throw — seulement sur parse fail.
    assert.equal(client.calls, 1);
  });

  it("retourne null si pas d'API key et pas de client injecté", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await extractHardRule({
        source_type: "correction",
        source_text: "max 2 questions",
      });
      assert.equal(out, null);
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

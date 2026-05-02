import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { normalizeBatchOutput, EXTRACTOR_TOOL, EXTRACTOR_SYSTEM_PROMPT, extractFromChunk, buildExtractorTool, buildSystemPrompt, resolveAllowedTargets } from "../lib/protocol-v2-doc-extractor.js";

describe("normalizeBatchOutput", () => {
  it("returns [] for null/non-object input", () => {
    assert.deepEqual(normalizeBatchOutput(null), []);
    assert.deepEqual(normalizeBatchOutput("foo"), []);
    assert.deepEqual(normalizeBatchOutput({ propositions: "not array" }), []);
  });

  it("filters items with invalid target_kind", () => {
    const raw = {
      propositions: [
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", confidence: 0.9 },
        { target_kind: "garbage", intent: "add_rule", proposed_text: "x", confidence: 0.9 },
        { target_kind: "identity", intent: "add_rule", proposed_text: "x", confidence: 0.9 }, // identity not extractable
      ],
    };
    const out = normalizeBatchOutput(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "hard_rules");
  });

  it("clamps confidence to [0,1] and rounds to 2 decimals", () => {
    const out = normalizeBatchOutput({
      propositions: [
        { target_kind: "errors", intent: "add_paragraph", proposed_text: "Eviter X — préférer Y", confidence: 1.5 },
        { target_kind: "errors", intent: "add_paragraph", proposed_text: "A — B", confidence: -0.2 },
        { target_kind: "errors", intent: "add_paragraph", proposed_text: "C — D", confidence: 0.876543 },
      ],
    });
    assert.equal(out[0].proposal.confidence, 1);
    assert.equal(out[1].proposal.confidence, 0);
    assert.equal(out[2].proposal.confidence, 0.88);
  });

  it("trims proposed_text and drops items below MIN/above MAX length", () => {
    const out = normalizeBatchOutput({
      propositions: [
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "  ok  ", confidence: 0.8 }, // too short after trim
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "x".repeat(401), confidence: 0.8 }, // too long
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", confidence: 0.8 },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].proposal.proposed_text, "Max 6 lignes par message.");
  });

  it("returns shape {target_kind, proposal:{intent,proposed_text,rationale,confidence,target_kind}}", () => {
    const out = normalizeBatchOutput({
      propositions: [
        { target_kind: "icp_patterns", intent: "add_paragraph", proposed_text: "Founder solo SaaS B2B 1-10 employés", rationale: "doc cite ICP P1 explicit", confidence: 0.85 },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "icp_patterns");
    assert.equal(out[0].proposal.target_kind, "icp_patterns");
    assert.equal(out[0].proposal.intent, "add_paragraph");
    assert.equal(out[0].proposal.proposed_text, "Founder solo SaaS B2B 1-10 employés");
    assert.equal(out[0].proposal.rationale, "doc cite ICP P1 explicit");
    assert.equal(out[0].proposal.confidence, 0.85);
  });
});

describe("EXTRACTOR_TOOL", () => {
  it("declares one tool named emit_propositions", () => {
    assert.equal(EXTRACTOR_TOOL.name, "emit_propositions");
    assert.ok(EXTRACTOR_TOOL.description);
    assert.ok(EXTRACTOR_TOOL.input_schema);
  });

  it("input_schema has propositions array of typed objects with enum target_kind", () => {
    const s = EXTRACTOR_TOOL.input_schema;
    assert.equal(s.type, "object");
    assert.ok(s.properties.propositions);
    assert.equal(s.properties.propositions.type, "array");
    const item = s.properties.propositions.items;
    assert.deepEqual(item.required.sort(), ["confidence", "intent", "proposed_text", "target_kind"].sort());
    assert.deepEqual(
      item.properties.target_kind.enum.sort(),
      ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"],
    );
  });
});

describe("EXTRACTOR_SYSTEM_PROMPT", () => {
  it("mentions all 6 target kinds", () => {
    for (const kind of ["hard_rules", "errors", "icp_patterns", "scoring", "process", "templates"]) {
      assert.ok(EXTRACTOR_SYSTEM_PROMPT.includes(kind), `missing ${kind} in prompt`);
    }
  });

  it("instructs to emit MULTIPLE items per chunk and not skip prose narrative", () => {
    // Two key bias correctors versus the old Haiku router.
    assert.match(EXTRACTOR_SYSTEM_PROMPT, /(plusieurs|multiple|N items|tous les items)/i);
    assert.match(EXTRACTOR_SYSTEM_PROMPT, /(narrati|prose)/i);
  });
});

function makeAnthropicStub({ toolInput, contentOverride } = {}) {
  return {
    messages: {
      create: async (params) => {
        // Capture for assertions.
        makeAnthropicStub.lastCall = params;
        if (contentOverride) return contentOverride;
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_propositions",
              input: toolInput || { propositions: [] },
            },
          ],
        };
      },
    },
  };
}

describe("extractFromChunk", () => {
  it("returns [] for empty/short chunk without API call", async () => {
    const out = await extractFromChunk("", {}, { anthropic: { messages: { create: () => { throw new Error("should not be called"); } } } });
    assert.deepEqual(out, []);
  });

  it("returns [] when no API key and no anthropic stub provided", async () => {
    const oldKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await extractFromChunk("a real chunk of prose with enough length to pass the min", {}, {});
      assert.deepEqual(out, []);
    } finally {
      if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey;
    }
  });

  it("forwards tool_use input through normalizeBatchOutput", async () => {
    const anthropic = makeAnthropicStub({
      toolInput: {
        propositions: [
          { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", confidence: 0.92, rationale: "explicit dans la prose" },
          { target_kind: "icp_patterns", intent: "add_paragraph", proposed_text: "Founder solo SaaS B2B 1-10 employés", confidence: 0.85 },
          { target_kind: "garbage", intent: "x", proposed_text: "y", confidence: 0.5 }, // dropped by normalize
        ],
      },
    });
    const out = await extractFromChunk("Max 6 lignes par message dans tout DM. Cible : founders solo SaaS.", { doc_filename: "doc.md", doc_kind: "operational_playbook" }, { anthropic });
    assert.equal(out.length, 2);
    assert.equal(out[0].target_kind, "hard_rules");
    assert.equal(out[1].target_kind, "icp_patterns");
  });

  it("forces tool_choice on emit_propositions and includes context in user message", async () => {
    const anthropic = makeAnthropicStub({ toolInput: { propositions: [] } });
    await extractFromChunk("some chunk text long enough to pass min length threshold", { doc_filename: "process.md", doc_kind: "operational_playbook" }, { anthropic });
    const params = makeAnthropicStub.lastCall;
    assert.equal(params.tool_choice.type, "tool");
    assert.equal(params.tool_choice.name, "emit_propositions");
    assert.equal(params.tools.length, 1);
    assert.equal(params.tools[0].name, "emit_propositions");
    // user message mentions the filename
    const userText = params.messages[0].content;
    assert.match(userText, /process\.md/);
    assert.match(userText, /operational_playbook/);
    assert.match(userText, /some chunk text/);
  });

  it("returns [] on timeout or thrown error", async () => {
    const throwing = { messages: { create: async () => { throw new Error("net fail"); } } };
    const out = await extractFromChunk("a real chunk of prose with enough length", {}, { anthropic: throwing });
    assert.deepEqual(out, []);
  });

  it("returns [] when no tool_use block in response", async () => {
    const noTool = makeAnthropicStub({ contentOverride: { content: [{ type: "text", text: "I refuse" }] } });
    const out = await extractFromChunk("a real chunk of prose with enough length", {}, { anthropic: noTool });
    assert.deepEqual(out, []);
  });
});

describe("resolveAllowedTargets", () => {
  it("returns all 6 kinds when input is null/undefined/empty", () => {
    assert.deepEqual(resolveAllowedTargets().sort(), ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"]);
    assert.deepEqual(resolveAllowedTargets(null).sort(), ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"]);
    assert.deepEqual(resolveAllowedTargets([]).sort(), ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"]);
  });

  it("filters out unknown kinds and dedupes", () => {
    assert.deepEqual(
      resolveAllowedTargets(["icp_patterns", "garbage", "icp_patterns", "process", "identity"]),
      ["icp_patterns", "process"],
    );
  });

  it("returns all 6 if no valid kind survives", () => {
    assert.deepEqual(resolveAllowedTargets(["garbage", "identity"]).sort(), ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"]);
  });
});

describe("buildExtractorTool with allowedTargets", () => {
  it("default (no arg) has all 6 kinds in enum", () => {
    const tool = buildExtractorTool();
    assert.deepEqual(
      tool.input_schema.properties.propositions.items.properties.target_kind.enum.sort(),
      ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"],
    );
  });

  it("restricted to ['icp_patterns','process'] only those in enum", () => {
    const tool = buildExtractorTool(["icp_patterns", "process"]);
    assert.deepEqual(
      tool.input_schema.properties.propositions.items.properties.target_kind.enum.sort(),
      ["icp_patterns", "process"],
    );
  });
});

describe("buildSystemPrompt with allowedTargets", () => {
  it("default mentions all 6 kinds and is unrestricted intro", () => {
    const p = buildSystemPrompt();
    for (const k of ["hard_rules", "errors", "icp_patterns", "scoring", "process", "templates"]) {
      assert.ok(p.includes(k), `missing ${k}`);
    }
    assert.match(p, /multi-cible/i);
  });

  it("restricted prompt names allowed kinds and adds enforcement marker", () => {
    const p = buildSystemPrompt(["icp_patterns", "process"]);
    assert.ok(p.includes("icp_patterns"));
    assert.ok(p.includes("process"));
    // Must NOT mention the excluded kinds in the section list
    assert.equal(p.includes("- **hard_rules**"), false, "should not describe hard_rules section");
    assert.equal(p.includes("- **errors**"), false, "should not describe errors section");
    assert.equal(p.includes("- **scoring**"), false, "should not describe scoring section");
    assert.equal(p.includes("- **templates**"), false, "should not describe templates section");
    // Enforcement marker
    assert.match(p, /Tu DOIS limiter target_kind/i);
  });
});

describe("normalizeBatchOutput with allowedTargets", () => {
  it("drops items with target_kind ∉ allowedTargets", () => {
    const raw = {
      propositions: [
        { target_kind: "icp_patterns", intent: "add_paragraph", proposed_text: "P1 founder solo", confidence: 0.85 },
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message", confidence: 0.9 }, // dropped (restricted)
        { target_kind: "process", intent: "add_paragraph", proposed_text: "Étape M1 icebreaker DR-reçue", confidence: 0.8 },
      ],
    };
    const out = normalizeBatchOutput(raw, ["icp_patterns", "process"]);
    assert.equal(out.length, 2);
    const kinds = out.map((p) => p.target_kind).sort();
    assert.deepEqual(kinds, ["icp_patterns", "process"]);
  });

  it("default (no allowedTargets) accepts all 6 kinds (back-compat)", () => {
    const raw = {
      propositions: [
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message", confidence: 0.9 },
        { target_kind: "icp_patterns", intent: "add_paragraph", proposed_text: "P1 founder solo", confidence: 0.85 },
      ],
    };
    const out = normalizeBatchOutput(raw);
    assert.equal(out.length, 2);
  });
});

describe("extractFromChunk with allowedTargets", () => {
  it("passes restricted tool to anthropic client", async () => {
    const anthropic = makeAnthropicStub({ toolInput: { propositions: [] } });
    await extractFromChunk(
      "some chunk text long enough to pass min length threshold",
      { doc_filename: "audience.odt", doc_kind: "icp_audience" },
      { anthropic, allowedTargets: ["icp_patterns", "process"] },
    );
    const params = makeAnthropicStub.lastCall;
    assert.deepEqual(
      params.tools[0].input_schema.properties.propositions.items.properties.target_kind.enum.sort(),
      ["icp_patterns", "process"],
    );
    assert.match(params.system, /Tu DOIS limiter target_kind/i);
  });

  it("filters out items outside allowedTargets even if Sonnet returns them", async () => {
    const anthropic = makeAnthropicStub({
      toolInput: {
        propositions: [
          { target_kind: "icp_patterns", intent: "add_paragraph", proposed_text: "P1 founder", confidence: 0.85 },
          { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message", confidence: 0.9 }, // sonnet went off-script
        ],
      },
    });
    const out = await extractFromChunk(
      "some chunk text long enough to pass min length",
      { doc_kind: "icp_audience" },
      { anthropic, allowedTargets: ["icp_patterns", "process"] },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "icp_patterns");
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { extract, deriveState } from "../lib/heat/narrativeSignals.js";

function loadFixture(name) {
  return JSON.parse(readFileSync(`test/fixtures/heat-conversations/${name}.json`, "utf8"));
}

describe("narrativeSignals.extract", () => {
  it("returns empty result for empty fixture", () => {
    const fx = loadFixture("empty");
    const result = extract({
      messages: fx.messages,
      heatRows: fx.heatRows,
      now: new Date(fx.now),
    });
    assert.deepEqual(result, { signals: [], total: 0 });
  });
});

describe("deriveState", () => {
  it("maps heat ∈ [0, 0.25) to glacé", () => {
    assert.equal(deriveState(0.10, 0).state, "glacé");
    assert.equal(deriveState(0.249, 0).state, "glacé");
  });
  it("maps heat ∈ [0.25, 0.45) to froid", () => {
    assert.equal(deriveState(0.25, 0).state, "froid");
    assert.equal(deriveState(0.449, 0).state, "froid");
  });
  it("maps heat ∈ [0.45, 0.65) to tiède", () => {
    assert.equal(deriveState(0.50, 0).state, "tiède");
  });
  it("maps heat ∈ [0.65, 0.85) to chaud", () => {
    assert.equal(deriveState(0.70, 0).state, "chaud");
  });
  it("maps heat ≥ 0.85 to brûlant", () => {
    assert.equal(deriveState(0.90, 0).state, "brûlant");
    assert.equal(deriveState(1.00, 0).state, "brûlant");
  });
  it("direction montant for delta > 0.03", () => {
    assert.equal(deriveState(0.5, 0.04).direction, "montant");
  });
  it("direction descendant for delta < -0.03", () => {
    assert.equal(deriveState(0.5, -0.04).direction, "descendant");
  });
  it("direction stable for |delta| ≤ 0.03", () => {
    assert.equal(deriveState(0.5, 0.02).direction, "stable");
    assert.equal(deriveState(0.5, -0.02).direction, "stable");
    assert.equal(deriveState(0.5, 0).direction, "stable");
  });
  it("null heat returns null state and direction", () => {
    const r = deriveState(null, null);
    assert.equal(r.state, null);
    assert.equal(r.direction, null);
  });
});

describe("extract — cold-refusal fixture", () => {
  const fx = loadFixture("cold-refusal");

  it("emits exactly one cold_lexical signal", () => {
    const { signals, total } = extract({
      messages: fx.messages,
      heatRows: fx.heatRows,
      now: new Date(fx.now),
    });
    assert.equal(total, 1);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].kind, "cold_lexical");
    assert.equal(signals[0].polarity, "neg");
    assert.match(signals[0].quote, /pas le temps/i);
  });
});

// Helper: check that signals contains every kind in expected.includes_kinds
function assertContainsKinds(signals, kinds) {
  const foundKinds = new Set(signals.map(s => s.kind));
  for (const k of kinds) {
    assert.ok(foundKinds.has(k), `expected kind "${k}" in signals, got [${[...foundKinds].join(", ")}]`);
  }
}

describe("extract — call-related signals", () => {
  it("cecilia-bluecoders: detects propose_call", () => {
    const fx = loadFixture("cecilia-bluecoders");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
    const propose = signals.find(s => s.kind === "propose_call");
    assert.match(propose.quote, /de vive voix/i);
  });

  it("edwige-maveilleia: detects propose_call in a single message", () => {
    const fx = loadFixture("edwige-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });

  it("olga-maveilleia: detects accept_call + books_slot + gives_email", () => {
    const fx = loadFixture("olga-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });
});

describe("extract — engagement signals", () => {
  it("nathalie-maveilleia: business_context + books_slot + gives_email", () => {
    const fx = loadFixture("nathalie-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });
  it("hassan-immostates: question_back + accept_call", () => {
    const fx = loadFixture("hassan-immostates");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });
});

describe("extract — outbound-only signals", () => {
  it("daniel-immostates: detects relance_unanswered (multiple outbounds without response)", () => {
    const fx = loadFixture("daniel-immostates");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });

  it("theotime-maveilleia: detects ghost_2days (48h+ after outbound)", () => {
    const fx = loadFixture("theotime-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });

  it("pierre-immostates: detects propose_call (sanity, no ghost or relance)", () => {
    const fx = loadFixture("pierre-immostates");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    const kinds = new Set(signals.map(s => s.kind));
    assert.ok(kinds.has("propose_call"), "expected propose_call");
    assert.ok(!kinds.has("ghost_2days"), "ghost_2days should not fire — prospect replied same day");
    assert.ok(!kinds.has("relance_unanswered"), "no consecutive outbounds here");
  });
});

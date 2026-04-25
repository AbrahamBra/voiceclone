import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  flattenArtifacts,
  filterArtifacts,
  sortArtifactsForRegistry,
  collectFilterOptions,
} from "../src/lib/protocol-v2-registry-filter.js";

const fakeArtifact = (over = {}) => ({
  id: "a-" + Math.random().toString(36).slice(2),
  kind: "hard_check",
  severity: "strong",
  content: { rule_text: "Max 2 questions" },
  source_quote: null,
  scenarios: ["dm_cold"],
  stats: { fires: 0, last_fired_at: null, accuracy: null },
  is_active: true,
  ...over,
});

const fakeSection = (kind, artifacts) => ({
  id: `s-${kind}`,
  kind,
  heading: `Section ${kind}`,
  artifacts,
});

describe("flattenArtifacts", () => {
  it("returns [] on empty/missing input", () => {
    assert.deepEqual(flattenArtifacts(null), []);
    assert.deepEqual(flattenArtifacts([]), []);
    assert.deepEqual(flattenArtifacts([{ artifacts: [] }]), []);
  });

  it("flattens artifacts with section info merged", () => {
    const sections = [
      fakeSection("hard_rules", [fakeArtifact({ id: "a1" })]),
      fakeSection("errors", [fakeArtifact({ id: "a2", kind: "soft_check" })]),
    ];
    const rows = flattenArtifacts(sections);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].artifact_id, "a1");
    assert.equal(rows[0].section_kind, "hard_rules");
    assert.equal(rows[1].artifact_id, "a2");
    assert.equal(rows[1].section_kind, "errors");
  });

  it("ignores sections with no artifacts array", () => {
    const sections = [{ id: "s1", kind: "x" }, fakeSection("hard_rules", [fakeArtifact()])];
    const rows = flattenArtifacts(sections);
    assert.equal(rows.length, 1);
  });

  it("preserves stats and is_active default to true", () => {
    const sections = [
      fakeSection("x", [fakeArtifact({ stats: { fires: 5, last_fired_at: "2026-04-01" } })]),
    ];
    const rows = flattenArtifacts(sections);
    assert.equal(rows[0].stats.fires, 5);
    assert.equal(rows[0].is_active, true);
  });
});

describe("filterArtifacts", () => {
  const rows = [
    { artifact_id: "a1", kind: "hard_check", severity: "hard",
      content: { rule_text: "Max 2 questions" }, scenarios: ["dm_cold"],
      section_kind: "hard_rules", section_heading: "Règles", source_quote: null,
      stats: { fires: 5, last_fired_at: "2026-04-01" }, is_active: true },
    { artifact_id: "a2", kind: "soft_check", severity: "light",
      content: { description: "Évite jargon" }, scenarios: ["dm_cold", "post_engage"],
      section_kind: "errors", section_heading: "Erreurs", source_quote: "user said avoid jargon",
      stats: { fires: 0, last_fired_at: null }, is_active: true },
    { artifact_id: "a3", kind: "pattern", severity: null,
      content: { name: "fondateur SaaS B2B" }, scenarios: null,
      section_kind: "icp_patterns", section_heading: "ICP", source_quote: null,
      stats: { fires: 1, last_fired_at: "2026-04-10" }, is_active: true },
    { artifact_id: "a4", kind: "hard_check", severity: "hard",
      content: { rule_text: "old archived" }, scenarios: null,
      section_kind: "hard_rules", section_heading: "Règles", source_quote: null,
      stats: { fires: 0, last_fired_at: null }, is_active: false },
  ];

  it("returns all active rows by default", () => {
    const out = filterArtifacts(rows);
    assert.equal(out.length, 3);
    assert.ok(!out.find((r) => r.artifact_id === "a4"));
  });

  it("activeOnly=false includes inactive", () => {
    const out = filterArtifacts(rows, { activeOnly: false });
    assert.equal(out.length, 4);
  });

  it("filters by kind (multi)", () => {
    assert.equal(filterArtifacts(rows, { kinds: ["hard_check"] }).length, 1);
    assert.equal(filterArtifacts(rows, { kinds: ["hard_check", "pattern"] }).length, 2);
  });

  it("filters by severity (multi, treats null as missing match)", () => {
    assert.equal(filterArtifacts(rows, { severities: ["hard"] }).length, 1);
    assert.equal(filterArtifacts(rows, { severities: ["light", "hard"] }).length, 2);
  });

  it("filters by sectionKind (exact)", () => {
    assert.equal(filterArtifacts(rows, { sectionKind: "hard_rules" }).length, 1);
    assert.equal(filterArtifacts(rows, { sectionKind: "errors" }).length, 1);
    assert.equal(filterArtifacts(rows, { sectionKind: "nope" }).length, 0);
  });

  it("filters by scenario (substring, case-insensitive)", () => {
    assert.equal(filterArtifacts(rows, { scenario: "DM_COLD" }).length, 2);
    assert.equal(filterArtifacts(rows, { scenario: "post_engage" }).length, 1);
    assert.equal(filterArtifacts(rows, { scenario: "wat" }).length, 0);
  });

  it("filters by query (substring across content/quote/scenarios/heading)", () => {
    assert.equal(filterArtifacts(rows, { query: "questions" }).length, 1);
    assert.equal(filterArtifacts(rows, { query: "jargon" }).length, 1);
    assert.equal(filterArtifacts(rows, { query: "fondateur" }).length, 1);
    assert.equal(filterArtifacts(rows, { query: "RÈGLES" }).length, 1);
    assert.equal(filterArtifacts(rows, { query: "" }).length, 3);
  });

  it("combines filters (AND semantics)", () => {
    const out = filterArtifacts(rows, {
      kinds: ["hard_check", "soft_check"],
      query: "questions",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].artifact_id, "a1");
  });

  it("empty filters return all active rows", () => {
    const out = filterArtifacts(rows, { kinds: [], severities: [], scenario: "", query: "" });
    assert.equal(out.length, 3);
  });
});

describe("sortArtifactsForRegistry", () => {
  it("sorts by last_fired_at DESC, then fires DESC, then severity weight", () => {
    const rows = [
      { artifact_id: "a1", severity: "light", stats: { fires: 0, last_fired_at: null } },
      { artifact_id: "a2", severity: "hard", stats: { fires: 5, last_fired_at: "2026-04-10T00:00:00Z" } },
      { artifact_id: "a3", severity: "strong", stats: { fires: 3, last_fired_at: "2026-04-15T00:00:00Z" } },
      { artifact_id: "a4", severity: "hard", stats: { fires: 0, last_fired_at: null } },
    ];
    const out = sortArtifactsForRegistry(rows);
    assert.equal(out[0].artifact_id, "a3");
    assert.equal(out[1].artifact_id, "a2");
    assert.equal(out[2].artifact_id, "a4");
    assert.equal(out[3].artifact_id, "a1");
  });

  it("does not mutate input", () => {
    const rows = [
      { artifact_id: "a1", severity: "light", stats: { fires: 0, last_fired_at: null } },
      { artifact_id: "a2", severity: "hard", stats: { fires: 5, last_fired_at: "2026-04-10" } },
    ];
    const original = [...rows];
    sortArtifactsForRegistry(rows);
    assert.deepEqual(rows, original);
  });
});

describe("collectFilterOptions", () => {
  it("aggregates unique sorted values", () => {
    const rows = [
      { kind: "hard_check", severity: "hard", section_kind: "hard_rules" },
      { kind: "soft_check", severity: "light", section_kind: "errors" },
      { kind: "hard_check", severity: "strong", section_kind: "hard_rules" },
      { kind: "pattern", severity: null, section_kind: "icp_patterns" },
    ];
    const out = collectFilterOptions(rows);
    assert.deepEqual(out.kinds, ["hard_check", "pattern", "soft_check"]);
    assert.deepEqual(out.severities, ["hard", "light", "strong"]);
    assert.deepEqual(out.sectionKinds, ["errors", "hard_rules", "icp_patterns"]);
  });

  it("handles empty input", () => {
    const out = collectFilterOptions([]);
    assert.deepEqual(out, { kinds: [], severities: [], sectionKinds: [] });
  });
});

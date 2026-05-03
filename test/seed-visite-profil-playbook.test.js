// Tests for the visite_profil playbook seed (migration 055 vertical slice).
//
// Focus: pure function `buildPlan` + idempotency via content_hash dedup.
// Live insert path is tested manually via dry-run + apply against a dev DB.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildPlan,
  computeArtifactHash,
  TEMPLATE_ARTIFACTS,
  NICOLAS_FORK_ARTIFACTS,
} from "../scripts/archive/seed-visite-profil-playbook.js";

describe("seed-visite-profil-playbook — buildPlan", () => {
  it("produces a doc with source_core='visite_profil' and matching artifacts", () => {
    const plan = buildPlan({
      ownerKind: "template",
      ownerId: "00000000-0000-0000-0000-000000000001",
      parentTemplateId: null,
      sectionHeading: "Test heading",
      sectionProse: "Test prose",
      artifactSpecs: TEMPLATE_ARTIFACTS,
      existingHashes: new Set(),
    });

    assert.equal(plan.document.owner_kind, "template");
    assert.equal(plan.document.source_core, "visite_profil");
    assert.equal(plan.document.status, "active");
    assert.equal(plan.document.parent_template_id, null);
    assert.equal(plan.sections.length, 1);
    assert.equal(plan.sections[0].kind, "custom");
    assert.equal(plan.sections[0].document_id, plan.document.id);
    assert.equal(plan.artifacts.length, TEMPLATE_ARTIFACTS.length);
    for (const a of plan.artifacts) {
      assert.equal(a.source_section_id, plan.sections[0].id);
      assert.equal(a.is_active, true);
      assert.ok(a.content_hash, "artifact must have content_hash");
      assert.ok(typeof a.content?.text === "string");
    }
  });

  it("fork plan carries parent_template_id + diverged_from_template_at", () => {
    const plan = buildPlan({
      ownerKind: "persona",
      ownerId: "persona-uuid",
      parentTemplateId: "template-uuid",
      sectionHeading: "fork",
      sectionProse: "fork prose",
      artifactSpecs: NICOLAS_FORK_ARTIFACTS,
      existingHashes: new Set(),
    });

    assert.equal(plan.document.owner_kind, "persona");
    assert.equal(plan.document.owner_id, "persona-uuid");
    assert.equal(plan.document.parent_template_id, "template-uuid");
    assert.ok(plan.document.diverged_from_template_at, "fork must record divergence ts");
    assert.equal(plan.artifacts.length, NICOLAS_FORK_ARTIFACTS.length);
  });

  it("idempotency: re-running with all hashes already present yields zero new artifacts", () => {
    const allHashes = new Set(
      TEMPLATE_ARTIFACTS.map((s) => computeArtifactHash(s.text)).filter(Boolean)
    );
    const plan = buildPlan({
      ownerKind: "template",
      ownerId: "00000000-0000-0000-0000-000000000001",
      parentTemplateId: null,
      sectionHeading: "x",
      sectionProse: "x",
      artifactSpecs: TEMPLATE_ARTIFACTS,
      existingHashes: allHashes,
    });
    assert.equal(plan.artifacts.length, 0);
  });

  it("partial idempotency: only NEW hashes get inserted on re-run", () => {
    const halfPoint = Math.floor(TEMPLATE_ARTIFACTS.length / 2);
    const seenHashes = new Set(
      TEMPLATE_ARTIFACTS
        .slice(0, halfPoint)
        .map((s) => computeArtifactHash(s.text))
        .filter(Boolean)
    );
    const plan = buildPlan({
      ownerKind: "template",
      ownerId: "00000000-0000-0000-0000-000000000001",
      parentTemplateId: null,
      sectionHeading: "x",
      sectionProse: "x",
      artifactSpecs: TEMPLATE_ARTIFACTS,
      existingHashes: seenHashes,
    });
    assert.equal(plan.artifacts.length, TEMPLATE_ARTIFACTS.length - halfPoint);
  });

  it("all template artifacts have unique content_hash (no accidental duplicates)", () => {
    const hashes = TEMPLATE_ARTIFACTS.map((a) => computeArtifactHash(a.text));
    const unique = new Set(hashes);
    assert.equal(unique.size, hashes.length, "duplicate text in TEMPLATE_ARTIFACTS");
  });

  it("all Nicolas fork artifacts have unique content_hash", () => {
    const hashes = NICOLAS_FORK_ARTIFACTS.map((a) => computeArtifactHash(a.text));
    const unique = new Set(hashes);
    assert.equal(unique.size, hashes.length, "duplicate text in NICOLAS_FORK_ARTIFACTS");
  });

  it("template artifacts are voice-neutral (do NOT contain Nicolas-specific signature/formules)", () => {
    // The universal template should be reusable across setters → strip voice signals.
    // This guards against re-introducing Nicolas-specific text in TEMPLATE_ARTIFACTS.
    const VOICE_LEAKS = [
      "saalut",          // Nicolas's characteristic salutation
      "Nicolas Lavall",  // Nicolas's full name
      "House of Mentor", // Nicolas's brand
      "HOM",             // Nicolas's brand acronym
      "4 750",           // Nicolas's specific price
      "🙂 Nicolas",       // Nicolas's signature emoji + name
    ];
    for (const a of TEMPLATE_ARTIFACTS) {
      for (const leak of VOICE_LEAKS) {
        assert.ok(
          !a.text.includes(leak),
          `template artifact leaks voice marker "${leak}": ${a.text.slice(0, 80)}…`
        );
      }
    }
  });

  it("Nicolas fork artifacts DO contain voice-specific signals", () => {
    // Conversely, the fork should include Nicolas's voice markers.
    const allText = NICOLAS_FORK_ARTIFACTS.map((a) => a.text).join("\n");
    assert.ok(allText.includes("saalut"), "fork should include 'saalut' icebreaker");
    assert.ok(allText.includes("Nicolas"), "fork should include 'Nicolas' signature");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STAGE_SLUGS, isStageSlug, deriveStageSlug } from "../lib/stage.js";

describe("STAGE_SLUGS catalog", () => {
  test("exposes the 5 canonical slugs", () => {
    assert.deepEqual(Object.values(STAGE_SLUGS).sort(), [
      "closing",
      "first_message",
      "follow_up",
      "in_conv",
      "to_contact",
    ]);
  });

  test("isStageSlug recognizes canonical slugs and rejects free-form text", () => {
    assert.equal(isStageSlug("to_contact"), true);
    assert.equal(isStageSlug("closing"), true);
    assert.equal(isStageSlug("rdv pris"), false);
    assert.equal(isStageSlug(""), false);
    assert.equal(isStageSlug(null), false);
    assert.equal(isStageSlug(undefined), false);
  });
});

describe("deriveStageSlug", () => {
  test("returns null for non-DM scenarios (posts have no pipeline)", () => {
    assert.equal(
      deriveStageSlug({ scenario: "post", scenarioType: "post_autonome", hasToi: true, hasProspect: false }),
      null,
    );
    assert.equal(
      deriveStageSlug({ scenario: null, scenarioType: null, hasToi: false, hasProspect: false }),
      null,
    );
  });

  test("DM vide (ni toi ni prospect) → to_contact", () => {
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_1st", hasToi: false, hasProspect: false }),
      STAGE_SLUGS.TO_CONTACT,
    );
  });

  test("DM avec un toi mais sans réponse prospect → first_message", () => {
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_1st", hasToi: true, hasProspect: false }),
      STAGE_SLUGS.FIRST_MESSAGE,
    );
  });

  test("DM avec réponse prospect (non-relance) → in_conv", () => {
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_reply", hasToi: true, hasProspect: true }),
      STAGE_SLUGS.IN_CONV,
    );
    // Even without a 'toi' logged, an imported prospect message bumps to in_conv
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_1st", hasToi: false, hasProspect: true }),
      STAGE_SLUGS.IN_CONV,
    );
  });

  test("DM_relance avec un prospect dans l'historique → follow_up", () => {
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_relance", hasToi: true, hasProspect: true }),
      STAGE_SLUGS.FOLLOW_UP,
    );
  });

  test("DM_relance sans prospect (rare : relance cold) → first_message", () => {
    // Pas de prospect ⇒ la règle follow_up ne s'applique pas. L'operator a tapé
    // une relance sur une conv vierge, on reste sur first_message.
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_relance", hasToi: true, hasProspect: false }),
      STAGE_SLUGS.FIRST_MESSAGE,
    );
  });

  test("DM_closing écrase tout (même sans prospect logué)", () => {
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_closing", hasToi: true, hasProspect: true }),
      STAGE_SLUGS.CLOSING,
    );
    assert.equal(
      deriveStageSlug({ scenario: "dm", scenarioType: "DM_closing", hasToi: false, hasProspect: false }),
      STAGE_SLUGS.CLOSING,
    );
  });
});

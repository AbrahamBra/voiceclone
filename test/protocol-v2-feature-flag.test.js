import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  isNewProtocolUiEnabled,
  getNewProtocolUiWhitelist,
} from "../lib/protocol-v2-feature-flag.js";

const PERSONA_A = "11111111-1111-1111-1111-111111111111";
const PERSONA_B = "22222222-2222-2222-2222-222222222222";

describe("isNewProtocolUiEnabled — disabled by default", () => {
  it("returns false when env var is undefined", () => {
    assert.equal(isNewProtocolUiEnabled(PERSONA_A, { envValue: undefined }), false);
  });

  it("returns false when env var is empty string", () => {
    assert.equal(isNewProtocolUiEnabled(PERSONA_A, { envValue: "" }), false);
  });

  it("returns false when env var is whitespace only", () => {
    assert.equal(isNewProtocolUiEnabled(PERSONA_A, { envValue: "   " }), false);
  });
});

describe("isNewProtocolUiEnabled — wildcard '*'", () => {
  it("enables for any valid uuid", () => {
    assert.equal(isNewProtocolUiEnabled(PERSONA_A, { envValue: "*" }), true);
    assert.equal(isNewProtocolUiEnabled(PERSONA_B, { envValue: "*" }), true);
  });

  it("works with extra whitespace and commas", () => {
    assert.equal(
      isNewProtocolUiEnabled(PERSONA_A, { envValue: " * , " }),
      true,
    );
  });

  it("still requires a string id even with wildcard", () => {
    // wildcard short-circuits before the uuid check
    assert.equal(isNewProtocolUiEnabled(PERSONA_A, { envValue: "*" }), true);
  });
});

describe("isNewProtocolUiEnabled — explicit whitelist", () => {
  it("enables only listed persona", () => {
    assert.equal(
      isNewProtocolUiEnabled(PERSONA_A, { envValue: PERSONA_A }),
      true,
    );
    assert.equal(
      isNewProtocolUiEnabled(PERSONA_B, { envValue: PERSONA_A }),
      false,
    );
  });

  it("supports comma-separated list", () => {
    assert.equal(
      isNewProtocolUiEnabled(PERSONA_A, { envValue: `${PERSONA_A}, ${PERSONA_B}` }),
      true,
    );
    assert.equal(
      isNewProtocolUiEnabled(PERSONA_B, { envValue: `${PERSONA_A}, ${PERSONA_B}` }),
      true,
    );
  });

  it("ignores invalid uuids in the list", () => {
    assert.equal(
      isNewProtocolUiEnabled(PERSONA_A, { envValue: `not-a-uuid, ${PERSONA_A}` }),
      true,
    );
  });

  it("returns false when persona is not in list", () => {
    assert.equal(
      isNewProtocolUiEnabled("99999999-9999-9999-9999-999999999999", {
        envValue: `${PERSONA_A}, ${PERSONA_B}`,
      }),
      false,
    );
  });
});

describe("isNewProtocolUiEnabled — guard clauses", () => {
  it("returns false when personaId is not a string", () => {
    assert.equal(isNewProtocolUiEnabled(null, { envValue: PERSONA_A }), false);
    assert.equal(isNewProtocolUiEnabled(undefined, { envValue: PERSONA_A }), false);
    assert.equal(isNewProtocolUiEnabled(42, { envValue: PERSONA_A }), false);
  });

  it("returns false when personaId is not a valid uuid", () => {
    assert.equal(isNewProtocolUiEnabled("nope", { envValue: PERSONA_A }), false);
  });
});

describe("getNewProtocolUiWhitelist", () => {
  it("returns empty when env var not set", () => {
    const out = getNewProtocolUiWhitelist({ envValue: undefined });
    assert.deepEqual(out, { wildcard: false, personaIds: [] });
  });

  it("detects wildcard", () => {
    const out = getNewProtocolUiWhitelist({ envValue: "*" });
    assert.equal(out.wildcard, true);
    assert.deepEqual(out.personaIds, []);
  });

  it("returns parsed valid uuids only", () => {
    const out = getNewProtocolUiWhitelist({
      envValue: `not-a-uuid, ${PERSONA_A}, ${PERSONA_B}, also-bad`,
    });
    assert.equal(out.wildcard, false);
    assert.deepEqual(out.personaIds.sort(), [PERSONA_A, PERSONA_B].sort());
  });

  it("handles wildcard + explicit ids", () => {
    const out = getNewProtocolUiWhitelist({ envValue: `*, ${PERSONA_A}` });
    assert.equal(out.wildcard, true);
    assert.deepEqual(out.personaIds, [PERSONA_A]);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toLinkedIn } from "../src/lib/utils.js";

describe("toLinkedIn — markdown to LinkedIn-ready Unicode", () => {
  test("returns empty for empty input", () => {
    assert.equal(toLinkedIn(""), "");
    assert.equal(toLinkedIn(null), "");
    assert.equal(toLinkedIn(undefined), "");
  });

  test("converts **bold** to Unicode mathematical bold", () => {
    assert.equal(toLinkedIn("**Hello**"), "𝐇𝐞𝐥𝐥𝐨");
    assert.equal(toLinkedIn("**ABC 123**"), "𝐀𝐁𝐂 𝟏𝟐𝟑");
  });

  test("converts *italic* to Unicode mathematical italic", () => {
    assert.equal(toLinkedIn("*hello*"), "\u210E\u{1D452}\u{1D459}\u{1D459}\u{1D45C}"); // h → Planck, ello → italic
    assert.equal(toLinkedIn("*abc*"), "𝑎𝑏𝑐");
  });

  test("preserves plain text unchanged", () => {
    assert.equal(toLinkedIn("Just a plain line."), "Just a plain line.");
  });

  test("strips standalone --- separator lines", () => {
    const input = "first\n---\nsecond";
    assert.ok(!toLinkedIn(input).includes("---"));
  });

  test("bullets: -, *, • all become •", () => {
    assert.equal(toLinkedIn("- one"), "• one");
    assert.equal(toLinkedIn("* two"), "• two");
    assert.equal(toLinkedIn("• three"), "• three");
  });

  test("numbered lists keep their digits", () => {
    assert.equal(toLinkedIn("1. first"), "1. first");
    assert.equal(toLinkedIn("2) second"), "2. second");
  });

  test("preserves paragraph double line-breaks", () => {
    const input = "Para one.\n\nPara two.";
    assert.equal(toLinkedIn(input), "Para one.\n\nPara two.");
  });

  test("complex real-world post", () => {
    const input = [
      "**Hypothèse** : les DM froids fonctionnent si...",
      "",
      "- point un",
      "- point deux",
      "",
      "*À tester demain.*",
    ].join("\n");
    const out = toLinkedIn(input);
    assert.ok(out.includes("𝐇𝐲𝐩𝐨𝐭𝐡è𝐬𝐞"));
    assert.ok(out.includes("• point un"));
    assert.ok(out.includes("• point deux"));
    assert.ok(out.startsWith("𝐇𝐲𝐩𝐨𝐭𝐡è𝐬𝐞"));
    assert.ok(!out.includes("**"));
    assert.ok(!out.includes("- "));
  });
});

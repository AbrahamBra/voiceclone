import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseJsonFromText } from "../lib/claude-helpers.js";

describe("parseJsonFromText", () => {
  test("returns null for empty input", () => {
    assert.equal(parseJsonFromText(""), null);
    assert.equal(parseJsonFromText(null), null);
    assert.equal(parseJsonFromText(undefined), null);
  });

  test("returns null when no JSON object present", () => {
    assert.equal(parseJsonFromText("just plain text"), null);
  });

  test("parses a bare JSON object", () => {
    const out = parseJsonFromText('{"rule":"X","count":3}');
    assert.deepEqual(out, { rule: "X", count: 3 });
  });

  test("extracts JSON from surrounding prose", () => {
    const text = 'Voici la reponse : {"rule":"Messages courts","ok":true} -- merci';
    const out = parseJsonFromText(text);
    assert.deepEqual(out, { rule: "Messages courts", ok: true });
  });

  test("handles multi-line JSON", () => {
    const text = `
      prefix
      {
        "indices": [0, 2],
        "reason": "match"
      }
      suffix
    `;
    const out = parseJsonFromText(text);
    assert.deepEqual(out, { indices: [0, 2], reason: "match" });
  });

  test("returns null on malformed JSON", () => {
    assert.equal(parseJsonFromText("{not valid json}"), null);
    assert.equal(parseJsonFromText("{key: 'x'}"), null);
  });

  test("captures greedy full-span for nested objects", () => {
    const text = 'x {"a":{"b":1},"c":2} y';
    const out = parseJsonFromText(text);
    assert.deepEqual(out, { a: { b: 1 }, c: 2 });
  });
});

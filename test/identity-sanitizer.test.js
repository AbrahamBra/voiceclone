import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeIdentityProse } from "../lib/identity-sanitizer.js";

test("strips Notion <aside> tags but keeps inner content", () => {
  const input = "Hello\n<aside>\nInsight here\n</aside>\nWorld";
  const out = sanitizeIdentityProse(input);
  assert.match(out, /Hello/);
  assert.match(out, /Insight here/);
  assert.doesNotMatch(out, /<aside>/);
});

test("strips Notion <img> icon tags", () => {
  const input = '<img src="/icons/no_orange.svg" alt="x" width="40px" />\nText';
  const out = sanitizeIdentityProse(input);
  assert.equal(out.includes("<img"), false);
  assert.match(out, /Text/);
});

test("collapses 3+ blank lines to 2", () => {
  const input = "Line1\n\n\n\n\nLine2";
  const out = sanitizeIdentityProse(input);
  assert.equal(out, "Line1\n\nLine2");
});

test("trims trailing whitespace per line", () => {
  const input = "Line1   \nLine2\t\t";
  const out = sanitizeIdentityProse(input);
  assert.equal(out, "Line1\nLine2");
});

test("idempotent : sanitize(sanitize(x)) === sanitize(x)", () => {
  const input = "<aside>\nFoo  \n\n\n\nBar</aside>";
  const once = sanitizeIdentityProse(input);
  const twice = sanitizeIdentityProse(once);
  assert.equal(once, twice);
});

test("returns empty string for non-string input", () => {
  assert.equal(sanitizeIdentityProse(null), "");
  assert.equal(sanitizeIdentityProse(undefined), "");
  assert.equal(sanitizeIdentityProse(123), "");
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chunkText, isEmbeddingAvailable } from "../lib/embeddings.js";

describe("chunkText", () => {
  test("returns empty array on empty string", () => {
    assert.deepEqual(chunkText(""), []);
  });

  test("returns single chunk for short text without paragraphs", () => {
    const out = chunkText("hello world");
    assert.equal(out.length, 1);
    assert.equal(out[0], "hello world");
  });

  test("splits on double newlines", () => {
    const text = "para one\n\npara two\n\npara three";
    const out = chunkText(text, 500);
    assert.equal(out.length, 1, "short paragraphs fit in one chunk at 500 tokens");
    assert.ok(out[0].includes("para one"));
    assert.ok(out[0].includes("para three"));
  });

  test("starts a new chunk when token budget exceeded", () => {
    const long = "word ".repeat(200).trim();
    const text = `${long}\n\n${long}\n\n${long}`;
    const out = chunkText(text, 50);
    assert.ok(out.length >= 2, "long text should split into multiple chunks");
  });

  test("trims whitespace around chunks", () => {
    const out = chunkText("  \n\nhello  \n\n  world\n\n  ");
    for (const c of out) {
      assert.equal(c, c.trim(), "chunk should be trimmed");
    }
  });

  test("drops empty paragraphs", () => {
    const out = chunkText("a\n\n\n\n\n\nb");
    assert.ok(out.length >= 1);
    assert.ok(out.join(" ").includes("a"));
    assert.ok(out.join(" ").includes("b"));
  });

  test("falls back to single chunk when no paragraph breaks", () => {
    const text = "one line with no breaks " + "x".repeat(200);
    const out = chunkText(text, 500);
    assert.equal(out.length, 1);
  });
});

describe("isEmbeddingAvailable", () => {
  test("returns boolean", () => {
    assert.equal(typeof isEmbeddingAvailable(), "boolean");
  });
});

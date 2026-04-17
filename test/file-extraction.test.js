import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { extractFileText } from "../src/lib/file-extraction.js";

function fileFromFixture(path, type = "") {
  const buf = readFileSync(path);
  return {
    name: path.split(/[\\/]/).pop(),
    type,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("utf8"),
  };
}

describe("extractFileText", () => {
  it("reads plain text (.txt)", async () => {
    const file = fileFromFixture("test/fixtures/sample.txt", "text/plain");
    const text = await extractFileText(file);
    assert.equal(text.trim(), "hello world");
  });

  it("reads a docx via mammoth", async () => {
    const file = fileFromFixture(
      "test/fixtures/sample.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const text = await extractFileText(file);
    assert.match(text, /hello world/i);
  });

  it("rejects unknown formats", async () => {
    const file = {
      name: "x.bin",
      type: "application/octet-stream",
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    await assert.rejects(() => extractFileText(file), /unsupported/i);
  });

  it("treats unknown MIME but .md extension as text", async () => {
    const content = "# hi";
    const file = {
      name: "note.md",
      type: "",
      text: async () => content,
      arrayBuffer: async () => Buffer.from(content).buffer,
    };
    const text = await extractFileText(file);
    assert.equal(text, "# hi");
  });
});

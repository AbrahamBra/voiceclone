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

  it("reads an ODT (zipped content.xml) and decodes paragraphs + entities", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const contentXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
      `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">` +
      `<office:body><office:text>` +
      `<text:p>Premier paragraphe — l&apos;essentiel.</text:p>` +
      `<text:p>Second paragraphe : 42 &lt; 100.</text:p>` +
      `<text:p/>` +
      `<text:p>Troisi&#232;me paragraphe avec accent.</text:p>` +
      `</office:text></office:body></office:document-content>`;
    const zipped = zipSync({ "content.xml": strToU8(contentXml) });
    const file = {
      name: "synthetic.odt",
      type: "application/vnd.oasis.opendocument.text",
      arrayBuffer: async () => zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength),
    };
    const text = await extractFileText(file);
    assert.match(text, /Premier paragraphe — l'essentiel\./);
    assert.match(text, /Second paragraphe : 42 < 100\./);
    assert.match(text, /Troisième paragraphe avec accent/);
    // Paragraph boundaries preserved as blank lines (so chunkDoc can split).
    assert.match(text, /\n\n/);
  });

  it("throws a clear error if the ODT lacks content.xml", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const zipped = zipSync({ "manifest.xml": strToU8("<x/>") });
    const file = {
      name: "broken.odt",
      type: "application/vnd.oasis.opendocument.text",
      arrayBuffer: async () => zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength),
    };
    await assert.rejects(() => extractFileText(file), /content\.xml/);
  });
});

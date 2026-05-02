export async function extractFileText(file) {
  const name = (file.name || "").toLowerCase();

  if (
    file.type === "text/plain" ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv")
  ) {
    return await file.text();
  }

  if (name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    if (
      !pdfjsLib.GlobalWorkerOptions.workerSrc &&
      typeof window !== "undefined"
    ) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    return pages.join("\n\n");
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const input =
      typeof Buffer !== "undefined"
        ? { buffer: Buffer.from(arrayBuffer) }
        : { arrayBuffer };
    const result = await mammoth.extractRawText(input);
    return result.value;
  }

  if (name.endsWith(".odt")) {
    return await extractOdtText(file);
  }

  throw new Error(`Unsupported file format: ${name}`);
}

// ODT = ZIP archive containing content.xml. We unzip just that one entry,
// strip XML tags, and decode entities. fflate is used over jszip because
// its esm bundle is ~14 KB vs ~95 KB and the API is sync after unzipping.
async function extractOdtText(file) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const arrayBuffer = await file.arrayBuffer();
  const u8 = new Uint8Array(arrayBuffer);
  const entries = unzipSync(u8, { filter: (e) => e.name === "content.xml" });
  const contentBytes = entries["content.xml"];
  if (!contentBytes) {
    throw new Error("ODT: content.xml not found");
  }
  const xml = strFromU8(contentBytes);

  // Convert paragraph closes to blank lines so the protocol chunker sees
  // paragraph boundaries, then strip remaining tags and decode entities.
  const withBreaks = xml
    .replace(/<text:p[^>]*\/>/g, "\n\n")
    .replace(/<\/text:p>/g, "\n\n")
    .replace(/<text:line-break\s*\/?>/g, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = stripped
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return decoded.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
